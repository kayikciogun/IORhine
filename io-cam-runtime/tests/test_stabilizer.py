import numpy as np
import pytest
from app.vision.detector import Stone
from app.vision.stabilizer import VisionStabilizer, smooth_angle, smooth_binary_mask, smooth_contour_polyline


def test_smooth_binary_mask():
    bw = np.zeros((100, 100), dtype=np.uint8)
    bw[40:60, 40:60] = 255
    # Add small pinhole in center
    bw[50, 50] = 0
    cleaned = smooth_binary_mask(bw)
    assert cleaned[50, 50] == 255


def test_smooth_contour_polyline():
    # Square contour with small perturbation
    cnt = np.array([[-10, -10], [10, -10], [10, 0], [11, 0], [10, 10], [-10, 10]], dtype=np.int32)
    smoothed = smooth_contour_polyline(cnt, epsilon_factor=0.05)
    assert len(smoothed) <= len(cnt)


def test_smooth_angle():
    # Test circular EMA wrapping around 180 degrees
    s = smooth_angle(179.0, 1.0, alpha=0.5, period=180.0)
    assert s == 0.0 or s == 180.0
    s2 = smooth_angle(179.0, 3.0, alpha=0.5, period=180.0)
    assert s2 == 1.0


def test_stabilize_dict_objects():
    stab = VisionStabilizer(max_match_dist_px=50.0)
    obj1 = [{"id": 1, "cx": 100, "cy": 100, "x": 100.0, "y": 100.0, "angle": 45.0, "w": 20.0, "h": 20.0, "area": 400}]
    out1 = stab.stabilize_dict_objects(obj1)
    assert out1[0]["x"] == 100.0

    # Slight jitter in frame 2
    obj2 = [{"id": 1, "cx": 101, "cy": 100, "x": 101.0, "y": 100.0, "angle": 46.0, "w": 20.0, "h": 20.0, "area": 400}]
    out2 = stab.stabilize_dict_objects(obj2)
    # With alpha_xy=0.15 for small jumps, 100 + 0.15 * 1 = 100.15 -> round(100.15, 1) = 100.1 or 100.2
    assert abs(out2[0]["x"] - 100.15) < 0.2


def test_stabilize_stones():
    stab = VisionStabilizer(max_match_dist_px=50.0)
    s1 = [Stone(x=50.0, y=50.0, angle=10.0, score=0.01, area=500.0)]
    out1 = stab.stabilize_stones(s1)
    assert out1[0].x == 50.0

    s2 = [Stone(x=51.0, y=50.0, angle=11.0, score=0.01, area=500.0)]
    out2 = stab.stabilize_stones(s2)
    assert abs(out2[0].x - 50.15) < 0.2
