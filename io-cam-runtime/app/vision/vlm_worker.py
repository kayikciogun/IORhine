"""
VLM Worker and Model Management (app/vision/vlm_worker.py)

Handles Falcon-Perception (VLM) PyTorch/CUDA model lifecycle, inference queue,
batch generation, token decoding, and logger output.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from concurrent.futures import Future
from typing import Any

import numpy as np

from app.vision.vlm_preprocess import (
    VLM_IMG_MAX_DIM as _AI_IMG_MAX_DIM,
    VLM_IMG_MIN_DIM as _AI_IMG_MIN_DIM,
)

logger = logging.getLogger("io_cam.ai_detect")


def _vlog(msg: str, *args: Any) -> None:
    """Stdout → runtime.log. logger.info yok (çift satır / uvicorn formatı)."""
    text = msg % args if args else msg
    print(f"[VLM] {text}", flush=True)


_AI_MODEL_PATH = "tiiuae/Falcon-Perception"
# 0.6B model — 300M tespit kalitesi yetersizdi (0 nesne).
# max_dimension=512 (768 yerine).
#
# PyTorch/CUDA backend. BatchInferenceEngine.generate ``task="detection"``.
# Tek taş hızı için ilk ``<|seg|>`` stop kullanıyoruz.
_AI_MAX_NEW_TOKENS_CAP = 48
# presence + coord + size + seg (+ eos) ≈ 4–6; marj 8.
_AI_MAX_NEW_TOKENS_SINGLE = 8
_AI_DTYPE = "bfloat16"

_DEFAULT_MAX_STONES = 10
_model = None
_tokenizer = None
_model_args = None
_engine = None
_device = None

_ai_status = "uninitialized"  # uninitialized, loading, warming_up, ready, error
# Worker: (Future, batch, max_new_tokens, max_stones)
_ai_request_queue: "queue.Queue[tuple[Future | None, Any, int, int]]" = queue.Queue(maxsize=1)
_worker_started = False
_ai_busy_lock = threading.Lock()


def _batch_to_device(batch: dict[str, Any]) -> dict[str, Any]:
    """CPU batch tensor'larını worker CUDA cihazına taşı."""
    import torch

    if _device is None:
        return batch
    return {
        k: (v.to(_device) if torch.is_tensor(v) else v)
        for k, v in batch.items()
    }


def _max_new_tokens_for(max_stones: int) -> int:
    """Taş sayısına göre decode bütçesi — tek taşta kısa generate = daha hızlı."""
    n = max(1, int(max_stones))
    if n <= 1:
        return _AI_MAX_NEW_TOKENS_SINGLE
    return min(_AI_MAX_NEW_TOKENS_CAP, 4 + n * 3 + 2)


def _stop_token_ids_for(max_stones: int) -> list[int]:
    """Tek taş: ilk ``<|seg|>`` sonrası dur — kalan taşlar için token üretme."""
    ids: list[int] = []
    if _tokenizer is None:
        return ids
    eos = getattr(_tokenizer, "eos_token_id", None)
    if eos is not None:
        ids.append(int(eos))
    eoq = getattr(_tokenizer, "end_of_query_token_id", None)
    if eoq is not None:
        ids.append(int(eoq))
    if max_stones <= 1:
        seg = getattr(_tokenizer, "seg_token_id", None)
        if seg is None:
            try:
                seg = _tokenizer.convert_tokens_to_ids("<|seg|>")
            except Exception:
                seg = None
        if seg is not None:
            ids.append(int(seg))
    return ids


