import numpy as np

from app.vision.vlm_preprocess import resize_for_vlm


def test_resize_for_vlm_scales_long_edge_to_512():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    out, scale, orig, new = resize_for_vlm(frame, max_dim=512)
    assert orig == (1920, 1080)
    assert max(new) == 512
    assert new[0] == 512  # width was longer
    assert abs(scale - 512 / 1920) < 1e-6
    assert out.shape == (new[1], new[0], 3)


def test_resize_for_vlm_no_upscale():
    frame = np.zeros((400, 300, 3), dtype=np.uint8)
    out, scale, orig, new = resize_for_vlm(frame, max_dim=512)
    assert scale == 1.0
    assert orig == new == (300, 400)
    assert out.shape == frame.shape
