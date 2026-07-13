import math

import cv2
import numpy as np

from app.vision.ai_detect import _roi_angle, contour_angle_deg


def _angle_error(actual: float, expected: float, period: float) -> float:
    return abs((actual - expected + period / 2.0) % period - period / 2.0)


def test_contour_angle_tracks_rotated_ellipse():
    for expected in (0, 15, 45, 89, 120, 165):
        mask = np.zeros((160, 160), dtype=np.uint8)
        cv2.ellipse(mask, (80, 80), (38, 14), expected, 0, 360, 255, -1)
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        actual = contour_angle_deg(contours[0].astype(np.float32), True)

        assert _angle_error(actual, expected, 180.0) < 1.0


def test_asymmetric_contour_does_not_flip_180_degrees():
    triangle = np.array(
        [[-35, -22], [-35, 22], [42, 0]], dtype=np.float32
    )
    for expected in (0, 45, 120, 225, 315):
        radians = math.radians(expected)
        rotation = np.array(
            [
                [math.cos(radians), -math.sin(radians)],
                [math.sin(radians), math.cos(radians)],
            ]
        )
        contour = (triangle @ rotation.T + 80).astype(np.float32).reshape(-1, 1, 2)

        actual = contour_angle_deg(contour, False)

        assert _angle_error(actual, expected, 360.0) < 1.0


def test_roi_angle_is_stable_with_noise_and_off_center_distractor():
    rng = np.random.default_rng(42)
    angles = []
    for _ in range(20):
        image = np.full((140, 140), 210, dtype=np.float32)
        cv2.ellipse(image, (70, 70), (34, 12), 37, 0, 360, 45, -1)
        image += rng.normal(0, 10, image.shape)
        image = np.clip(image, 0, 255).astype(np.uint8)
        cv2.rectangle(image, (2, 3), (27, 45), 25, -1)
        frame = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)

        angles.append(
            _roi_angle(frame, 0, 0, 140, 140, is_symmetric=True)
        )

    assert max(_angle_error(angle, 37.0, 180.0) for angle in angles) < 1.0
    assert float(np.std(angles)) < 0.2
