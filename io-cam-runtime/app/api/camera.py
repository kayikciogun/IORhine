from __future__ import annotations

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
    """Scan USB / V4L2 capture devices."""
    return list_all_devices()


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
