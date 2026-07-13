"""VLM'e giden görüntü ön-işleme — ``ai_detect`` ile aynı boyutlandırma."""
from __future__ import annotations

import cv2
import numpy as np

# ai_detect._AI_IMG_MAX_DIM / _AI_IMG_MIN_DIM ile senkron tut
VLM_IMG_MAX_DIM = 512
VLM_IMG_MIN_DIM = 256


def resize_for_vlm(
    frame: np.ndarray,
    *,
    max_dim: int = VLM_IMG_MAX_DIM,
) -> tuple[np.ndarray, float, tuple[int, int], tuple[int, int]]:
    """Uzun kenarı ``max_dim``'e indir (INTER_AREA). Upscale yok.

    Returns:
        (bgr_frame, scale, (orig_w, orig_h), (new_w, new_h))
    """
    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError(f"BGR 3-kanal bekleniyor, shape={frame.shape!r}")

    img_h, img_w = frame.shape[:2]
    orig = (img_w, img_h)

    if max(img_h, img_w) <= max_dim:
        return frame.copy(), 1.0, orig, orig

    scale = max_dim / max(img_h, img_w)
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)
    small = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return small, scale, orig, (new_w, new_h)
