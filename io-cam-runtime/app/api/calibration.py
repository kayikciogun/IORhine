from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config.settings import settings
from app.services import services
from app.vision.calibration import (
    HomographyCalibrationError,
    calibrate_homography_from_frame,
    save_fabric_offset,
    save_homography,
)

router = APIRouter(prefix="/api", tags=["calibration"])


class FabricOffsetBody(BaseModel):
    dx: float
    dy: float


class GlueSheetBody(BaseModel):
    origin_x: float
    origin_y: float
    z: float
    cols: int = 100
    rows: int = 100
    cell_size: float = 20.0


class HomographyCalibBody(BaseModel):
    chessboard_cols: int = Field(default=9, ge=3, le=30)
    chessboard_rows: int = Field(default=6, ge=3, le=30)
    square_size_mm: float = Field(default=25.0, gt=0)


@router.get("/calibration")
async def get_calibration():
    return services.get_calibration_summary()


@router.post("/calibration/homography")
async def calibrate_homography(body: HomographyCalibBody):
    """Capture frame and calibrate camera→robot homography via chessboard."""
    if not services.camera:
        services.init_hardware()
    assert services.camera
    try:
        services.camera.open()
        frame = services.camera.capture()
        H, reproj_err = calibrate_homography_from_frame(
            frame,
            body.chessboard_cols,
            body.chessboard_rows,
            body.square_size_mm,
        )
        save_homography(settings.calibration_dir, H)
        return {
            "ok": True,
            "reprojection_error_mm": reproj_err,
            "chessboard_cols": body.chessboard_cols,
            "chessboard_rows": body.chessboard_rows,
            "square_size_mm": body.square_size_mm,
        }
    except HomographyCalibrationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/calibration/fabric")
async def calibrate_fabric(body: FabricOffsetBody):
    save_fabric_offset(settings.calibration_dir, body.dx, body.dy)
    return {"ok": True}


def _write_glue_sheet_config(body: GlueSheetBody) -> None:
    cal = settings.calibration_dir
    cal.mkdir(parents=True, exist_ok=True)
    path = cal / "glue_sheet.json"
    path.write_text(body.model_dump_json(indent=2), encoding="utf-8")
    state_path = cal / "glue_sheet_state.json"
    if state_path.is_file():
        state_path.unlink()
    services.reload_glue_sheet()


@router.post("/calibration/glue_sheet")
async def calibrate_glue_sheet(body: GlueSheetBody):
    _write_glue_sheet_config(body)
    return {"ok": True, "status": services.ensure_glue().status()}


@router.post("/glue_sheet/from_planning")
async def glue_sheet_from_planning(body: GlueSheetBody):
    """Planlama şablonundan yapışkan levha geometrisini runtime'a yazar."""
    _write_glue_sheet_config(body)
    glue = services.ensure_glue()
    glue.reset()
    return {"ok": True, "status": glue.status()}


@router.post("/glue_sheet/reset")
async def reset_glue_sheet():
    services.ensure_glue().reset()
    return {"ok": True}


@router.get("/glue_sheet/status")
async def glue_sheet_status():
    return services.ensure_glue().status()
