import numpy as np

from app.vision.detector import detect_all
from app.vision.template_loader import build_template_from_contour


def test_detect_all_mock_frame():
    from app.runtime.camera import _mock_frame

    frame = _mock_frame()
    pts = np.array([[-5, -5], [5, -5], [5, 5], [-5, 5]], dtype=np.float32).reshape(-1, 1, 2)
    template = build_template_from_contour("test", pts, is_symmetric=True)
    stones = detect_all(frame, template)
    assert isinstance(stones, list)
