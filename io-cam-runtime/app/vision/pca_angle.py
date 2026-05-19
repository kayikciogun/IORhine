from __future__ import annotations

import math

import cv2
import numpy as np


def contour_angle_deg(contour: np.ndarray, is_symmetric: bool = False) -> float:
    """PCA major axis angle in degrees, [0, 180) or [0, 360) if asymmetric."""
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
        # Asymmetry: compare left/right half areas to flip into [0, 360)
        angle = _expand_to_360(contour, angle)
    return angle


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
