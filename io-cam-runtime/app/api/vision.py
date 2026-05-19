from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config.runtime_store import VisionConfig, get_vision, set_vision

router = APIRouter(prefix="/api/vision", tags=["vision"])


class VisionSettingsBody(BaseModel):
    blur_kernel: int = Field(default=9, ge=1, le=31)
    fast_detect_threshold: int = Field(default=120, ge=0, le=255)
    min_contour_area: int = Field(default=600, ge=50, le=50000)
    max_contour_area: int = Field(default=80000, ge=500, le=500000)
    show_mask: bool = False
    match_threshold: float = Field(default=0.15, ge=0.01, le=2.0)
    threshold_auto: bool | None = None


def _vision_to_dict(v: VisionConfig) -> dict:
    return {
        "blur_kernel": v.blur_kernel,
        "fast_detect_threshold": v.fast_detect_threshold,
        "min_contour_area": v.min_contour_area,
        "max_contour_area": v.max_contour_area,
        "show_mask": v.show_mask,
        "match_threshold": v.match_threshold,
        "threshold_auto": v.fast_detect_threshold <= 0,
    }


@router.get("/settings")
async def get_vision_settings():
    return _vision_to_dict(get_vision())


@router.post("/settings")
async def update_vision_settings(body: VisionSettingsBody):
    bk = body.blur_kernel if body.blur_kernel % 2 == 1 else body.blur_kernel + 1
    thr = 0 if body.threshold_auto else body.fast_detect_threshold
    cfg = VisionConfig(
        blur_kernel=bk,
        fast_detect_threshold=thr,
        min_contour_area=body.min_contour_area,
        max_contour_area=body.max_contour_area,
        show_mask=body.show_mask,
        match_threshold=body.match_threshold,
    )
    set_vision(cfg)
    return {"ok": True, **_vision_to_dict(cfg)}
