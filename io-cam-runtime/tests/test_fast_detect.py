"""Eski fast_detect modülü kaldırıldı; placeholder boş bırakıldı.

Bu dosya pytest discovery'de kalsa da aktif test içermiyor.
"""
import pytest

pytest.skip("app.vision.fast_detect kaldırıldı", allow_module_level=True)
