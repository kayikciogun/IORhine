"""
AI Snapshot + OpenCV Hybrid Detection Module (app/vision/ai_detect.py)

Pipeline:
    1. Falcon-Perception detection → aux.materialize_bboxes() → [{xy, hw}, ...]
    2. Each bbox ROI → adaptive threshold → PCA/minAreaRect → angle

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

_AI_MODEL_PATH = "tiiuae/Falcon-Perception"
# 0.6B model — 300M tespit kalitesi yetersizdi (0 nesne). 4-bit quantize
# falcon_perception tarafından desteklenmiyor (özel mimari). Hız optimizasyonu:
# tek taş → az token; çok taş → taş başına ~6 token + marj (üst sınır 60).
# max_dimension=512 (768 yerine).
_AI_MAX_NEW_TOKENS_CAP = 60
_AI_MAX_NEW_TOKENS_SINGLE = 20
_AI_IMG_MAX_DIM = 512
_AI_IMG_MIN_DIM = 256
_DEFAULT_MAX_STONES = 1
_model = None
_tokenizer = None
_model_args = None
_engine = None

_ai_status = "uninitialized"  # uninitialized, loading, warming_up, ready, error
# Worker kuyruğu: (Future, batch, max_new_tokens) üçlüleri. Worker thread tek tek işler.
# Future ile sonuç/exception güvenle iletilir; ``id(batch)`` ve busy-wait yok.
# ``maxsize=1`` ile backpressure: inference sürerken yeni batch kuyruğa giremez,
# çağıran ``put``'ta bloklanır → ws.py döngüsü otomatik throttle olur.
_ai_request_queue: "queue.Queue[tuple[Future | None, Any, int]]" = queue.Queue(maxsize=1)
_worker_started = False
# Inference sırasında yeni istek gelirse mevcut batch'in sonucunu paylaşmak için
# tek slot cache. Aynı anda birden fazla çağrı → bir tanesi çalışır, diğerleri
# bekleyip aynı sonucu paylaşır (dedup) yerine basit throttle tercih ettik:
# maxsize=1 zaten queue'yu dolduruyor, ikinci ``put`` block olur.
_ai_busy_lock = threading.Lock()


def _max_new_tokens_for(max_stones: int) -> int:
    """Taş sayısına göre decode bütçesi — tek taşta kısa generate = daha hızlı."""
    n = max(1, int(max_stones))
    if n <= 1:
        return _AI_MAX_NEW_TOKENS_SINGLE
    return min(_AI_MAX_NEW_TOKENS_CAP, 12 + n * 6)


def _detection_subject(prompt: str, max_stones: int) -> str:
    """Tek taş istenince VLM'e 'all stones' yerine tek nesne prompt'u ver."""
    defaultish = {"", "stone", "stones", "Locate all the stones.", "Locate all the stones"}
    if max_stones <= 1 and prompt.strip() in defaultish:
        return "single gemstone"
    return prompt


def _ai_worker_thread():
    global _model, _tokenizer, _model_args, _engine, _ai_status
    try:
        _ai_status = "loading"
        logger.info("Falcon-Perception weights loading in background...")
        from falcon_perception import load_and_prepare_model
        from falcon_perception.mlx.batch_inference import BatchInferenceEngine
        # dtype: float16 → bfloat16. MLX Apple Silicon'da bfloat16 daha verimli
        # (daha az precision loss ama aynı hız). 4-bit quantize falcon_perception
        # tarafından desteklenmiyor (load_from_hf_export_mlx sadece float16/bf16/f32).
        _model, _tokenizer, _model_args = load_and_prepare_model(hf_model_id=_AI_MODEL_PATH, backend="mlx", dtype="bfloat16")
        _engine = BatchInferenceEngine(_model, _tokenizer)

        _ai_status = "warming_up"
        logger.info("Warming up MLX computation graphs (this takes ~30s)...")
        dummy_img = Image.new("RGB", (640, 480))
        from falcon_perception import build_prompt_for_task
        from falcon_perception.mlx.batch_inference import process_batch_and_generate
        dummy_prompt = build_prompt_for_task("single stone", "detection")
        batch = process_batch_and_generate(
            _tokenizer,
            [(dummy_img, dummy_prompt)],
            max_length=_model_args.max_seq_len,
            min_dimension=_AI_IMG_MIN_DIM,
            max_dimension=_AI_IMG_MAX_DIM,
            patch_size=_model_args.spatial_patch_size,
            merge_size=1,
        )
        _engine.generate(**batch, max_new_tokens=10, task="detection")
        _engine.generate(**batch, max_new_tokens=2, task="detection")

        _ai_status = "ready"
        logger.info("Falcon-Perception ready and warmed up!")
    except Exception as e:
        logger.error("AI Worker init failed: %s", e)
        _ai_status = "error"
        return

    while True:
        future, batch, max_new_tokens = _ai_request_queue.get()
        if future is None:
            break
        try:
            tokens, aux_outputs = _engine.generate(
                **batch, max_new_tokens=max_new_tokens, task="detection"
            )
            if not future.done():
                future.set_result(aux_outputs)
        except Exception as e:
            if not future.done():
                future.set_exception(e)
        finally:
            _ai_request_queue.task_done()

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
    busy_timeout_s: float = 0.1,
    max_stones: int = _DEFAULT_MAX_STONES,
) -> tuple[list[dict[str, Any]], np.ndarray, str]:
    out = frame.copy() if draw else frame
    objects: list[dict[str, Any]] = []
    max_stones = max(1, int(max_stones))

    get_ai_model()  # Arka plan thread'ini baslatir (eger baslamamissa)

    if _ai_status != "ready":
        if draw:
            h, w = out.shape[:2]
            cv2.rectangle(out, (0, 0), (w, 80), (0, 0, 0), -1)
            cv2.putText(out, f"AI Model Status: {_ai_status.upper()} (Please wait...)", (20, 50), FONT, 1.2, (0, 255, 255), 3)
        return objects, out, ""

    from falcon_perception import build_prompt_for_task
    from falcon_perception.mlx.batch_inference import process_batch_and_generate

    img_h, img_w = frame.shape[:2]
    # Ön küçültme: 384px max_dimension'a kadar resize et. ``process_batch_and_generate``
    # kendi resize'ı yapsa bile, büyük numpy array → PIL → resize pahalı. Burada
    # cv2 (C++ optimize) ile küçült, PIL'e küçük array ver → ~2x preprocess hız.
    if max(img_h, img_w) > _AI_IMG_MAX_DIM:
        scale = _AI_IMG_MAX_DIM / max(img_h, img_w)
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)
        small = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
    else:
        scale = 1.0
        small = frame
    pil_image = Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))

    subject = _detection_subject(prompt, max_stones)
    text_prompt = build_prompt_for_task(subject, "detection")
    max_new_tokens = _max_new_tokens_for(max_stones)
    batch = process_batch_and_generate(
        _tokenizer,
        [(pil_image, text_prompt)],
        max_length=_model_args.max_seq_len,
        min_dimension=_AI_IMG_MIN_DIM,
        max_dimension=_AI_IMG_MAX_DIM,
        patch_size=_model_args.spatial_patch_size,
        merge_size=1,
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
            _ai_request_queue.put_nowait((future, batch, max_new_tokens))
        except queue.Full:
            return objects, out, text_prompt
    else:
        # Blocking put ama kısa timeout ile — uzun süredir doluysa yine de hata.
        try:
            _ai_request_queue.put((future, batch, max_new_tokens), timeout=busy_timeout_s)
        except queue.Full:
            logger.warning("AI queue dolu (busy) — put timeout %.1fs", busy_timeout_s)
            return objects, out, text_prompt
    # Sync bekleyici: ws.py / vision.py / job_runner hepsi sync context'te.
    # Async context'te çağıran ``await asyncio.wrap_future(future)`` tercih etmeli;
    # burada ``result(timeout)`` ile sonsuz bekleme yerine 30 sn deadline veriyoruz.
    try:
        aux_outputs = future.result(timeout=30.0)
    except Exception as exc:
        logger.error("AI Inference Error: %s", exc)
        return objects, out, text_prompt

    aux = aux_outputs[0]

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

    if not detections:
        logger.info("AI detection returned no centers")
        return objects, out, text_prompt

    for i, (xy, size) in enumerate(detections, 1):
        # VLM küçük görüntüden normalize (0-1) koordinat döndürür. Orijinal
        # görüntüye geri ölçekle. Eski kod ``float(xy["x"]) * img_w`` kullanıyordu
        # ama VLM koordinatları 0-1 normalize olduğu için ``img_w`` değil küçük
        # görüntünün genişliği ile çarpmak gerekir — ama normalize olduğu için
        # direkt orijinal boyutla çarp doğru olur.
        cx = int(float(xy["x"]) * img_w)
        cy = int(float(xy["y"]) * img_h)

        roi_half_x = 40
        roi_half_y = 40
        if size is not None:
            try:
                box_w = abs(float(size["w"])) * img_w
                box_h = abs(float(size["h"])) * img_h
                if box_w >= 4 and box_h >= 4:
                    roi_half_x = int(np.clip(box_w * 0.7, 24, 120))
                    roi_half_y = int(np.clip(box_h * 0.7, 24, 120))
            except (TypeError, ValueError):
                pass

        x1 = max(0, cx - roi_half_x)
        y1 = max(0, cy - roi_half_y)
        x2 = min(img_w, cx + roi_half_x)
        y2 = min(img_h, cy + roi_half_y)

        angle = _roi_angle(
            frame, x1, y1, x2, y2,
            thresh_val=thresh_val,
            block_size=block_size, c_val=c_val,
            invert=invert_threshold, use_pca=use_pca_angle,
            is_symmetric=is_symmetric,
        )

        if draw:
            cv2.circle(out, (cx, cy), 5, COL_CENTER, -1)
            length = max(10, min(roi_half_x, roi_half_y) - 5)
            rad = math.radians(angle)
            cv2.arrowedLine(
                out, (cx, cy),
                (int(cx + length * math.cos(rad)), int(cy + length * math.sin(rad))),
                COL_AXIS, 2, tipLength=0.2,
            )
            label = f"#{i}  {int(round(angle))}"
            tw, th = cv2.getTextSize(label, FONT, 0.4, 1)[0]
            lx, ly = cx - tw // 2, max(th + 6, cy - roi_half_y - 8)
            cv2.rectangle(out, (lx - 2, ly - th - 3), (lx + tw + 2, ly + 4), (0, 0, 0), -1)
            cv2.putText(out, label, (lx, ly), FONT, 0.4, (255, 255, 0), 1, cv2.LINE_AA)

        objects.append({
            "id": i, "index": i,
            "x": float(cx), "y": float(cy),
            "cx": cx, "cy": cy,
            "angle": round(angle, 1),
            "score": 1.0,
        })

    # For now just return — once we see the log output we'll parse correctly
    return objects, out, text_prompt

@dataclass
class Stone:
    x: float
    y: float
    angle: float
    score: float
    area: float = 0.0
    robot_x: float = 0.0
    robot_y: float = 0.0

def detect_all(
    frame: np.ndarray,
    template: Any,
    *,
    homography: np.ndarray | None = None,
    cal_dir=None,
    max_stones: int = _DEFAULT_MAX_STONES,
) -> list[Stone]:
    from app.vision.calibration import load_homography, pixel_to_robot
    if homography is None and cal_dir is not None:
        homography = load_homography(cal_dir)

    is_symmetric = template.is_symmetric if hasattr(template, "is_symmetric") else True
    objects, _, _ = ai_snapshot_detect(
        frame,
        prompt="stone",
        draw=False,
        is_symmetric=is_symmetric,
        max_stones=max_stones,
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
            robot_y=ry
        ))
    return stones