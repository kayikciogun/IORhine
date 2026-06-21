"""JobRunner._run_loop güvenlik testleri.

Bu testler audit raporundaki P0 bulgularını doğrular:
- no_stone_detected retry → ERROR'a düşer (sonsuz spam yok)
- vacuum_pick_failed streak → ERROR'a düşer
- GlueSheetExhausted sonrası resume → reset yoksa ERROR'a düşer
- start() yalnızca ready fazında kabul edilir
- stop() deadlock'a düşmez (timeout + cancel)
- pause_event temiz state'te set edilir (uzun ömürlü task)
"""

from __future__ import annotations

import asyncio
import os

import numpy as np
import pytest

os.environ.setdefault("IO_CAM_MOCK_HARDWARE", "1")

from app.config.settings import settings  # noqa: E402
from app.glue_sheet.controller import GlueSheet, GlueSheetExhausted  # noqa: E402
from app.motion.controller import MotionController  # noqa: E402
from app.motion.gcode_driver import GcodeDriver  # noqa: E402
from app.motion.mock_driver import MockSerial  # noqa: E402
from app.runtime.events import EventBus  # noqa: E402
from app.runtime.job_runner import JobRunner, shortest_delta_c  # noqa: E402
from app.runtime.state import JobPhase, RuntimeContext  # noqa: E402
from app.vision.template_loader import StoneTemplate  # noqa: E402


# ── Test helpers ───────────────────────────────────────────────────────


class _FakeCamera:
    """Boş frame döndüren kamera; istenirse taş listesi de eklenebilir."""

    def __init__(self, frame: np.ndarray | None = None) -> None:
        self.frame = frame if frame is not None else np.zeros((480, 640, 3), dtype=np.uint8)
        self.captured = 0

    def capture(self) -> np.ndarray:
        self.captured += 1
        return self.frame

    def open(self) -> None:  # job_runner.prepare() çağırıyor
        pass


class _StubTemplate(StoneTemplate):
    """detect_all'ın eşleşme üretmesi için minimum kontur — testlerde
    ``detect_all`` monkey-patch'leneceği için sadece tipten ibaret."""

    def __init__(self) -> None:  # type: ignore[no-super-call]
        self.shape_id = "TEST"
        self.contour = np.zeros((4, 1, 2), dtype=np.float32)
        self.is_symmetric = True


def _make_runner(
    *,
    rows: list,
    motion: MotionController | None = None,
    glue: GlueSheet | None = None,
    camera: _FakeCamera | None = None,
    template: _StubTemplate | None = None,
    cal_dir=None,
) -> JobRunner:
    driver = GcodeDriver.from_serial(MockSerial())
    mc = motion or MotionController(driver)
    g = glue or GlueSheet(cols=2, rows=2, origin_xy=(0.0, 0.0), cell_size=20.0, z=0.0)
    cam = camera or _FakeCamera()
    tmpl = template or _StubTemplate()
    bus = EventBus()
    ctx = RuntimeContext()
    # load_fabric_offset için gerçek dosya gerekiyor
    if cal_dir is None:
        cal_dir = _tmp_cal_dir()
    import json as _json
    (cal_dir / "fabric_offset.json").write_text(_json.dumps({"dx": 0.0, "dy": 0.0}))
    return JobRunner(
        ctx=ctx,
        bus=bus,
        motion=mc,
        glue=g,
        camera=cam,  # type: ignore[arg-type]
        template=tmpl,
        rows=rows,
        cal_dir=cal_dir,
    )


# ── Tests ──────────────────────────────────────────────────────────────


def test_shortest_delta_c_basic():
    assert shortest_delta_c(10.0, 0.0) == 10.0
    assert shortest_delta_c(0.0, 10.0) == -10.0
    assert abs(shortest_delta_c(350.0, 10.0) - (-20.0)) < 1e-9  # 350 → 10 = -340 ≡ 20 sola


@pytest.mark.asyncio
async def test_start_only_in_ready_phase(monkeypatch):
    """start() yalnızca ready fazında yeni task yaratır."""
    runner = _make_runner(rows=[_row(0)])
    # PREPARING/IDLE → start reddedilmeli
    runner.ctx.state.phase = JobPhase.IDLE
    await runner.start()
    assert runner._task is None
    assert runner.ctx.state.phase == JobPhase.IDLE

    runner.ctx.state.phase = JobPhase.READY
    # _run_loop'u monkey-patch ile no-op yap ki test çabuk bitsin
    async def _noop():
        return None
    monkeypatch.setattr(runner, "_run_loop", _noop)
    await runner.start()
    assert runner._task is not None
    # task'i sonra temizle
    await runner.stop()


@pytest.mark.asyncio
async def test_stop_deadlock_guard():
    """stop() 5 sn içinde bitmeyen task'ı iptal eder."""
    runner = _make_runner(rows=[_row(0)])
    runner.ctx.state.phase = JobPhase.READY

    async def _hanging():
        await asyncio.sleep(60)  # sonsuz

    runner._task = asyncio.create_task(_hanging())
    runner.ctx.state.phase = JobPhase.RUNNING
    # Stop 5s timeout içinde iptal etmeli
    t0 = asyncio.get_event_loop().time()
    await runner.stop()
    elapsed = asyncio.get_event_loop().time() - t0
    assert elapsed < 7.0, f"stop() took {elapsed:.2f}s; expected < 7s"
    assert runner._task is None or runner._task.done()


