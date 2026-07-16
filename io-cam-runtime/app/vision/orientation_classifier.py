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
import time
from concurrent.futures import ThreadPoolExecutor
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
# CLAHE/OpenCV GIL bırakır → ThreadPool gerçek paralellik verir.
_PREPROCESS_WORKERS = 4
_preprocess_pool: ThreadPoolExecutor | None = None

# ImageNet normalizasyonu — training ile aynı
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

# Train_orientation._CLAHETransform ile aynı parametreler — train/infer parity.
_CLAHE_CLIP = 2.5
_CLAHE_TILE = (8, 8)

# Asimetrik emniyet: yanlış "true" pahalı (taş yanlış yöne yapıştırılır),
# yanlış "false" daha ucuz (gereksiz çevirme). Training class-weight'leriyle
# değil inference threshold ile kontrol edilir — yeniden eğitmeden ayarlanır.
_TRUE_CONFIDENCE_THRESHOLD = 0.80   # true demek için yüksek emin ol
_FALSE_CONFIDENCE_THRESHOLD = 0.50  # false demek için daha az emin yeterli


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


def preload_orientation_model(model_dir: Path | str | None = None) -> bool:
    """Startup'ta ONNX session'ı yükle — ilk tespit anında lazy-load gecikmesini önler."""
    return _load_orientation_model(model_dir)


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
        # ORT 1.20.x'te preload_dlls yok; PyTorch'u önce import etmek,
        # torch/lib altındaki CUDA 12 + cuDNN 9 DLL'lerini process'e yükler.
        import torch  # noqa: F401
        import onnxruntime as ort
        try:
            # Windows'ta ORT CUDA EP, PyTorch'un bundled CUDA/cuDNN DLL'lerini
            # PATH'te görmeyebilir. ORT 1.21+ bu DLL'leri preload edebiliyor.
            preload = getattr(ort, "preload_dlls", None)
            if preload is not None:
                preload()
        except Exception as preload_exc:
            logger.warning("ONNX Runtime DLL preload atlandı: %s", preload_exc)
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
    print(f"[ONNX] available providers: {available}", flush=True)
    # Küçük 128² crop olsa bile 9-10 taş batch inference CPU'da ~100ms olabiliyor.
    # CUDA EP varsa önce onu dene; başarısız olursa CPU güvenli fallback.
    tries: list[list[str]] = []
    if "CUDAExecutionProvider" in available:
        tries.append(["CUDAExecutionProvider", "CPUExecutionProvider"])
    tries.append(["CPUExecutionProvider"])

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
    print(f"[ONNX] session providers: {_session.get_providers()}", flush=True)
    return True


