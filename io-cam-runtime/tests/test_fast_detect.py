from app.runtime.camera import _mock_frame
from app.vision.fast_detect import fast_detect


def test_fast_detect_returns_objects():
    frame = _mock_frame()
    objects, annotated = fast_detect(frame, draw=True)
    assert isinstance(objects, list)
    assert annotated.shape == frame.shape