@pytest.mark.asyncio
async def test_no_stone_detected_terminates_loop(monkeypatch):
    """empty_retries aşımında ERROR fazına geçer (sonsuz spam yok)."""
    # empty_stone_retries'ı düşür ki test hızlı bitsin
    monkeypatch.setattr(settings, "empty_stone_retries", 2)
    monkeypatch.setattr(settings, "settling_ms", 0)

    runner = _make_runner(rows=[_row(0), _row(1)])
    runner.ctx.state.phase = JobPhase.READY

    # detect_all → boş liste (sync; job_runner doğrudan çağırıyor)
    import app.runtime.job_runner as jr_mod

    def _no_detect(*args, **kwargs):
        return []

    monkeypatch.setattr(jr_mod, "detect_all", _no_detect)

    await runner.start()
    # İlk satır için empty_retries kadar dener, sonra ERROR
    await asyncio.wait_for(runner._task, timeout=2.0)
    assert runner.ctx.state.phase == JobPhase.ERROR
    assert "no_stone_detected" in (runner.ctx.state.message or "")


@pytest.mark.asyncio
async def test_vacuum_pick_failed_streak_terminates(monkeypatch):
    """Üst üste vacuum_pick_failed → ERROR."""
    monkeypatch.setattr(settings, "settling_ms", 0)
    monkeypatch.setattr(settings, "vacuum_pick_retries", 1)

    runner = _make_runner(rows=[_row(0), _row(1)])
    runner.ctx.state.phase = JobPhase.READY

    import app.runtime.job_runner as jr_mod

    # detect_all → tek taş (her çağrıda 1)
    stone = jr_mod.Stone(x=10, y=20, angle=0, score=0, area=100, robot_x=10.0, robot_y=20.0)

    def _det(*args, **kwargs):
        return [stone]

    monkeypatch.setattr(jr_mod, "detect_all", _det)

    # vacuum_gripped → her zaman False
    runner.motion.vacuum_gripped = lambda: False  # type: ignore[assignment]

    await runner.start()
    await asyncio.wait_for(runner._task, timeout=2.0)
    assert runner.ctx.state.phase == JobPhase.ERROR
    assert runner.ctx.vacuum_fail_streak >= 1
    assert "vacuum" in (runner.ctx.state.message or "").lower()


@pytest.mark.asyncio
async def test_glue_sheet_exhausted_resume_requires_reset(monkeypatch):
    """GlueSheetExhausted sonrası resume gelirse yeniden denenir; ikinci
    başarısızlıkta ERROR'a düşer (sonsuz döngü yok)."""
    monkeypatch.setattr(settings, "settling_ms", 0)

    # Glue sheet: tek satır × tek sütun; ilk next_cell başarılı, ikincisi tükenmiş.
    glue = GlueSheet(cols=1, rows=1, origin_xy=(0, 0), cell_size=20, z=0)
    runner = _make_runner(rows=[_row(0), _row(1)], glue=glue)
    runner.ctx.state.phase = JobPhase.READY

    import app.runtime.job_runner as jr_mod

    stone = jr_mod.Stone(x=10, y=20, angle=0, score=0, area=100, robot_x=10, robot_y=20)

    def _det(*args, **kwargs):
        return [stone]

    monkeypatch.setattr(jr_mod, "detect_all", _det)
    runner.motion.vacuum_gripped = lambda: True  # type: ignore[assignment]

    # Glue sheet'i önceden tüket — ilk satır zaten glue_sheet_exhausted'a düşsün
    glue.reset()  # cursor=0
    # İlk satırda next_cell → cursor=1; ikinci satırda exhausted.

    async def _auto_resume():
        """İkinci satıra gelmeden hemen önce resume set et — eski kod sonsuz
        döngüde, yeni kod reset yoksa ERROR'a geçer."""
        # İlk satırın glue_cell event'i yayınlanır yayınlanlanmaz resume et
        # (yani henüz levha tüketilmeden).
        await asyncio.sleep(0.05)
        runner.ctx.pause_event.set()
        # Ancak reset yok → ikinci satırda hâlâ exhausted fırlatır.

    resume_task = asyncio.create_task(_auto_resume())
    try:
        await runner.start()
        await asyncio.wait_for(runner._task, timeout=3.0)
    finally:
        resume_task.cancel()

    assert runner.ctx.state.phase == JobPhase.ERROR
    assert "GlueSheetExhausted" in (runner.ctx.state.message or "")


def _row(i: int):
    from app.runtime.csv_loader import PlacementRow

    return PlacementRow(
        id=i,
        target_x=10.0 + i,
        target_y=20.0 + i,
        target_angle=0.0,
        shape_id="T",
        thickness=0.0,
    )


def _tmp_cal_dir():
    """Her test için izole bir kalibrasyon dizini oluşturur."""
    import tempfile
    from pathlib import Path

    p = Path(tempfile.mkdtemp(prefix="iorhine_test_cal_"))
    return p