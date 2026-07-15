"""
AI Snapshot + OpenCV Hybrid Detection Module (app/vision/ai_detect.py)

Pipeline:
    1. Falcon-Perception (VLM, PyTorch/CUDA) → taş merkezleri + kaba boyut
    2. Her bbox ROI → adaptive threshold → PCA/minAreaRect → açı
    3. VLM bbox crop → ONNX ConvNeXt → orientation (true/false)

Hız: varsayılan ``max_stones=1`` → kısa prompt + düşük max_new_tokens (~20).
Çoklu tespit için ``max_stones`` yükselt.

Thread-safety: inference tek bir worker thread tarafından sırada işlenir.
Çağıranlar (ws.py / vision.py / job_runner) `concurrent.futures.Future` üzerinden
    senkron `future.result(timeout=...)` veya `await asyncio.wrap_future(future)` ile
bekler. Eski `id(batch)` + busy-wait `time.sleep(0.01)` mekanizması race-condition
yaratıyordu (Python `id()` GC sonrası reuse edebilir → iki batch aynı id'ye çarpışıp
birbirinin sonucunu okuyordu). Future ile bu risk yok; sonuç Future içine gömülü.
"""
from __future__ import annotations

import logging
import math
import queue
import threading
import time
from concurrent.futures import Future
from typing import Any
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

FONT = cv2.FONT_HERSHEY_SIMPLEX
COL_CENTER = (0, 60, 255)
COL_AXIS = (0, 140, 255)
COL_BBOX = (0, 255, 120)  # VLM bbox — yeşil
COL_LABEL = (255, 255, 0)  # true / default
COL_ORIENT_FALSE = (0, 0, 255)  # BGR kırmızı — false orientation
COL_ORIENT_TRUE = (0, 220, 0)  # BGR yeşil — true orientation

def normalize_angle(rect: tuple) -> float:
    angle = rect[2]
    w, h = rect[1]
    if w < h:
        angle += 90
    return angle % 180

def _angle_distance(a: float, b: float, period: float = 180.0) -> float:
    """İki eksen açısı arasındaki en küçük mutlak fark."""
    return abs((a - b + period / 2.0) % period - period / 2.0)


def _filled_contour_points(contour: np.ndarray) -> np.ndarray:
    """Konturun iç alanını örnekle; sınır noktası yoğunluğuna bağımlılığı kaldır."""
    x, y, w, h = cv2.boundingRect(contour.astype(np.int32))
    if w <= 0 or h <= 0:
        return np.empty((0, 2), dtype=np.float64)
    shifted = contour.astype(np.int32).copy()
    shifted[:, 0, 0] -= x
    shifted[:, 0, 1] -= y
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.drawContours(mask, [shifted], -1, 255, thickness=cv2.FILLED)
    ys, xs = np.nonzero(mask)
    return np.column_stack((xs + x, ys + y)).astype(np.float64)


def _directed_angle(
    points: np.ndarray,
    centroid: np.ndarray,
    axis: np.ndarray,
    base_angle: float,
) -> float:
    """Asimetrik şeklin sivri/uzun kuyruğunu üçüncü momentle yön olarak seç.

    İkinci moment yalnızca ekseni (0-180°) verir. Merkezlenmiş projeksiyonların
    kübik momenti ise hangi uçta daha uzun kuyruk bulunduğunu kararlı biçimde
    ayırır. Çok zayıf asimetride 360° yön fiziksel olarak belirlenemediği için
    deterministik canonical eksen korunur.
    """
    projections = (points - centroid) @ axis
    scale = float(np.sqrt(np.mean(projections * projections)))
    if scale <= 1e-9:
        return base_angle % 360.0
    skew = float(np.mean((projections / scale) ** 3))
    if abs(skew) < 0.025:
        return base_angle % 360.0
    if skew < 0:
        return (base_angle + 180.0) % 360.0
    return base_angle % 360.0