def _ai_worker_thread():
    global _model, _tokenizer, _model_args, _engine, _ai_status, _device
    try:
        import torch
        from falcon_perception import load_and_prepare_model, setup_torch_config
        from falcon_perception.batch_inference import BatchInferenceEngine

        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA kullanılabilir değil — NVIDIA sürücüsü / torch+cu wheel gerekli. "
                f"torch={torch.__version__}"
            )

        setup_torch_config()
        _ai_status = "loading"
        print(
            f"[VLM] Falcon-Perception CUDA yukleniyor "
            f"(device={torch.cuda.get_device_name(0)}, dtype={_AI_DTYPE})...",
            flush=True,
        )
        logger.info(
            "Falcon-Perception CUDA yükleniyor (device=%s, dtype=%s)...",
            torch.cuda.get_device_name(0),
            _AI_DTYPE,
        )
        _model, _tokenizer, _model_args = load_and_prepare_model(
            hf_model_id=_AI_MODEL_PATH,
            backend="torch",
            dtype=_AI_DTYPE,
            compile=True,
            device="cuda",
        )
        _device = _model.device
        # dtype/device gerçekten uygulandı mı? (istedik bfloat16 — sessizce fp32 kalmasın)
        try:
            _param = next(_model.parameters())
            _real_dtype = _param.dtype
            _real_device = _param.device
        except StopIteration:
            _real_dtype = getattr(_model, "dtype", "?")
            _real_device = _device
        print(
            f"[VLM] Model dtype: {_real_dtype}  device: {_real_device}  "
            f"(requested={_AI_DTYPE})",
            flush=True,
        )
        if _real_dtype not in (torch.float16, torch.bfloat16):
            print(
                f"[VLM] WARNING: model dtype={_real_dtype} — fp16/bf16 degil, "
                "CUDA path sessizce fp32 kullanıyor olabilir (2x yavaslik).",
                flush=True,
            )
        # Batch engine: sadece model+tokenizer (paged engine'deki kernel_options yok).
        _engine = BatchInferenceEngine(_model, _tokenizer)

        # Ayrı warmup generate YOK — torch.compile ilk gerçek detect'te bir kez derlenir.
        # Eski dummy warm-up dakikalarca asılı kalıp status=warming_up'da kilitliyordu.
        _ai_status = "ready"
        free_gib = torch.cuda.mem_get_info()[0] / (1024 ** 3)
        print(
            f"[VLM] READY device={_device} vram_free={free_gib:.1f} GiB "
            "(ilk Kare Al compile icin biraz surebilir)",
            flush=True,
        )
        logger.info(
            "Falcon-Perception CUDA ready (device=%s, dtype=%s, vram=%.1f GiB free)",
            _device,
            _real_dtype,
            free_gib,
        )
    except Exception as e:
        print(f"[VLM] ERROR worker init failed: {e}", flush=True)
        logger.error("AI Worker init failed: %s", e, exc_info=True)
        _ai_status = "error"
        return

    while True:
        future, batch, max_new_tokens, max_stones = _ai_request_queue.get()
        if future is None:
            break
        try:
            print(
                f"[VLM] generate basliyor max_new_tokens={max_new_tokens} "
                f"max_stones={max_stones} task=detection",
                flush=True,
            )
            stop_ids = _stop_token_ids_for(max_stones)
            t_xfer0 = time.perf_counter()
            gpu_batch = _batch_to_device(batch)
            t_xfer1 = time.perf_counter()
            t_gen0 = time.perf_counter()
            tokens, aux_outputs = _engine.generate(
                **gpu_batch,
                max_new_tokens=max_new_tokens,
                temperature=0.0,
                stop_token_ids=stop_ids or None,
                seed=42,
                task="detection",
            )
            t_gen1 = time.perf_counter()
            xfer_sec = t_xfer1 - t_xfer0
            gen_sec = t_gen1 - t_gen0
            # Girdi uzunluğu: sadece generate edilen kısmı decode etmek için
            try:
                tok = batch.get("tokens")
                if tok is not None:
                    import torch

                    if torch.is_tensor(tok):
                        input_len = int(tok.shape[-1])
                    else:
                        input_len = int(np.asarray(tok).shape[-1])
                else:
                    input_len = 0
            except Exception:
                input_len = 0
            print(
                f"[TIMING] VLM generate: {gen_sec:.3f}s "
                f"(h2d={xfer_sec:.3f}s) input_len={input_len} "
                f"max_new_tokens={max_new_tokens} max_stones={max_stones} "
                f"task=detection",
                flush=True,
            )
            print("[VLM] generate bitti", flush=True)
            if not future.done():
                # tokens / aux / input_len / worker generate süresi
                future.set_result((tokens, aux_outputs, input_len, gen_sec))
        except Exception as e:
            if not future.done():
                future.set_exception(e)
        finally:
            _ai_request_queue.task_done()


def _format_vlm_tokens(tokens: Any, input_len: int = 0) -> tuple[str, list[int]]:
    """Generate edilen token'ları decode et.

    Returns:
        (decoded_text, gen_ids) — özel token'lar strip edilince metin boş olabilir;
        asıl detection çıktısı ``bboxes_raw`` (coord/size special token'ları).
    """
    empty: list[int] = []
    if tokens is None:
        return "", empty
    if isinstance(tokens, str):
        return tokens.strip(), empty

    try:
        import numpy as np

        try:
            import torch

            if torch.is_tensor(tokens):
                tokens = tokens.detach().cpu().numpy()
        except Exception:
            pass

        arr = np.asarray(tokens)
    except Exception:
        return str(tokens).strip(), empty

    if not (getattr(arr, "dtype", None) is not None and np.issubdtype(arr.dtype, np.number)):
        return str(tokens).strip(), empty

    if arr.ndim >= 2:
        row = arr.reshape(arr.shape[0], -1)[0]
    else:
        row = arr.reshape(-1)
    pad_id = getattr(_tokenizer, "pad_token_id", 0) if _tokenizer is not None else 0
    start = max(0, int(input_len))
    if start < row.shape[0]:
        row = row[start:]
    ids = [int(x) for x in row.tolist() if int(x) != int(pad_id)]
    if not ids:
        return "", empty
    text = ""
    if _tokenizer is not None:
        try:
            # skip_special=False: detection special token'ları da görünsün
            text = _tokenizer.decode(ids, skip_special_tokens=False).strip()
        except Exception:
            text = ""
    if not text:
        text = "[" + ", ".join(str(i) for i in ids) + "]"
    return text, ids


def _format_bboxes_raw(raw: Any) -> str:
    """bboxes_raw log satırı — float'ları 2 ondalığa yuvarla (JSON dump kısaltması)."""

    def _round(obj: Any) -> Any:
        if isinstance(obj, float):
            return round(obj, 2)
        if isinstance(obj, dict):
            return {k: _round(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_round(v) for v in obj]
        # numpy skaler
        try:
            import numpy as np

            if isinstance(obj, np.floating):
                return round(float(obj), 2)
        except Exception:
            pass
        return obj

    try:
        import json

        return json.dumps(_round(raw), ensure_ascii=False, default=str)
    except Exception:
        return repr(raw)


def get_ai_model():
    """Backward-compatible entry point used by other modules."""
    global _worker_started
    if not _worker_started:
        _worker_started = True
        threading.Thread(target=_ai_worker_thread, daemon=True).start()
    return _model, _tokenizer, _model_args


def ai_status() -> str:
    """AI model durumunu döndürür — frontend'de buton disable/retry için."""
    return _ai_status
