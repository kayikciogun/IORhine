from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config.settings import settings
from app.runtime.camera_sources import (
    CameraSourceConfig,
    list_all_devices,
    load_saved_config,
    save_config,
)
from app.services import services

router = APIRouter(prefix="/api/camera", tags=["camera"])

# P2-A5: /devices endpoint cache. ``list_all_devices`` macOS'ta
# ``system_profiler`` (8 sn) + ``ffmpeg`` (12 sn) + OpenCV probe çağırır —
# her istekte event loop'u 20+ sn bloklar. 5 sn TTL cache + thread offload.
_DEVICES_CACHE: tuple[float, Any] | None = None
_DEVICES_TTL = 5.0  # seconds


class SelectCameraBody(BaseModel):
    device_id: str | None = Field(
        None,
        description="Full id e.g. usb:0, usb:/dev/video0",
    )
    kind: Literal["usb", "mock"] | None = None
    source_id: str | None = Field(
        None,
        description="Capture index or /dev/video0 path",
    )


def _parse_device_id(device_id: str) -> CameraSourceConfig:
    if ":" not in device_id:
        raise ValueError("device_id must be kind:value")
    kind, _, source_id = device_id.partition(":")
    if kind not in ("usb", "mock"):
        raise ValueError(f"Invalid kind in device_id: {kind}")
    return CameraSourceConfig(kind=kind, source_id=source_id)  # type: ignore[arg-type]


@router.get("/devices")
async def get_devices():
    """Scan USB / V4L2 capture devices.

    P2-A5: ``list_all_devices`` sync bloklayıcı (system_profiler + ffmpeg +
    OpenCV probe, 20+ sn). ``asyncio.to_thread`` ile event loop'tan taşır +
    5 sn TTL cache ile tekrarlayan çağrıları atlar.
    """
    global _DEVICES_CACHE
    now = time.monotonic()
    if _DEVICES_CACHE and now - _DEVICES_CACHE[0] < _DEVICES_TTL:
        return _DEVICES_CACHE[1]
    result = await asyncio.to_thread(list_all_devices)
    _DEVICES_CACHE = (now, result)
    return result


@router.get("/status")
async def camera_status():
    cfg = None
    if services.camera and services.camera.config:
        cfg = services.camera.config.to_dict()
    else:
        saved = load_saved_config(settings.calibration_dir)
        if saved:
            cfg = saved.to_dict()

    err = services.camera.error if services.camera else ""
    return {
        "config": cfg,
        "error": err,
        "mock_hardware": settings.mock_hardware,
    }


@router.post("/select")
async def select_camera(body: SelectCameraBody):
    if body.device_id:
        try:
            cfg = _parse_device_id(body.device_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    elif body.kind and body.source_id:
        cfg = CameraSourceConfig(kind=body.kind, source_id=body.source_id)
    else:
        raise HTTPException(
            status_code=400,
            detail="device_id veya (kind + source_id) gerekli",
        )

    save_config(settings.calibration_dir, cfg)

    if services.camera is None:
        from app.runtime.camera import Camera

        services.camera = Camera(cfg, mock=settings.mock_hardware)

    try:
        services.camera.select_source(cfg)
        services.camera.open()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {"ok": True, "config": cfg.to_dict()}
