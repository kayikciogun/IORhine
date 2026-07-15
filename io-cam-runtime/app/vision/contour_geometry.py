"""
Contour geometry and angle calculation utilities (app/vision/contour_geometry.py)

Pure helper functions for PCA eigenvalue decomposition, minimum area rectangle
normalization, directed angle calculation, and filled contour point sampling.
"""
from __future__ import annotations

import math

import cv2
import numpy as np


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
