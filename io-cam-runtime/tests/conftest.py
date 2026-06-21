"""Paylaşılan pytest fixture ve hook'lar.

Her testte ``IO_CAM_MOCK_HARDWARE=1`` ve ``calibration_dir`` izolasyonu otomatik
sağlanır; ayrıca testler arası ``services`` global state'i sıfırlanır.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

# Mock mode zorunlu (seri port / kamera erişimi yok)
os.environ.setdefault("IO_CAM_MOCK_HARDWARE", "1")

import pytest  # noqa: E402

from app.config import settings as _settings_mod  # noqa: E402
from app.runtime.state import JobPhase  # noqa: E402
from app.services import services  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_services():
    """Her test öncesi singleton services sıfırlanır (runner, motion, glue)."""
    services.runner = None
    services.motion = None
    services.glue = None
    services.camera = None
    services.template = None
    services.rows = []
    # P3-D31: dxf_bytes kaldırıldı (dead field); ws_clients hâlâ kullanılıyor
    services.ws_clients = []
    services.ctx.state.phase = JobPhase.IDLE
    services.ctx.stop_requested = False
    services.ctx.vacuum_fail_streak = 0
    services.ctx.pause_event.set()
    yield


@pytest.fixture
def tmp_cal_dir(monkeypatch) -> Path:
    """Her test için izole calibration dizini; test sonunda otomatik temizlenir.

    ``settings.calibration_dir`` monkey-patch ile bu dizine yönlendirilir; böylece
    gerçek ``calibration/`` dosyaları testten etkilenmez.
    """
    tmp = Path(tempfile.mkdtemp(prefix="iorhine_cal_"))
    # settings.calibration_dir monkey-patch (Pydantic frozen değil; alan olarak set edilebilir)
    monkeypatch.setattr(_settings_mod.settings, "calibration_dir", tmp, raising=False)
    try:
        yield tmp
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def mock_serial(monkeypatch):
    """pyserial yerine MockSerial; ``serial.Serial`` çağrılarını yakalar."""
    from app.motion.mock_driver import MockSerial

    monkeypatch.setattr(
        "app.motion.gcode_driver.serial.Serial", lambda *a, **kw: MockSerial()
    )
    return MockSerial()