def _normalize_lighting(bgr: np.ndarray) -> np.ndarray:
    """CLAHE — Train_orientation._CLAHETransform ile aynı clip/tile."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=_CLAHE_CLIP, tileGridSize=_CLAHE_TILE)
    merged = cv2.merge([clahe.apply(l), a, b])
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def _preprocess_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """OpenCV BGR crop → resize → CLAHE → (3, H, W) float32 ImageNet.

    Sıra Train_orientation val_tf ile aynı: Resize → CLAHE (train/infer parity).
    Batch stack için batch boyutu eklenmez.
    """
    resized = cv2.resize(crop_bgr, (_img_size, _img_size), interpolation=cv2.INTER_LINEAR)
    lit = _normalize_lighting(resized)
    rgb = cv2.cvtColor(lit, cv2.COLOR_BGR2RGB)
    chw = rgb.astype(np.float32).transpose(2, 0, 1) / 255.0
    return ((chw - _MEAN) / _STD).astype(np.float32)


def _get_preprocess_pool() -> ThreadPoolExecutor:
    global _preprocess_pool
    if _preprocess_pool is None:
        _preprocess_pool = ThreadPoolExecutor(max_workers=_PREPROCESS_WORKERS)
    return _preprocess_pool


def _preprocess_crops(crops: list[np.ndarray]) -> list[np.ndarray]:
    """CLAHE+resize — N>=2 ise thread pool (OpenCV GIL serbest)."""
    if len(crops) <= 1:
        return [_preprocess_crop(c) for c in crops]
    return list(_get_preprocess_pool().map(_preprocess_crop, crops))


def _logits_to_label(
    logits: np.ndarray,
    *,
    true_confidence_threshold: float,
    false_confidence_threshold: float,
) -> tuple[str, float]:
    exp = np.exp(logits - np.max(logits))
    probs = exp / exp.sum()
    pred_idx = int(np.argmax(probs))
    confidence = float(probs[pred_idx])
    pred_class = _class_names[pred_idx]

    if pred_class == "true" and confidence < true_confidence_threshold:
        return "uncertain", confidence
    if pred_class == "false" and confidence < false_confidence_threshold:
        return "uncertain", confidence
    return pred_class, confidence


def _clip_box(
    frame: np.ndarray, bx1: int, by1: int, bx2: int, by2: int
) -> tuple[int, int, int, int] | None:
    h, w = frame.shape[:2]
    x1 = max(0, min(int(bx1), w))
    x2 = max(0, min(int(bx2), w))
    y1 = max(0, min(int(by1), h))
    y2 = max(0, min(int(by2), h))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def classify_orientations_batch(
    frame: np.ndarray,
    boxes: list[tuple[int, int, int, int]],
    *,
    model_dir: Path | str | None = None,
    true_confidence_threshold: float = _TRUE_CONFIDENCE_THRESHOLD,
    false_confidence_threshold: float = _FALSE_CONFIDENCE_THRESHOLD,
) -> list[tuple[str, float]]:
    """Birden fazla VLM bbox → tek ``session.run`` (N,3,H,W).

    Boş / geçersiz crop'lar ``(\"uncertain\", 0.0)``; model yoksa hepsi uncertain.
    """
    n = len(boxes)
    if n == 0:
        return []
    if not _load_orientation_model(model_dir):
        return [("uncertain", 0.0)] * n

    t_crop0 = time.perf_counter()
    crops: list[np.ndarray] = []
    valid_idx: list[int] = []
    for i, (bx1, by1, bx2, by2) in enumerate(boxes):
        clipped = _clip_box(frame, bx1, by1, bx2, by2)
        if clipped is None:
            continue
        x1, y1, x2, y2 = clipped
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        crops.append(crop)
        valid_idx.append(i)
    t_crop1 = time.perf_counter()

    results: list[tuple[str, float]] = [("uncertain", 0.0)] * n
    if not valid_idx:
        return results

    t_pre0 = time.perf_counter()
    preprocessed = _preprocess_crops(crops)
    t_pre1 = time.perf_counter()

    batch = np.stack(preprocessed, axis=0)  # (N, 3, H, W)
    t_stack1 = time.perf_counter()

    input_name = _session.get_inputs()[0].name
    output_name = _session.get_outputs()[0].name
    logits_batch = _session.run([output_name], {input_name: batch})[0]
    t_inf1 = time.perf_counter()

    print(
        f"[CLASSIFY_DEBUG] n={len(crops)} "
        f"crop={t_crop1 - t_crop0:.4f}s "
        f"preprocess={t_pre1 - t_pre0:.4f}s "
        f"stack={t_stack1 - t_pre1:.4f}s "
        f"inference={t_inf1 - t_stack1:.4f}s "
        f"workers={_PREPROCESS_WORKERS if len(crops) > 1 else 1}",
        flush=True,
    )

    for j, i in enumerate(valid_idx):
        results[i] = _logits_to_label(
            logits_batch[j],
            true_confidence_threshold=true_confidence_threshold,
            false_confidence_threshold=false_confidence_threshold,
        )
    return results


def classify_orientation_onnx(
    frame: np.ndarray,
    bx1: int,
    by1: int,
    bx2: int,
    by2: int,
    *,
    model_dir: Path | str | None = None,
    true_confidence_threshold: float = _TRUE_CONFIDENCE_THRESHOLD,
    false_confidence_threshold: float = _FALSE_CONFIDENCE_THRESHOLD,
) -> tuple[str, float]:
    """VLM bbox crop → (orientation sınıfı, confidence). Tek-kutu sarmalayıcı."""
    return classify_orientations_batch(
        frame,
        [(bx1, by1, bx2, by2)],
        model_dir=model_dir,
        true_confidence_threshold=true_confidence_threshold,
        false_confidence_threshold=false_confidence_threshold,
    )[0]
