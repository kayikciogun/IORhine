"""Eski detector.detect_all kaldırıldı; tespit ai_detect üzerinden yapılıyor."""
import pytest

pytest.skip("app.vision.detector kaldırıldı — bkz. test_ai_detect_angles", allow_module_level=True)
