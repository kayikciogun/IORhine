"""
VLM Worker and Model Management (app/vision/vlm_worker.py)

Handles Falcon-Perception (VLM) PyTorch/CUDA model lifecycle, inference queue,
PagedInferenceEngine generation, token decoding, and logger output.
"""
from __future__ import annotations

import logging
import queue
import threading
import time
from concurrent.futures import Future
from typing import Any, Callable

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
# Varsayılan 0.6B. 0.3B denemek için .env: IO_CAM_VLM_MODEL=tiiuae/Falcon-Perception-300M
# (300M detection-only; seg token yok. Önceki denemede kalite zayıftı — A/B için env bırakıldı.)
#
# PyTorch/CUDA + PagedInferenceEngine (paged KV, CUDA graph decode).
# Tek taş hızı için ilk ``<|seg|>`` stop kullanıyoruz (0.6B).
_AI_MAX_NEW_TOKENS_CAP = 48
# presence + coord + size + seg (+ eos) ≈ 4–6; marj 8.
_AI_MAX_NEW_TOKENS_SINGLE = 8
_AI_DTYPE = "bfloat16"
_AI_MAX_SEQ_LENGTH = 8192

_DEFAULT_MAX_STONES = 10
_model = None
_tokenizer = None
_model_args = None
_engine = None
_device = None

_ai_status = "uninitialized"  # uninitialized, loading, warming_up, ready, error
# Worker: (Future | None, pil_image, text_prompt, max_new_tokens, max_stones)
# Shutdown: (None, None, None, 0, 0)
_ai_request_queue: "queue.Queue[tuple[Future | None, Any, str | None, int, int]]" = queue.Queue(
    maxsize=1
)
_worker_started = False
_ai_busy_lock = threading.Lock()
_status_listeners: list[Callable[[str], None]] = []


def on_ai_status_change(listener: Callable[[str], None]) -> None:
    """UI / EventBus için durum değişimi dinleyicisi (worker thread'den çağrılır)."""
    _status_listeners.append(listener)


def _set_ai_status(status: str) -> None:
    global _ai_status
    if _ai_status == status:
        return
    _ai_status = status
    print(f"[VLM] status -> {status}", flush=True)
    for cb in list(_status_listeners):
        try:
            cb(status)
        except Exception as exc:
            logger.warning("ai_status listener failed: %s", exc)


def _resolve_model_id() -> str:
    """``.env`` / settings → HF model id (yoksa 0.6B varsayılan)."""
    try:
        from app.config.settings import settings

        mid = (settings.vlm_model or "").strip()
        if mid:
            return mid
    except Exception:
        pass
    return _AI_MODEL_PATH


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


def _run_paged_generate(
    pil_image: Any,
    text_prompt: str,
    *,
    max_new_tokens: int,
    max_stones: int,
) -> tuple[Any, list[Any], int, float, Any]:
    """PagedInferenceEngine.generate — (tokens, [aux], input_len, gen_sec, stats)."""
    from falcon_perception.paged_inference import SamplingParams, Sequence

    seq = Sequence(
        text=text_prompt,
        image=pil_image,
        min_image_size=_AI_IMG_MIN_DIM,
        max_image_size=_AI_IMG_MAX_DIM,
        task="detection",
    )
    stop_ids = _stop_token_ids_for(max_stones)
    sampling = SamplingParams(
        max_new_tokens=max_new_tokens,
        stop_token_ids=stop_ids or None,
    )
    t0 = time.perf_counter()
    done = _engine.generate(
        [seq],
        sampling_params=sampling,
        temperature=0.0,
        use_tqdm=False,
        print_stats=False,
    )
    gen_sec = time.perf_counter() - t0
    out_seq = done[0] if done else seq
    try:
        input_len = int(out_seq.input_length)
    except Exception:
        input_len = 0
    try:
        # output_ids property GPU skaler listeden tensor üretebilir; int liste daha güvenli
        raw_ids = getattr(out_seq, "_output_ids", None) or []
        tokens = [
            int(t.item()) if hasattr(t, "item") else int(t)
            for t in raw_ids
        ]
    except Exception:
        try:
            tokens = out_seq.output_ids
        except Exception:
            tokens = None
    stats = getattr(out_seq, "stats", None)
    return tokens, [out_seq.output_aux], input_len, gen_sec, stats


def _run_compile_warmup() -> None:
    """torch.compile + CUDA graph maliyetini startup'a çek (Sequence yolu)."""
    from falcon_perception import build_prompt_for_task
    from PIL import Image

    dummy = Image.fromarray(np.zeros((256, 256, 3), dtype=np.uint8))
    text_prompt = build_prompt_for_task("stone", "detection")
    print("[VLM] PagedInferenceEngine warmup basliyor (30-180s surebilir)...", flush=True)
    t0 = time.perf_counter()
    _run_paged_generate(
        dummy,
        text_prompt,
        max_new_tokens=_AI_MAX_NEW_TOKENS_SINGLE,
        max_stones=1,
    )
    print(
        f"[VLM] PagedInferenceEngine warmup bitti ({time.perf_counter() - t0:.1f}s)",
        flush=True,
    )


