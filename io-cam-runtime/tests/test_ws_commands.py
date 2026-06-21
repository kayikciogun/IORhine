"""WebSocket komut testleri.

``/ws/control`` üzerinden gelen ``start/pause/resume/stop/estop`` komutlarının
services.runner ile doğru etkileştiğini ve ``estop``'un çalışan _task'i iptal
ettiğini doğrular. Audit raporundaki P0-10 bulgusunu kapsar.

``websockets`` kütüphanesi httpx'in websocket desteğinden daha güvenilir olduğu
için tercih edildi.
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest
import uvicorn
import websockets

os.environ.setdefault("IO_CAM_MOCK_HARDWARE", "1")

# app import'u ASGITransport'tan önce
from app.main import app  # noqa: E402
from app.runtime.state import JobPhase  # noqa: E402
from app.services import services  # noqa: E402


# ── Sunucu yardımcıları ───────────────────────────────────────────────


@pytest.fixture
async def running_server():
    """Lokal bir uvicorn örneğini 8765 portunda başlatır; testler bittikten
    sonra kapatır. Uvicorn'un kendi event loop'unda çalışması için thread
    gerekiyor (pytest-asyncio ile aynı loop'ta çalışmaz)."""
    config = uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="error")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    # Sunucu ayağa kalkana kadar bekle
    for _ in range(40):
        if server.started:
            break
        await asyncio.sleep(0.05)
    assert server.started, "uvicorn ayağa kalkamadı"
    try:
        yield "ws://127.0.0.1:8765"
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, timeout=3.0)


async def _recv_event(ws, *, code: str, timeout: float = 2.0) -> dict:
    """İlk eşleşen event payload'ını al; yoksa timeout'a düş."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
        payload = json.loads(raw)
        if payload.get("evt") == "error" and payload.get("data", {}).get("code") == code:
            return payload
    raise AssertionError(f"event code={code!r} alınamadı")


# ── Testler ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ws_control_emits_no_job_error(running_server):
    """Job yokken start → 'no_job' error event'i."""
    services.runner = None
    async with websockets.connect(f"{running_server}/ws/control") as ws:
        await ws.send(json.dumps({"cmd": "start"}))
        payload = await _recv_event(ws, code="no_job")
        assert payload["data"]["code"] == "no_job"


@pytest.mark.asyncio
async def test_ws_control_estop_cancels_task(running_server):
    """estop komutu → ERROR fazı + çalışan _task iptal."""
    class _StubRunner:
        def __init__(self) -> None:
            self._task: asyncio.Task | None = None

        async def start(self) -> None:
            async def _hanging():
                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    raise

            self._task = asyncio.create_task(_hanging())

    stub = _StubRunner()
    await stub.start()
    services.runner = stub  # type: ignore[assignment]
    # motion emergency_stop no-op
    services.motion = type("M", (), {"emergency_stop": lambda self: None})()
    services.ctx.stop_requested = False
    services.ctx.pause_event.set()

    try:
        async with websockets.connect(f"{running_server}/ws/control") as ws:
            await ws.send(json.dumps({"cmd": "estop"}))
            payload = await _recv_event(ws, code="estop")
            assert payload["data"]["code"] == "estop"
    finally:
        services.runner = None

    assert services.ctx.state.phase == JobPhase.ERROR
    assert services.ctx.stop_requested is True
    assert stub._task is None or stub._task.done()
