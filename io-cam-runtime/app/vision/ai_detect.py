"""
AI Snapshot + OpenCV Hybrid Detection Module (app/vision/ai_detect.py)

Pipeline:
    1. Falcon-Perception detection → aux.materialize_bboxes() → [{xy, hw}, ...]
    2. Each bbox ROI → adaptive threshold → PCA/minAreaRect → angle
"""
from __future__ import annotations

import logging
import math
import math
import queue
import threading
import time
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

def _expand_to_360(contour: np.ndarray, base_angle: float) -> float:
    m = cv2.moments(contour)
    if m["m00"] == 0:
        return base_angle
    cx = m["m10"] / m["m00"]
    cy = m["m01"] / m["m00"]
    pts = contour.reshape(-1, 2)
    rad = math.radians(base_angle)
    nx, ny = math.cos(rad), math.sin(rad)
    signed = (pts[:, 0] - cx) * ny - (pts[:, 1] - cy) * nx
    if signed.sum() < 0:
        base_angle += 180.0
    return base_angle % 360.0

def contour_angle_deg(contour: np.ndarray, is_symmetric: bool = False) -> float:
    if contour.size < 6:
        return 0.0
    pts = contour.reshape(-1, 2).astype(np.float64)
    mean = pts.mean(axis=0)
    centered = pts - mean
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    major = eigvecs[:, int(np.argmax(eigvals))]
    angle = math.degrees(math.atan2(major[1], major[0]))
    if angle < 0:
        angle += 180.0
    if not is_symmetric:
        angle = _expand_to_360(contour, angle)
    return angle

logger = logging.getLogger("io_cam.ai_detect")

_AI_MODEL_PATH = "tiiuae/Falcon-Perception"
_model = None
_tokenizer = None
_model_args = None
_engine = None

_ai_status = "uninitialized"  # uninitialized, loading, warming_up, ready
_ai_request_queue = queue.Queue()
_ai_result_dict = {}
_worker_started = False

