"""Silhouette: speküler taş gövdesi — Canny değil koyu blob."""
from __future__ import annotations

import cv2
import numpy as np

from app.vision.roi_segment import _roi_silhouette


def test_silhouette_ignores_specular_hotspot():
    """Açık zeminde koyu elips + parlak yansıma → kontür gövdeyi kapsar, noktayı değil."""
    frame = np.full((200, 200, 3), 210, dtype=np.uint8)
    cv2.ellipse(frame, (100, 100), (40, 22), 20, 0, 360, (35, 35, 35), -1)
    # Speküler nokta (Canny'nin yakaladığı tipik hata)
    cv2.circle(frame, (108, 92), 4, (250, 250, 250), -1)

    contour = _roi_silhouette(
        frame, 50, 70, 150, 130,
        own_center=(100.0, 100.0),
        other_centers=None,
    )
    assert contour is not None
    area = float(cv2.contourArea(contour))
    # Tam elips ~ π*40*22 ≈ 2765; speküler-only ~50 — gövdeye yakın olmalı
    assert area > 800
    # Merkez kontürün içinde
    assert cv2.pointPolygonTest(contour, (50.0, 30.0), False) >= 0  # ROI-lokal


def test_silhouette_separates_neighbor_with_voronoi():
    frame = np.full((160, 240, 3), 200, dtype=np.uint8)
    cv2.ellipse(frame, (70, 80), (28, 18), 0, 0, 360, (40, 40, 40), -1)
    cv2.ellipse(frame, (160, 80), (28, 18), 0, 0, 360, (40, 40, 40), -1)

    # Sol taş ROI — sağ komşu var
    bx1, by1, bx2, by2 = 30, 50, 120, 110
    h, w = by2 - by1, bx2 - bx1
    ys, xs = np.mgrid[by1:by2, bx1:bx2]
    own = (xs - 70) ** 2 + (ys - 80) ** 2
    other = (xs - 160) ** 2 + (ys - 80) ** 2
    vm = (own <= other).astype(np.uint8) * 255

    contour = _roi_silhouette(
        frame, bx1, by1, bx2, by2,
        own_center=(70.0, 80.0),
        other_centers=[(160.0, 80.0)],
        voronoi_mask=vm,
    )
    assert contour is not None
    # Kontür ROI-lokal; full-frame merkeze çevir
    full = contour.copy().astype(np.float32)
    full[:, 0, 0] += bx1
    full[:, 0, 1] += by1
    assert cv2.pointPolygonTest(full, (70.0, 80.0), False) >= 0
    # Komşu merkez dışarıda kalmalı
    assert cv2.pointPolygonTest(full, (160.0, 80.0), False) < 0
