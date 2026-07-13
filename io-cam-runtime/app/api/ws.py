from __future__ import annotations

import asyncio
import json
import logging
import time

import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config.settings import settings
from app.runtime.state import JobPhase
from app.services import services
from app.vision.ai_detect import ai_status

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/control")
async def ws_control(websocket: WebSocket):
    # P3-G45: Auth token — ``?token=`` query param. ``settings.control_token``
    # boş ise auth disabled (dev/test). Production'ta set et.
    token = settings.control_token
    if token:
        client_token = websocket.query_params.get("token", "")
        if client_token != token:
            await websocket.close(code=4401)  # Unauthorized
            return
    await websocket.accept()
    services.ws_clients.append(websocket)

    async def forward(payload: dict) -> None:
        try:
            await websocket.send_text(json.dumps(payload))
        except Exception:
            pass

    services.bus.subscribe(forward)
    # Subscriber leak fix: ``finally`` bloğunda unsubscribe yapılmalı; yoksa
    # bağlantı kapandıktan sonra bile event'ler kapalı socket'e yazılmaya
    # çalışılır → memory leak + ``send_text`` exception spam.
    try:
        while True:
            raw = await websocket.receive_text()
            # Bozuk JSON bağlantıyı kırmasın; client'e hata event'i gönder ve devam et.
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await services.bus.emit(
                    "error",
                    {"code": "bad_json", "msg": f"Geçersiz JSON: {raw[:120]!r}"},
                )
                continue
            cmd = msg.get("cmd")
            if cmd == "start":
                if services.runner:
                    await services.runner.start()
                else:
                    await services.bus.emit(
                        "error",
                        {
                            "code": "no_job",
                            "msg": "Önce Job yükle (phase ready olmalı)",
                        },
                    )
            elif cmd == "pause" and services.runner:
                await services.runner.pause()
            elif cmd == "resume" and services.runner:
                await services.runner.resume()
            elif cmd == "stop" and services.runner:
                await services.runner.stop()
            elif cmd == "estop" and services.motion:
                # E-stop: M410 + vakum kapat + çalışan job_runner._task'i iptal et.
                # Aksi halde acil durdurma sonrası _run_loop devam edebilir ve
                # güvensiz hareketler üretebilir.
                services.motion.emergency_stop()
                services.ctx.stop_requested = True
                services.ctx.pause_event.set()
                services.ctx.state.phase = JobPhase.ERROR
                await services.bus.emit("error", {"code": "estop", "msg": "Emergency stop"})
                runner = services.runner
                if runner is not None:
                    task = getattr(runner, "_task", None)
                    if task is not None and not task.done():
                        task.cancel()
                        try:
                            await asyncio.wait_for(task, timeout=2.0)
                        except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                            pass
    except WebSocketDisconnect:
        pass
    finally:
        # Subscriber leak fix: forward callback'i EventBus'tan çıkar.
        services.bus.unsubscribe(forward)
        if websocket in services.ws_clients:
            services.ws_clients.remove(websocket)


@router.websocket("/ws/camera")
async def ws_camera(websocket: WebSocket):
    await websocket.accept()
    interval = 1.0 / max(settings.camera_idle_fps, 1.0)
    prev_t = time.monotonic()
    fps_ema = 0.0

    try:
        camera = services.ensure_camera()
        try:
            camera.open()
        except Exception as e:
            logger.warning("camera.open failed: %s", e)
            await websocket.send_text(
                json.dumps(
                    {
                        "evt": "error",
                        "data": {
                            "code": "camera",
                            "msg": f"Kamera açılamadı: {e}",
                        },
                    }
                )
            )

        last_err_msg: str | None = None
        while True:
            t0 = time.monotonic()
            cam_err = camera.error
            status = ai_status()

            # Geçerli kare yoksa sahte görüntü gönderme — sadece uyarı.
            if not camera.is_live:
                msg = cam_err or "Kamera frame yok"
                if msg != last_err_msg:
                    last_err_msg = msg
                    await websocket.send_text(
                        json.dumps(
                            {
                                "evt": "error",
                                "data": {
                                    "code": "camera",
                                    "msg": msg,
                                },
                                "ai_status": status,
                            }
                        )
                    )
                await asyncio.sleep(interval)
                continue

            try:
                frame = camera.capture()
            except RuntimeError as e:
                msg = str(e)
                if msg != last_err_msg:
                    last_err_msg = msg
                    await websocket.send_text(
                        json.dumps(
                            {
                                "evt": "error",
                                "data": {"code": "camera", "msg": msg},
                                "ai_status": status,
                            }
                        )
                    )
                await asyncio.sleep(interval)
                continue

            last_err_msg = None

            # Canlı stream sadece ham kamera — VLM yok.
            # Tespit yalnızca "Kare Al" → POST /api/vision/snapshot-detect ile.
            stones: list = []
            annotated = frame

            # Encode + resize'i thread havuzuna al — event loop'u bloklamasın.
            # Resize: 640px'e düşür → base64 payload ~%60 küçülür, encode ~3x hızlanır.
            max_w = settings.camera_stream_max_width

            def _encode():
                nonlocal annotated
                if max_w > 0 and annotated.shape[1] > max_w:
                    scale = max_w / annotated.shape[1]
                    new_w = max_w
                    new_h = int(annotated.shape[0] * scale)
                    annotated = cv2.resize(annotated, (new_w, new_h), interpolation=cv2.INTER_AREA)
                ok, buf = cv2.imencode(
                    ".jpg",
                    annotated,
                    [cv2.IMWRITE_JPEG_QUALITY, settings.camera_jpeg_quality],
                )
                return ok, buf

            try:
                ok, buf = await asyncio.to_thread(_encode)
            except Exception:
                logger.exception("imencode failed")
                await asyncio.sleep(interval)
                continue
            if not ok:
                await asyncio.sleep(interval)
                continue

            now = time.monotonic()
            dt = now - prev_t
            prev_t = now
            if dt > 0:
                inst_fps = 1.0 / dt
                fps_ema = inst_fps if fps_ema == 0 else fps_ema * 0.85 + inst_fps * 0.15

            # Binary protokol: [4-byte big-endian JSON len][JSON metadata][raw JPEG]
            # base64 +%33 şişirme yok, JSON parse frontend'de tek sefer.
            meta = {
                "evt": "frame",
                "stones": stones,
                "fps": round(fps_ema, 1),
                "mode": "preview",
                "ts": int(now * 1000),
                "ai_status": status,
            }
            if cam_err:
                meta["camera_warning"] = cam_err

            meta_bytes = json.dumps(meta, separators=(",", ":")).encode("utf-8")
            jpg_bytes = buf.tobytes()
            header = len(meta_bytes).to_bytes(4, "big")
            await websocket.send_bytes(header + meta_bytes + jpg_bytes)

            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0.0, interval - elapsed))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws/camera handler crashed")
        raise
