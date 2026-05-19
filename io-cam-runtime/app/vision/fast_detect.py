from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from app.config.runtime_store import get_vision

# web_angle.py / webcam_angle_test.py renkleri (BGR)
COL_BOX = (0, 220, 120)
COL_ANGLE = (0, 220, 255)
COL_CENTER = (0, 60, 255)
COL_AXIS = (0, 140, 255)
FONT = cv2.FONT_HERSHEY_SIMPLEX


def normalize_angle(rect: tuple) -> float:
    """
    minAreaRect → [0, 180) derece, uzun kenar baz alınır (web_angle.py).
    """
    angle = rect[2]
    w, h = rect[1]
    if w < h:
        angle += 90
    return angle % 180


def _draw_mask_inset(display: np.ndarray, mask: np.ndarray) -> None:
    """Sağ alt köşede küçük eşik maskesi (web_angle)."""
    h, w = display.shape[:2]
    bw_colored = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    bw_small = cv2.resize(bw_colored, (w // 4, h // 4))
    bh, bw2 = bw_small.shape[:2]
    y1, y2 = h - bh - 10, h - 10
    x1, x2 = w - bw2 - 10, w - 10
    display[y1:y2, x1:x2] = bw_small
    cv2.rectangle(display, (x1 - 1, y1 - 1), (x2, y2), COL_BOX, 1)
    cv2.putText(display, "esik", (x1, y1 - 6), FONT, 0.42, (230, 230, 230), 1, cv2.LINE_AA)


def process_frame(
    frame: np.ndarray,
    thresh_val: int,
    *,
    min_area: int = 600,
    max_area: int = 80000,
    blur_kernel: int = 9,
    draw: bool = True,
) -> tuple[list[dict[str, Any]], np.ndarray, np.ndarray]:
    """
    web_angle.process — gri, blur, eşik, kontur, minAreaRect çizimi.
    Döner: (objects, annotated_bgr, binary_mask).
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    k = blur_kernel | 1
    blur = cv2.GaussianBlur(gray, (k, k), 0)
    if thresh_val <= 0:
        _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    else:
        _, bw = cv2.threshold(blur, thresh_val, 255, cv2.THRESH_BINARY_INV)

    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = frame.copy() if draw else frame
    objects: list[dict[str, Any]] = []

    for i, c in enumerate(contours, 1):
        area = cv2.contourArea(c)
        if area < min_area or area > max_area:
            continue

        rect = cv2.minAreaRect(c)
        angle = normalize_angle(rect)
        cx, cy = int(rect[0][0]), int(rect[0][1])
        rw, rh = rect[1]

        if draw:
            box = cv2.boxPoints(rect).astype(np.int32)
            cv2.drawContours(out, [box], 0, COL_BOX, 2)

            half = int(max(rw, rh) / 2) + 12
            rad = math.radians(angle)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            p1 = (int(cx - half * cos_a), int(cy - half * sin_a))
            p2 = (int(cx + half * cos_a), int(cy + half * sin_a))
            cv2.line(out, p1, p2, COL_AXIS, 2)
            cv2.arrowedLine(out, p1, p2, COL_AXIS, 2, tipLength=0.2)
            cv2.circle(out, (cx, cy), 5, COL_CENTER, -1)

            label = f"#{i}  {angle:.1f}\u00b0"
            tw, th = cv2.getTextSize(label, FONT, 0.56, 1)[0]
            lx, ly = cx - tw // 2, cy - 16
            cv2.rectangle(out, (lx - 3, ly - th - 3), (lx + tw + 3, ly + 4), (0, 0, 0), -1)
            cv2.putText(out, label, (lx, ly), FONT, 0.56, COL_ANGLE, 1, cv2.LINE_AA)

        objects.append(
            {
                "id": i,
                "index": i,
                "x": float(cx),
                "y": float(cy),
                "cx": cx,
                "cy": cy,
                "angle": round(angle, 1),
                "w": round(float(rw), 1),
                "h": round(float(rh), 1),
                "area": round(float(area)),
                "score": 0.0,
            }
        )

    return objects, out, bw


def fast_detect(
    frame: np.ndarray,
    *,
    thresh_val: int | None = None,
    min_area: int | None = None,
    max_area: int | None = None,
    blur_kernel: int | None = None,
    show_mask: bool | None = None,
    draw: bool = True,
) -> tuple[list[dict[str, Any]], np.ndarray]:
    vis = get_vision()
    thr = thresh_val if thresh_val is not None else vis.fast_detect_threshold
    min_a = min_area if min_area is not None else vis.min_contour_area
    max_a = max_area if max_area is not None else vis.max_contour_area
    bk = blur_kernel if blur_kernel is not None else vis.blur_kernel
    mask_mode = show_mask if show_mask is not None else vis.show_mask

    objects, annotated, bw = process_frame(
        frame,
        thr,
        min_area=min_a,
        max_area=max_a,
        blur_kernel=bk,
        draw=draw,
    )

    display = cv2.cvtColor(bw, cv2.COLOR_GRAY2BGR) if mask_mode else annotated
    if mask_mode and draw:
        _draw_mask_inset(display, bw)
    elif draw and objects:
        cv2.putText(
            display,
            f"{len(objects)} nesne",
            (10, 24),
            FONT,
            0.55,
            (230, 230, 230),
            1,
            cv2.LINE_AA,
        )

    return objects, display


# Geriye uyumluluk
normalize_min_area_rect_angle = normalize_angle