def contour_angle_deg(contour: np.ndarray, is_symmetric: bool = False) -> float:
    """Konturun kararlı ana eksen açısını görüntü koordinatlarında döndür.

    CHAIN_APPROX_SIMPLE sınır noktaları eşit aralıklı değildir; doğrudan bu
    noktalarla PCA yapmak küçük kontur değişimlerinde açıyı oynatır. Bu nedenle
    PCA, konturun doldurulmuş alanı üzerinde yapılır.
    """
    if contour.size < 6 or cv2.contourArea(contour) < 1.0:
        return 0.0
    points = _filled_contour_points(contour)
    if len(points) < 3:
        return 0.0
    centroid = points.mean(axis=0)
    centered = points - centroid
    cov = centered.T @ centered / len(centered)
    eigvals, eigvecs = np.linalg.eigh(cov)
    major = eigvecs[:, 1]
    if major[0] < 0 or (abs(major[0]) < 1e-12 and major[1] < 0):
        major = -major
    pca_angle = math.degrees(math.atan2(major[1], major[0])) % 180.0
    pca_rad = math.radians(pca_angle)
    major = np.array([math.cos(pca_rad), math.sin(pca_rad)], dtype=np.float64)

    # Kareye yakın şekillerde alan PCA'sının iki özdeğeri eşittir. Bu durumda
    # minimum alan dikdörtgeni kenar yönünü daha iyi temsil eder.
    anisotropy = float((eigvals[1] - eigvals[0]) / max(eigvals[1], 1e-9))
    rect_angle = normalize_angle(cv2.minAreaRect(contour.astype(np.float32)))
    if anisotropy < 0.08:
        angle = rect_angle
        rad = math.radians(angle)
        major = np.array([math.cos(rad), math.sin(rad)], dtype=np.float64)
    else:
        angle = pca_angle
        # PCA ve dikdörtgen aynı eksende ise küçük segmentasyon titreşimini azalt.
        if _angle_distance(pca_angle, rect_angle) < 12.0:
            delta = (rect_angle - pca_angle + 90.0) % 180.0 - 90.0
            angle = (pca_angle + 0.2 * delta) % 180.0
            rad = math.radians(angle)
            major = np.array([math.cos(rad), math.sin(rad)], dtype=np.float64)

    if is_symmetric:
        return angle % 180.0
    return _directed_angle(points, centroid, major, angle)

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
from app.vision.vlm_preprocess import (
    VLM_IMG_MAX_DIM as _AI_IMG_MAX_DIM,
    VLM_IMG_MIN_DIM as _AI_IMG_MIN_DIM,
    resize_for_vlm,
)
_DEFAULT_MAX_STONES = 1
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


