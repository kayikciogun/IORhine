from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.config.runtime_store import get_vision
from app.vision.calibration import load_homography, pixel_to_robot
from app.vision.pca_angle import contour_angle_deg
from app.vision.template_loader import StoneTemplate


@dataclass
class Stone:
    x: float
    y: float
    angle: float
    score: float
    area: float
    robot_x: float = 0.0
    robot_y: float = 0.0


def detect_all(
    frame: np.ndarray,
    template: StoneTemplate,
    *,
    homography: np.ndarray | None = None,
    cal_dir=None,
) -> list[Stone]:
    if homography is None and cal_dir is not None:
        homography = load_homography(cal_dir)

    vis = get_vision()
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    k = vis.blur_kernel | 1
    blurred = cv2.GaussianBlur(gray, (k, k), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    stones: list[Stone] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < vis.min_contour_area:
            continue
        norm = cnt.astype(np.float32)
        score = cv2.matchShapes(template.contour, norm, cv2.CONTOURS_MATCH_I1, 0)
        if score > vis.match_threshold:
            continue
        angle = contour_angle_deg(norm, template.is_symmetric)
        m = cv2.moments(cnt)
        if m["m00"] == 0:
            continue
        u = m["m10"] / m["m00"]
        v = m["m01"] / m["m00"]
        rx, ry = u, v
        if homography is not None:
            rx, ry = pixel_to_robot(u, v, homography)
        stones.append(
            Stone(
                x=u,
                y=v,
                angle=angle,
                score=float(score),
                area=float(area),
                robot_x=rx,
                robot_y=ry,
            )
        )
    return stones
