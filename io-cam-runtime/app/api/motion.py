from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from serial.tools import list_ports

from app.config.settings import settings
from app.motion.config_store import apply_motion_config, load_motion_config, save_motion_config
from app.motion.serial_config import load_serial_port, save_serial_port
from app.services import services

router = APIRouter(prefix="/api/motion", tags=["motion"])


class SelectMotionPortBody(BaseModel):
    serial_port: str = Field(..., min_length=1)


class MotionConfigBody(BaseModel):
    rotation_axis: str = Field(pattern="^(A|E)$")
    safe_z: float = Field(gt=0)
    pick_z: float
    glue_z: float
    place_z: float
    xy_feed: float = Field(gt=0)
    z_feed: float = Field(gt=0)
    rotation_feed: float = Field(gt=0)
    vacuum_on_dwell_s: float = Field(ge=0)
    vacuum_off_dwell_s: float = Field(ge=0)
    glue_dwell_s: float = Field(ge=0)


def _motion_config() -> dict:
    return {
        "rotation_axis": settings.rotation_axis,
        "safe_z": settings.safe_z,
        "pick_z": settings.pick_z,
        "glue_z": settings.glue_z,
        "place_z": settings.place_z,
        "xy_feed": settings.xy_feed,
        "z_feed": settings.z_feed,
        "rotation_feed": settings.rotation_feed,
        "vacuum_on_dwell_s": settings.vacuum_on_dwell_s,
        "vacuum_off_dwell_s": settings.vacuum_off_dwell_s,
        "glue_dwell_s": settings.glue_dwell_s,
    }


def _port_to_dict(port) -> dict:
    label = port.description or port.device
    if port.manufacturer:
        label = f"{label} ({port.manufacturer})"
    return {
        "id": port.device,
        "path": port.device,
        "label": label,
        "description": port.description,
        "hwid": port.hwid,
        "manufacturer": port.manufacturer,
        "available": True,
    }


def _status() -> dict:
    saved = load_serial_port(settings.calibration_dir)
    if saved:
        settings.serial_port = saved
    return {
        "mock_hardware": settings.mock_hardware,
        "serial_port": settings.serial_port,
        "motion_initialized": services.motion is not None,
    }


async def _teardown_running_motion() -> None:
    """Config/port değişiminde çalışan job'u güvenli şekilde durdur.

    Eski kod ``services.motion = None`` yapıp ``services.runner = None`` yapıyordu
    ama çalışan ``runner._task`` iptal edilmiyordu → task eski driver referansını
    kullanmaya devam edip ``SerialException`` fırlatıyordu. Bu yardımcı önce
    runner'ı durdurur (5 sn timeout), sonra driver'ı kapatır.
    """
    runner = services.runner
    if runner is not None:
        task = getattr(runner, "_task", None)
        if task is not None and not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
    motion = services.motion
    if motion is not None:
        driver = getattr(motion, "driver", None)
        if driver is not None and hasattr(driver, "close"):
            try:
                driver.close()
            except Exception:
                pass
    services.motion = None
    services.runner = None


@router.get("/ports")
async def motion_ports():
    ports = [_port_to_dict(p) for p in list_ports.comports()]
    selected = load_serial_port(settings.calibration_dir)
    if selected:
        settings.serial_port = selected
    elif settings.serial_port:
        selected = settings.serial_port

    # Keep the configured port visible even when it is currently unplugged.
    if selected and all(p["path"] != selected for p in ports):
        ports.append(
            {
                "id": selected,
                "path": selected,
                "label": f"{selected} (bulunamadı)",
                "description": "Configured port is not currently detected",
                "hwid": "",
                "manufacturer": None,
                "available": False,
            }
        )

    return {"ports": ports, "status": _status()}


@router.get("/status")
async def motion_status():
    return _status()


@router.post("/select")
async def select_motion_port(body: SelectMotionPortBody):
    detected = {p.device for p in list_ports.comports()}
    if body.serial_port not in detected:
        raise HTTPException(
            status_code=400,
            detail=f"Seri port bulunamadı: {body.serial_port}",
        )

    save_serial_port(settings.calibration_dir, body.serial_port)
    settings.serial_port = body.serial_port

    if services.motion is not None:
        await _teardown_running_motion()

    return {"ok": True, "status": _status()}


@router.get("/config")
async def get_motion_config():
    saved = load_motion_config(settings.calibration_dir)
    if saved:
        apply_motion_config(settings, saved)
    return _motion_config()


@router.post("/config")
async def update_motion_config(body: MotionConfigBody):
    data = body.model_dump()
    save_motion_config(settings.calibration_dir, data)
    apply_motion_config(settings, data)

    # Rotation axis is cached by MotionController; recreate controller on next job.
    if services.motion is not None:
        await _teardown_running_motion()

    return {"ok": True, "config": _motion_config()}
