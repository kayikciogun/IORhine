from __future__ import annotations

import asyncio
import base64
import json
import logging
import time

import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config.runtime_store import get_vision
from app.config.settings import settings
from app.runtime.state import JobPhase
from app.services import services
from app.vision.fast_detect import fast_detect

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/control")
async def ws_control(websocket: WebSocket):
    await websocket.accept()
    services.ws_clients.append(websocket)

    async def forward(payload: dict) -> None:
        try:
            await websocket.send_text(json.dumps(payload))
        except Exception:
            pass

    services.bus.subscribe(forward)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
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
                services.motion.emergency_stop()
                services.ctx.stop_requested = True
                services.ctx.state.phase = JobPhase.ERROR
                await services.bus.emit("error", {"code": "estop", "msg": "Emergency stop"})
    except WebSocketDisconnect:
        pass
    finally:
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
            logger.warning("camera.open failed (streaming mock/last frame): %s", e)
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

        while True:
            t0 = time.monotonic()
            frame = camera.capture()
            cam_err = camera.error

            vis = get_vision()

            def _detect():
                return fast_detect(
                    frame,
                    thresh_val=vis.fast_detect_threshold,
                    min_area=vis.min_contour_area,
                    max_area=vis.max_contour_area,
                    blur_kernel=vis.blur_kernel,
                    show_mask=vis.show_mask,
                    draw=True,
                )

            try:
                stones, annotated = await asyncio.to_thread(_detect)
            except Exception as e:
                logger.exception("fast_detect failed")
                await websocket.send_text(
                    json.dumps(
                        {
                            "evt": "error",
                            "data": {"code": "vision", "msg": str(e)},
                        }
                    )
                )
                await asyncio.sleep(interval)
                continue

            ok, buf = cv2.imencode(
                ".jpg",
                annotated,
                [cv2.IMWRITE_JPEG_QUALITY, settings.camera_jpeg_quality],
            )
            if not ok:
                await asyncio.sleep(interval)
                continue

            now = time.monotonic()
            dt = now - prev_t
            prev_t = now
            if dt > 0:
                inst_fps = 1.0 / dt
                fps_ema = inst_fps if fps_ema == 0 else fps_ema * 0.85 + inst_fps * 0.15

            payload: dict = {
                "evt": "frame",
                "jpg_base64": base64.b64encode(buf.tobytes()).decode("ascii"),
                "stones": stones,
                "fps": round(fps_ema, 1),
                "mode": "fast",
                "ts": int(now * 1000),
            }
            if cam_err:
                payload["camera_warning"] = cam_err

            await websocket.send_text(json.dumps(payload))

            elapsed = time.monotonic() - t0
            await asyncio.sleep(max(0.0, interval - elapsed))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws/camera handler crashed")
        raise