def _ai_worker_thread():
    global _model, _tokenizer, _model_args, _engine, _ai_status
    try:
        _ai_status = "loading"
        logger.info("Falcon-Perception weights loading in background...")
        from falcon_perception import load_and_prepare_model
        from falcon_perception.mlx.batch_inference import BatchInferenceEngine
        _model, _tokenizer, _model_args = load_and_prepare_model(hf_model_id=_AI_MODEL_PATH, backend="mlx", dtype="float16")
        _engine = BatchInferenceEngine(_model, _tokenizer)
        
        _ai_status = "warming_up"
        logger.info("Warming up MLX computation graphs (this takes ~30s)...")
        dummy_img = Image.new("RGB", (640, 480))
        from falcon_perception import build_prompt_for_task
        from falcon_perception.mlx.batch_inference import process_batch_and_generate
        dummy_prompt = build_prompt_for_task("stone", "detection")
        batch = process_batch_and_generate(
            _tokenizer,
            [(dummy_img, dummy_prompt)],
            max_length=_model_args.max_seq_len,
            min_dimension=256,
            max_dimension=768,
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
        req_id, batch = _ai_request_queue.get()
        if req_id is None: break
        try:
            tokens, aux_outputs = _engine.generate(**batch, max_new_tokens=100, task="detection")
            _ai_result_dict[req_id] = aux_outputs
        except Exception as e:
            _ai_result_dict[req_id] = e
        _ai_request_queue.task_done()

def get_ai_model():
    """Backward-compatible entry point used by other modules."""
    global _worker_started
    if not _worker_started:
        _worker_started = True
        threading.Thread(target=_ai_worker_thread, daemon=True).start()
    return _model, _tokenizer, _model_args


def _roi_angle(
    frame: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
    *,
    block_size: int = 31,
    c_val: int = 8,
    invert: bool = True,
    use_pca: bool = True,
    is_symmetric: bool = True,
) -> float:
    """Crop bbox, adaptive threshold, return orientation angle."""
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return 0.0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    mode = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
    bw = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, mode, block_size, c_val)
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kern)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kern)
    b = 3
    bw[:b, :] = 0; bw[-b:, :] = 0; bw[:, :b] = 0; bw[:, -b:] = 0
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 0.0
    c = max(contours, key=cv2.contourArea)
    if cv2.contourArea(c) < 20:
        return 0.0
    if use_pca:
        return contour_angle_deg(c.astype(np.float32), is_symmetric)
    return normalize_angle(cv2.minAreaRect(c))


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
) -> tuple[list[dict[str, Any]], np.ndarray, str]:
    out = frame.copy() if draw else frame
    objects: list[dict[str, Any]] = []

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
    pil_image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

    text_prompt = build_prompt_for_task(prompt, "detection")
    batch = process_batch_and_generate(
        _tokenizer,
        [(pil_image, text_prompt)],
        max_length=_model_args.max_seq_len,
        min_dimension=256,
        max_dimension=768,
        patch_size=_model_args.spatial_patch_size,
        merge_size=1,
    )
    
    # Submit to background thread and wait for result
    req_id = id(batch)
    _ai_request_queue.put((req_id, batch))
    while req_id not in _ai_result_dict:
        time.sleep(0.01)
        
    aux_outputs = _ai_result_dict.pop(req_id)
    if isinstance(aux_outputs, Exception):
        logger.error("AI Inference Error: %s", aux_outputs)
        return objects, out, text_prompt

    aux = aux_outputs[0]

    # ── Get bboxes from aux ─────────────────────────────────────
    # bboxes_raw is a flat alternating list: [{x,y}, {h,w}, {x,y}, {h,w}, ...]
    # We only need the {x,y} centers — skip size entirely, use fixed ROI radius.
    raw = getattr(aux, "bboxes_raw", []) or []
    centers = [item for item in raw if "x" in item and "y" in item]

    if not centers:
        print("[AI] No centers found")
        return objects, out, text_prompt

    # Fixed ROI half-size in pixels — big enough to cover a stone + a little margin
    roi_half = 40

    for i, xy in enumerate(centers, 1):
        cx = int(float(xy["x"]) * img_w)
        cy = int(float(xy["y"]) * img_h)

        x1 = max(0, cx - roi_half)
        y1 = max(0, cy - roi_half)
        x2 = min(img_w, cx + roi_half)
        y2 = min(img_h, cy + roi_half)

        angle = _roi_angle(
            frame, x1, y1, x2, y2,
            block_size=block_size, c_val=c_val,
            invert=invert_threshold, use_pca=use_pca_angle,
            is_symmetric=is_symmetric,
        )

        if draw:
            cv2.circle(out, (cx, cy), 5, COL_CENTER, -1)
            length = roi_half - 5
            rad = math.radians(angle)
            cv2.arrowedLine(
                out, (cx, cy),
                (int(cx + length * math.cos(rad)), int(cy + length * math.sin(rad))),
                COL_AXIS, 2, tipLength=0.2,
            )
            label = f"#{i}  {angle:.1f}\u00b0"
            tw, th = cv2.getTextSize(label, FONT, 0.56, 1)[0]
            lx, ly = cx - tw // 2, max(th + 6, cy - roi_half - 8)
            cv2.rectangle(out, (lx - 2, ly - th - 3), (lx + tw + 2, ly + 4), (0, 0, 0), -1)
            cv2.putText(out, label, (lx, ly), FONT, 0.56, (255, 255, 0), 1, cv2.LINE_AA)

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
) -> list[Stone]:
    from app.vision.calibration import load_homography, pixel_to_robot
    if homography is None and cal_dir is not None:
        homography = load_homography(cal_dir)

    is_symmetric = template.is_symmetric if hasattr(template, "is_symmetric") else True
    objects, _, _ = ai_snapshot_detect(frame, prompt="stone", draw=False, is_symmetric=is_symmetric)
    
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