def _roi_angle(
    frame: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
    *,
    thresh_val: int = 0,
    block_size: int = 31,
    c_val: int = 8,
    invert: bool = True,
    use_pca: bool = True,
    is_symmetric: bool = True,
) -> float:
    """ROI içindeki merkeze en uygun taşı segmentleyip açısını döndür."""
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return 0.0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    h, w = gray.shape[:2]
    roi_area = float(h * w)
    if roi_area <= 0:
        return 0.0

    max_block = min(h, w)
    if max_block % 2 == 0:
        max_block -= 1
    adaptive_block = max(3, min(int(block_size) | 1, max_block))
    preferred = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
    opposite = cv2.THRESH_BINARY if invert else cv2.THRESH_BINARY_INV
    masks: list[tuple[np.ndarray, float]] = []
    masks.append((
        cv2.adaptiveThreshold(
            blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            preferred, adaptive_block, c_val,
        ),
        0.35,
    ))
    _, otsu = cv2.threshold(blur, 0, 255, preferred | cv2.THRESH_OTSU)
    masks.append((otsu, 0.2))
    if thresh_val > 0:
        _, fixed = cv2.threshold(blur, int(thresh_val), 255, preferred)
        masks.append((fixed, 0.3))
    # Yanlış polarity ayarında dahi taş kaybolmasın; merkez ve sınır skoru
    # ters maskenin büyük arka plan konturunu eler.
    _, opposite_otsu = cv2.threshold(blur, 0, 255, opposite | cv2.THRESH_OTSU)
    masks.append((opposite_otsu, 0.0))

    kernel_size = 3 if min(h, w) < 70 else 5
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
    )
    roi_center = np.array([w / 2.0, h / 2.0])
    diagonal = math.hypot(w, h)
    best_contour: np.ndarray | None = None
    best_score = -math.inf

    for mask, polarity_bonus in masks:
        cleaned = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(
            cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        for contour in contours:
            area = float(cv2.contourArea(contour))
            area_ratio = area / roi_area
            if area < max(20.0, roi_area * 0.008) or area_ratio > 0.82:
                continue
            moments = cv2.moments(contour)
            if moments["m00"] <= 0:
                continue
            centroid = np.array([
                moments["m10"] / moments["m00"],
                moments["m01"] / moments["m00"],
            ])
            center_distance = float(np.linalg.norm(centroid - roi_center)) / diagonal
            if center_distance > 0.42:
                continue
            bx, by, bw, bh = cv2.boundingRect(contour)
            touches_border = int(bx <= 1) + int(by <= 1)
            touches_border += int(bx + bw >= w - 1) + int(by + bh >= h - 1)
            hull_area = float(cv2.contourArea(cv2.convexHull(contour)))
            solidity = area / max(hull_area, 1.0)
            contains_center = cv2.pointPolygonTest(
                contour, (float(roi_center[0]), float(roi_center[1])), False
            ) >= 0
            score = (
                polarity_bonus
                + (1.5 if contains_center else 0.0)
                + min(area_ratio, 0.35) * 2.0
                + solidity * 0.4
                - center_distance * 4.0
                - touches_border * 0.55
            )
            if score > best_score:
                best_score = score
                best_contour = contour

    if best_contour is None:
        return 0.0
    if use_pca:
        return contour_angle_deg(best_contour.astype(np.float32), is_symmetric)
    return normalize_angle(cv2.minAreaRect(best_contour))


def ai_snapshot_detect(
    frame: np.ndarray,
    prompt: str = "stone",
    *,
    thresh_val: int = 0,
    invert_threshold: bool = True,
    use_pca_angle: bool = True,
    is_symmetric: bool = True,
    draw: bool = True,
    block_size: int = 31,
    c_val: int = 8,
    skip_if_busy: bool = False,
    busy_timeout_s: float = 60.0,
    max_stones: int = _DEFAULT_MAX_STONES,
) -> tuple[list[dict[str, Any]], np.ndarray, str]:
    t0 = time.perf_counter()
    out = frame.copy() if draw else frame
    objects: list[dict[str, Any]] = []
    max_stones = max(1, int(max_stones))

    get_ai_model()  # Arka plan thread'ini baslatir (eger baslamamissa)

    if _ai_status != "ready":
        print(f"[VLM] skip — status={_ai_status} (henuz hazir degil)", flush=True)
        if draw:
            h, w = out.shape[:2]
            cv2.rectangle(out, (0, 0), (w, 80), (0, 0, 0), -1)
            cv2.putText(out, f"AI Model Status: {_ai_status.upper()} (Please wait...)", (20, 50), FONT, 1.2, (0, 255, 255), 3)
        return objects, out, ""

    from falcon_perception import build_prompt_for_task
    from falcon_perception.batch_inference import process_batch_and_generate

    # Ön küçültme: ``process_batch_and_generate`` öncesi cv2 ile küçült (dataset ile aynı).
    t_pre0 = time.perf_counter()
    small, _, _, _ = resize_for_vlm(frame, max_dim=_AI_IMG_MAX_DIM)
    pil_image = Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))

    subject = (prompt or "").strip() or "stone"
    text_prompt = build_prompt_for_task(subject, "detection")
    max_new_tokens = _max_new_tokens_for(max_stones)
    max_length = min(4096, int(getattr(_model_args, "max_seq_len", 4096)))
    batch = process_batch_and_generate(
        _tokenizer,
        [(pil_image, text_prompt)],
        max_length=max_length,
        min_dimension=_AI_IMG_MIN_DIM,
        max_dimension=_AI_IMG_MAX_DIM,
    )
    t_pre1 = time.perf_counter()
    print(
        f"[TIMING] preprocess: {t_pre1 - t_pre0:.3f}s "
        f"(task=detection max_new_tokens={max_new_tokens} max_stones={max_stones})",
        flush=True,
    )

    # Submit to background thread and wait for result via Future.
    # Eski ``id(batch)`` + busy-wait ``time.sleep(0.01)`` race-condition'ydı:
    # Python ``id()`` GC sonrası reuse edebilir, iki batch aynı id'ye çarpışıp
    # birbirinin sonucunu okuyordu. Future ile tek sonuç-gönderim garantili.
    # ``queue.Queue(maxsize=1)`` backpressure: inference sürerken ikinci batch
    # kuyruğa giremez → ``put`` block olur → çağıran throttle edilir.
    #
    # ``skip_if_busy``: ws.py canlı stream yolunda inference sürüyorsa bu frame'i
    # atla (sonraki frame'yi bekle). Snapshot-detect (kullanıcı butonu) ise
    # ``skip_if_busy=False`` → meşgul olsa da sıraya girip bekler.
    future: "Future[Any]" = Future()
    if skip_if_busy:
        # Non-blocking put: queue doluysa ``queue.Full`` → bu frame atlanır.
        try:
            _ai_request_queue.put_nowait((future, batch, max_new_tokens, max_stones))
        except queue.Full:
            return objects, out, text_prompt
    else:
        # Blocking put — snapshot/job için önceki iş bitsin (varsayılan 60s).
        try:
            _ai_request_queue.put(
                (future, batch, max_new_tokens, max_stones),
                timeout=busy_timeout_s,
            )
        except queue.Full:
            print(
                f"[VLM] skip — AI queue dolu (busy timeout {busy_timeout_s:.1f}s)",
                flush=True,
            )
            logger.warning("AI queue dolu (busy) — put timeout %.1fs", busy_timeout_s)
            raise RuntimeError(
                f"AI meşgul — {busy_timeout_s:.0f}s içinde sıraya giremedi. "
                "Önceki analizi bekleyip tekrar deneyin."
            )
    # Sync bekleyici: ws.py / vision.py / job_runner hepsi sync context'te.
    # Async context'te çağıran ``await asyncio.wrap_future(future)`` tercih etmeli.
    # İlk torch.compile 30 sn'yi kolay aşar → 180 sn (sonraki istekler hızlı biter).
    t_wait0 = time.perf_counter()
    try:
        result = future.result(timeout=180.0)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        print(f"[VLM] AI Inference Error: {err}", flush=True)
        logger.error("AI Inference Error: %s", err, exc_info=True)
        return objects, out, text_prompt
    t_wait1 = time.perf_counter()

    worker_gen_sec = -1.0
    if isinstance(result, tuple) and len(result) == 4:
        tokens, aux_outputs, input_len, worker_gen_sec = result
    elif isinstance(result, tuple) and len(result) == 3:
        tokens, aux_outputs, input_len = result
    elif isinstance(result, tuple) and len(result) == 2:
        tokens, aux_outputs = result
        input_len = 0
    else:
        # Eski worker sonucu (sadece aux) — güvenlik
        tokens, aux_outputs, input_len = None, result, 0

    wait_sec = t_wait1 - t_wait0

    t_parse0 = time.perf_counter()
    vlm_reply, gen_ids = _format_vlm_tokens(tokens, input_len=input_len)
    aux = aux_outputs[0]
    n_tok = len(gen_ids)
    ms_per = (worker_gen_sec * 1000.0 / n_tok) if n_tok > 0 and worker_gen_sec >= 0 else 0.0
    print(
        f"[TIMING] VLM wait+generate: {wait_sec:.3f}s "
        f"(worker_generate={worker_gen_sec:.3f}s "
        f"gen_tokens={n_tok} ~{ms_per:.1f}ms/token incl.prefill)",
        flush=True,
    )

    # ── Get bboxes from aux ─────────────────────────────────────
    # bboxes_raw is a flat alternating list: [{x,y}, {h,w}, {x,y}, {h,w}, ...].
    # Boyutu kullanmak sabit 40 px ROI'nin büyük taşı kesmesini veya küçük taşta
    # gereksiz arka plan toplamasını önler.
    raw = getattr(aux, "bboxes_raw", []) or []
    detections: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
    for raw_index, item in enumerate(raw):
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            continue
        size = None
        if raw_index + 1 < len(raw):
            candidate = raw[raw_index + 1]
            if isinstance(candidate, dict) and "h" in candidate and "w" in candidate:
                size = candidate
        detections.append((item, size))
    # Model yine fazla döndürebilir — decode erken bitsin diye token kısıtlı;
    # güvenlik ağı olarak üst sınırı uygula.
    detections = detections[:max_stones]
    t_parse1 = time.perf_counter()
    print(
        f"[TIMING] bbox parse: {t_parse1 - t_parse0:.3f}s "
        f"gen_tokens={len(gen_ids)} boxes={len(detections)}",
        flush=True,
    )

    _vlog(
        "max_new_tokens=%d gen_tokens=%d subject=%r objects_cap=%d early_stop_seg=%s",
        max_new_tokens,
        len(gen_ids),
        subject,
        max_stones,
        max_stones <= 1,
    )
    _vlog("gen_ids=%s", "[" + ", ".join(str(i) for i in gen_ids) + "]")
    _vlog("cevap=%s", vlm_reply)
    _vlog("bboxes_raw=%s", _format_bboxes_raw(raw))
    _vlog("bbox_keep=%d", len(detections))

    if not detections:
        t_end = time.perf_counter()
        total = t_end - t0
        print(
            f"[TIMING] TOPLAM: {total:.3f}s ({(1.0 / total) if total > 0 else 0.0:.2f} FPS) "
            f"(0 stone — VLM/preprocess dominant)",
            flush=True,
        )
        _vlog("AI detection returned no centers")
        return objects, out, vlm_reply

    img_h, img_w = frame.shape[:2]
    from app.vision.orientation_classifier import classify_orientation_onnx

    angle_total = 0.0
    classify_total = 0.0
    for i, (xy, size) in enumerate(detections, 1):
        # VLM küçük görüntüden normalize (0-1) koordinat döndürür. Orijinal
        # görüntüye geri ölçekle.
        cx = int(float(xy["x"]) * img_w)
        cy = int(float(xy["y"]) * img_h)

        # VLM bbox (tam boyut) — çizim + object meta
        box_w = 80.0
        box_h = 80.0
        if size is not None:
            try:
                bw = abs(float(size["w"])) * img_w
                bh = abs(float(size["h"])) * img_h
                if bw >= 4 and bh >= 4:
                    box_w, box_h = bw, bh
            except (TypeError, ValueError):
                pass

        bx1 = max(0, int(round(cx - box_w / 2)))
        by1 = max(0, int(round(cy - box_h / 2)))
        bx2 = min(img_w, int(round(cx + box_w / 2)))
        by2 = min(img_h, int(round(cy + box_h / 2)))

        # Açı ROI: bbox'tan biraz geniş/dar (önceki davranış)
        roi_half_x = int(np.clip(box_w * 0.7, 24, 120))
        roi_half_y = int(np.clip(box_h * 0.7, 24, 120))
        x1 = max(0, cx - roi_half_x)
        y1 = max(0, cy - roi_half_y)
        x2 = min(img_w, cx + roi_half_x)
        y2 = min(img_h, cy + roi_half_y)

        t_a = time.perf_counter()
        angle = _roi_angle(
            frame, x1, y1, x2, y2,
            thresh_val=thresh_val,
            block_size=block_size, c_val=c_val,
            invert=invert_threshold, use_pca=use_pca_angle,
            is_symmetric=is_symmetric,
        )
        t_b = time.perf_counter()

        # Yön: VLM'in verdiği tam bbox crop → ONNX classifier
        orientation, orient_conf = classify_orientation_onnx(
            frame, bx1, by1, bx2, by2,
        )
        t_c = time.perf_counter()
        angle_sec = t_b - t_a
        classify_sec = t_c - t_b
        angle_total += angle_sec
        classify_total += classify_sec
        print(
            f"[TIMING] stone {i}: angle={angle_sec:.3f}s classify={classify_sec:.3f}s",
            flush=True,
        )
        _vlog(
            "stone#%d cx=%d cy=%d angle=%.1f orient=%s conf=%.2f",
            i, cx, cy, angle, orientation, orient_conf,
        )

        if draw:
            # VLM hesaplanan bbox
            cv2.rectangle(out, (bx1, by1), (bx2, by2), COL_BBOX, 2)
            cv2.circle(out, (cx, cy), 5, COL_CENTER, -1)
            length = max(10, min(int(box_w), int(box_h)) // 2 - 5)
            rad = math.radians(angle)
            cv2.arrowedLine(
                out, (cx, cy),
                (int(cx + length * math.cos(rad)), int(cy + length * math.sin(rad))),
                COL_AXIS, 2, tipLength=0.2,
            )
            orient_tag = orientation if orientation != "uncertain" else "?"
            label = f"#{i}  {int(round(angle))}  {orient_tag}"
            tw, th = cv2.getTextSize(label, FONT, 0.4, 1)[0]
            lx, ly = cx - tw // 2, max(th + 6, by1 - 6)
            cv2.rectangle(out, (lx - 2, ly - th - 3), (lx + tw + 2, ly + 4), (0, 0, 0), -1)
            if orientation == "false":
                label_color = COL_ORIENT_FALSE
            elif orientation == "true":
                label_color = COL_ORIENT_TRUE
            else:
                label_color = COL_LABEL
            cv2.putText(out, label, (lx, ly), FONT, 0.4, label_color, 1, cv2.LINE_AA)

        objects.append({
            "id": i, "index": i,
            "x": float(cx), "y": float(cy),
            "cx": cx, "cy": cy,
            "w": int(round(box_w)),
            "h": int(round(box_h)),
            "area": int(round(box_w * box_h)),
            "angle": round(angle, 1),
            "orientation": orientation,
            "orientation_confidence": round(orient_conf, 3),
            "score": round(orient_conf, 3) if orientation != "uncertain" else 1.0,
        })

    t_end = time.perf_counter()
    total = t_end - t0
    post_sec = angle_total + classify_total
    print(
        f"[TIMING] postprocess: angle_sum={angle_total:.3f}s "
        f"classify_sum={classify_total:.3f}s ({len(detections)} stones)",
        flush=True,
    )
    print(
        f"[TIMING] TOPLAM: {total:.3f}s ({(1.0 / total) if total > 0 else 0.0:.2f} FPS) "
        f"| pre={t_pre1 - t_pre0:.3f}s vlm={worker_gen_sec:.3f}s "
        f"wait={wait_sec:.3f}s post={post_sec:.3f}s",
        flush=True,
    )
    return objects, out, vlm_reply

@dataclass
class Stone:
    x: float
    y: float
    angle: float
    score: float
    area: float = 0.0
    robot_x: float = 0.0
    robot_y: float = 0.0
    orientation: str = "uncertain"  # true | false | uncertain
    orientation_confidence: float = 0.0

def detect_all(
    frame: np.ndarray,
    template: Any,
    *,
    homography: np.ndarray | None = None,
    cal_dir=None,
    max_stones: int | None = None,
) -> list[Stone]:
    from app.config.settings import load_settings
    from app.vision.calibration import load_homography, pixel_to_robot
    if homography is None and cal_dir is not None:
        homography = load_homography(cal_dir)

    live = load_settings()
    stones_limit = max_stones if max_stones is not None else live.vlm_max_stones
    is_symmetric = template.is_symmetric if hasattr(template, "is_symmetric") else True
    objects, _, _ = ai_snapshot_detect(
        frame,
        prompt=live.vlm_prompt,
        draw=False,
        is_symmetric=is_symmetric,
        max_stones=stones_limit,
    )
    
    stones = []
    for obj in objects:
        rx, ry = float(obj["cx"]), float(obj["cy"])
        if homography is not None:
            rx, ry = pixel_to_robot(obj["cx"], obj["cy"], homography)
        stones.append(Stone(
            x=float(obj["cx"]),
            y=float(obj["cy"]),
            angle=obj["angle"],
            score=obj["score"],
            area=obj.get("area", 0.0),
            robot_x=rx,
            robot_y=ry,
            orientation=str(obj.get("orientation", "uncertain")),
            orientation_confidence=float(obj.get("orientation_confidence", 0.0)),
        ))
    return stones