def _ai_worker_thread():
    global _model, _tokenizer, _model_args, _engine, _device
    try:
        import torch
        from falcon_perception import load_and_prepare_model, setup_torch_config
        from falcon_perception.data import ImageProcessor
        from falcon_perception.paged_inference import (
            PagedInferenceEngine,
            engine_config_for_gpu,
        )

        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA kullanılabilir değil — NVIDIA sürücüsü / torch+cu wheel gerekli. "
                f"torch={torch.__version__}"
            )

        setup_torch_config()
        _set_ai_status("loading")
        model_id = _resolve_model_id()
        print(
            f"[VLM] Falcon-Perception CUDA yukleniyor "
            f"(model={model_id}, device={torch.cuda.get_device_name(0)}, "
            f"dtype={_AI_DTYPE}, engine=PagedInferenceEngine)...",
            flush=True,
        )
        logger.info(
            "Falcon-Perception CUDA yükleniyor (model=%s, device=%s, dtype=%s)...",
            model_id,
            torch.cuda.get_device_name(0),
            _AI_DTYPE,
        )
        _model, _tokenizer, _model_args = load_and_prepare_model(
            hf_model_id=model_id,
            backend="torch",
            dtype=_AI_DTYPE,
            compile=True,
            device="cuda",
        )
        _device = _model.device
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
                f"[VLM] WARNING: model dtype={_real_dtype} - fp16/bf16 degil, "
                "CUDA path sessizce fp32 kullanıyor olabilir (2x yavaslik).",
                flush=True,
            )

        image_processor = ImageProcessor(patch_size=16, merge_size=1)
        cfg = engine_config_for_gpu(
            max_image_size=_AI_IMG_MAX_DIM,
            device=_device,
            dtype=_model.dtype,
        )
        # max_seq_length page_size ile bölünmeli; server varsayılanı 8192.
        page_size = int(cfg.get("page_size", 128))
        max_seq = _AI_MAX_SEQ_LENGTH
        if max_seq % page_size != 0:
            max_seq = (max_seq // page_size) * page_size
        print(
            f"[VLM] PagedInferenceEngine cfg={{{', '.join(f'{k}={v}' for k, v in cfg.items())}}} "
            f"max_seq_length={max_seq}",
            flush=True,
        )
        _engine = PagedInferenceEngine(
            _model,
            _tokenizer,
            image_processor,
            max_seq_length=max_seq,
            capture_cudagraph=True,
            seed=42,
            **cfg,
        )

        _set_ai_status("warming_up")
        try:
            _run_compile_warmup()
        except Exception as warm_exc:
            print(f"[VLM] warmup uyarisi (devam): {warm_exc}", flush=True)
            logger.warning("VLM compile warmup failed: %s", warm_exc, exc_info=True)

        _set_ai_status("ready")
        free_gib = torch.cuda.mem_get_info()[0] / (1024 ** 3)
        print(
            f"[VLM] READY device={_device} vram_free={free_gib:.1f} GiB "
            f"(PagedInferenceEngine)",
            flush=True,
        )
        logger.info(
            "Falcon-Perception CUDA ready (device=%s, dtype=%s, vram=%.1f GiB free, paged)",
            _device,
            _real_dtype,
            free_gib,
        )
    except Exception as e:
        print(f"[VLM] ERROR worker init failed: {e}", flush=True)
        logger.error("AI Worker init failed: %s", e, exc_info=True)
        _set_ai_status("error")
        return

    while True:
        future, pil_image, text_prompt, max_new_tokens, max_stones = _ai_request_queue.get()
        if future is None:
            break
        try:
            print(
                f"[VLM] generate basliyor max_new_tokens={max_new_tokens} "
                f"max_stones={max_stones} task=detection engine=paged",
                flush=True,
            )
            tokens, aux_outputs, input_len, gen_sec, stats = _run_paged_generate(
                pil_image,
                text_prompt or "",
                max_new_tokens=max_new_tokens,
                max_stones=max_stones,
            )
            prefill_ms = getattr(stats, "prefill_ms", None) if stats else None
            decode_ms = getattr(stats, "decode_wall_ms", None) if stats else None
            finalize_ms = getattr(stats, "finalize_ms", None) if stats else None
            print(
                f"[TIMING] VLM generate: {gen_sec:.3f}s "
                f"input_len={input_len} max_new_tokens={max_new_tokens} "
                f"max_stones={max_stones} task=detection engine=paged "
                f"prefill_ms={prefill_ms} decode_ms={decode_ms} finalize_ms={finalize_ms}",
                flush=True,
            )
            print("[VLM] generate bitti", flush=True)
            if not future.done():
                # tokens = yalnizca generate edilen id'ler → format icin input_len=0
                future.set_result((tokens, aux_outputs, 0, gen_sec, stats))
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
