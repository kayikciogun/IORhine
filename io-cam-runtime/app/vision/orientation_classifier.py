"""
orientation_classifier.py
==========================

Eğitilmiş ONNX modelini yükleyip her taş crop'u için orientation sınıfı tahmin eder.

Sınıflar (VisoLabel): true / false
Model dizini: ``io-cam-runtime/datasets/orientation_model_v2/``
  - orientation_model.onnx (+ .onnx.data)
  - class_names.json
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger("io_cam.orientation")

# io-cam-runtime/ — cwd'den bağımsız mutlak kök
# app/vision/orientation_classifier.py → parents[2] = io-cam-runtime
_RUNTIME_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_MODEL_DIR = _RUNTIME_ROOT / "datasets" / "orientation_model_v2"

_session: Any = None
_class_names: list[str] = []
_img_size = 128
_model_dir: Path | None = None
_load_failed = False

# ImageNet normalizasyonu — training ile aynı
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

# "true" yalnızca modelin yüksek emin olduğu durumlarda kabul edilir; altında
# kalan tahminler "false" sayılır (yanlış "true" pahalı — taş yanlış yöne
# yapıştırılır). "false" tarafı emniyetten bağımsız — az emin de olsa false
# kabul etmek daha güvenli (en kötü ihtimalle gereksiz çevirme).
_TRUE_CONFIDENCE_THRESHOLD = 0.7


def _resolve_model_dir(model_dir: Path | str | None = None) -> Path:
    if model_dir is not None:
        return Path(model_dir)
    try:
        from app.config.settings import settings

        return Path(settings.orientation_model_dir)
    except Exception:
        return _DEFAULT_MODEL_DIR


def reset_orientation_model() -> None:
    """Test / path değişimi için lazy-load önbelleğini temizle."""
    global _session, _class_names, _img_size, _model_dir, _load_failed
    _session = None
    _class_names = []
    _img_size = 128
    _model_dir = None
    _load_failed = False


def _load_orientation_model(model_dir: Path | str | None = None) -> bool:
    """ONNX modelini lazy-load eder. Başarısızsa False — orientation atlanır."""
    global _session, _class_names, _img_size, _model_dir, _load_failed
    if _session is not None:
        return True
    if _load_failed and model_dir is None:
        return False

    root = _resolve_model_dir(model_dir)
    model_path = root / "orientation_model.onnx"
    meta_path = root / "class_names.json"
    if not model_path.exists() or not meta_path.exists():
        logger.warning(
            "Orientation model bulunamadı (%s / %s) — sınıflandırma atlanacak.",
            model_path,
            meta_path,
        )
        _load_failed = True
        return False

    try:
        import onnxruntime as ort
    except ImportError:
        logger.warning(
            "onnxruntime kurulu değil — pip install onnxruntime-gpu "
            "(veya CPU: onnxruntime)"
        )
        _load_failed = True
        return False

    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    _class_names = list(meta["class_names"])
    _img_size = int(meta["img_size"])

    available = ort.get_available_providers()
    # Küçük 128² crop — CPU yeterli. Windows'ta CUDA EP çoğu kez cuDNN ister;
    # yoksa gürültülü fail. Önce CPU; olmazsa CUDA+CPU dene.
    tries: list[list[str]] = [["CPUExecutionProvider"]]
    if "CUDAExecutionProvider" in available:
        tries.append(["CUDAExecutionProvider", "CPUExecutionProvider"])

    last_err: Exception | None = None
    for providers in tries:
        try:
            _session = ort.InferenceSession(str(model_path), providers=providers)
            break
        except Exception as exc:
            last_err = exc
            logger.warning(
                "Orientation ONNX load providers=%s failed: %s", providers, exc
            )
            _session = None
    else:
        logger.error("Orientation model yüklenemedi: %s", last_err)
        _load_failed = True
        return False

    _model_dir = root
    _load_failed = False
    logger.info(
        "Orientation model yüklendi: dir=%s sınıflar=%s img_size=%d providers=%s",
        root,
        _class_names,
        _img_size,
        _session.get_providers(),
    )
    return True


def _preprocess_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """OpenCV BGR crop → (1, 3, H, W) float32, ImageNet normalize."""
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (_img_size, _img_size), interpolation=cv2.INTER_LINEAR)
    chw = resized.astype(np.float32).transpose(2, 0, 1) / 255.0
    normalized = (chw - _MEAN) / _STD
    return normalized[np.newaxis, ...].astype(np.float32)


def classify_orientation_onnx(
    frame: np.ndarray,
    bx1: int,
    by1: int,
    bx2: int,
    by2: int,
    *,
    model_dir: Path | str | None = None,
) -> tuple[str, float]:
    """VLM bbox crop → (orientation sınıfı, confidence).

    Model yoksa ``(\"uncertain\", 0.0)`` — çağıran açı-only davranışa düşer.
    """
    if not _load_orientation_model(model_dir):
        return "uncertain", 0.0

    h, w = frame.shape[:2]
    x1 = max(0, min(int(bx1), w))
    x2 = max(0, min(int(bx2), w))
    y1 = max(0, min(int(by1), h))
    y2 = max(0, min(int(by2), h))
    if x2 <= x1 or y2 <= y1:
        return "uncertain", 0.0

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return "uncertain", 0.0

    input_tensor = _preprocess_crop(crop)
    input_name = _session.get_inputs()[0].name
    output_name = _session.get_outputs()[0].name
    logits = _session.run([output_name], {input_name: input_tensor})[0][0]

    exp = np.exp(logits - np.max(logits))
    probs = exp / exp.sum()
    pred_idx = int(np.argmax(probs))
    confidence = float(probs[pred_idx])
    label = _class_names[pred_idx]

    # Düşük emniyetli "true" → "false"a düşür (yanlış true'nun maliyeti yüksek).
    if label == "true" and confidence < _TRUE_CONFIDENCE_THRESHOLD:
        return "false", confidence

    return label, confidence
