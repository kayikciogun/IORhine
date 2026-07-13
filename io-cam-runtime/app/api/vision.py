from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config.runtime_store import VisionConfig, get_vision, set_vision
from app.vision.ai_detect import ai_status

router = APIRouter(prefix="/api/vision", tags=["vision"])


class VisionSettingsBody(BaseModel):
    blur_kernel: int = Field(default=3, ge=1, le=31)
    fast_detect_threshold: int = Field(default=130, ge=0, le=255)
    min_contour_area: int = Field(default=50, ge=5, le=50000)
    max_contour_area: int = Field(default=80000, ge=100, le=1000000)
    show_mask: bool = False
    match_threshold: float = Field(default=0.25, ge=0.01, le=2.0)
    threshold_auto: bool | None = None
    invert_threshold: bool = True
    block_size: int = Field(default=31, ge=3, le=101)
    c_val: int = Field(default=8, ge=-20, le=50)



def _vision_to_dict(v: VisionConfig) -> dict:
    return {
        "blur_kernel": v.blur_kernel,
        "fast_detect_threshold": v.fast_detect_threshold,
        "min_contour_area": v.min_contour_area,
        "max_contour_area": v.max_contour_area,
        "show_mask": v.show_mask,
        "match_threshold": v.match_threshold,
        "threshold_auto": v.fast_detect_threshold <= 0,
        "invert_threshold": v.invert_threshold,
        "block_size": v.block_size,
        "c_val": v.c_val,
    }


@router.get("/settings")
async def get_vision_settings():
    return _vision_to_dict(get_vision())


@router.get("/status")
async def get_ai_status_endpoint():
    """AI model durumunu döndürür — frontend buton disable/retry için.

    ``uninitialized`` / ``loading`` / ``warming_up`` → buton disabled.
    ``ready`` → buton aktif. ``error`` → hata mesajı + retry.
    """
    return {"ai_status": ai_status()}


@router.post("/settings")
async def update_vision_settings(body: VisionSettingsBody):
    bk = body.blur_kernel if body.blur_kernel % 2 == 1 else body.blur_kernel + 1
    bs = body.block_size if body.block_size % 2 == 1 else body.block_size + 1
    thr = 0 if body.threshold_auto else body.fast_detect_threshold
    cfg = VisionConfig(
        blur_kernel=bk,
        fast_detect_threshold=thr,
        min_contour_area=body.min_contour_area,
        max_contour_area=body.max_contour_area,
        show_mask=body.show_mask,
        match_threshold=body.match_threshold,
        invert_threshold=body.invert_threshold,
        block_size=bs,
        c_val=body.c_val,
    )
    set_vision(cfg)
    return {"ok": True, **_vision_to_dict(cfg)}


class SnapshotDetectBody(BaseModel):
    # None → io-cam-runtime/.env içindeki IO_CAM_VLM_PROMPT / IO_CAM_VLM_MAX_STONES
    prompt: str | None = Field(default=None, max_length=200)
    thresh_val: int = Field(default=0, ge=0, le=255)
    invert_threshold: bool = True
    use_pca_angle: bool = True
    is_symmetric: bool = True
    draw: bool = True
    block_size: int = Field(default=31, ge=3, le=101)
    c_val: int = Field(default=8, ge=-20, le=50)
    # None → .env IO_CAM_VLM_MAX_STONES (varsayılan 1)
    max_stones: int | None = Field(default=None, ge=1, le=20)


@router.post("/snapshot-detect")
async def run_snapshot_detect(body: SnapshotDetectBody | None = None):
    import asyncio
    import base64
    import cv2
    from app.config.settings import load_settings
    from app.services import services

    if body is None:
        body = SnapshotDetectBody()

    live = load_settings()
    prompt = (body.prompt if body.prompt is not None else live.vlm_prompt).strip() or live.vlm_prompt
    max_stones = body.max_stones if body.max_stones is not None else live.vlm_max_stones

    status = ai_status()
    if status != "ready":
        # VLM hazır değilse 503 yerine durum bilgisini döndür — frontend buton
        # aktif kalsın, kullanıcı tıkladığında backend'in durumunu görsün.
        # ``ai_snapshot_detect`` çağırmaya gerek yok (zaten boş döner).
        return {
            "ok": False,
            "error": f"AI model hazır değil (durum: {status}). Lütfen bekleyin.",
            "ai_status": status,
        }

    camera = services.ensure_camera()
    try:
        frame = camera.capture()
    except RuntimeError as e:
        return {"ok": False, "error": str(e), "ai_status": status}
    if frame is None or frame.size == 0:
        return {"ok": False, "error": "Kamera çerçevesi alınamadı."}

    try:
        from app.vision.ai_detect import ai_snapshot_detect

        objects, out_frame, raw_text = ai_snapshot_detect(
            frame,
            prompt,
            thresh_val=body.thresh_val,
            invert_threshold=body.invert_threshold,
            use_pca_angle=body.use_pca_angle,
            is_symmetric=body.is_symmetric,
            draw=body.draw,
            block_size=body.block_size,
            c_val=body.c_val,
            max_stones=max_stones,
        )

        # stdout → .logs/runtime.log (uvicorn logger'a güvenmeden)
        # VLM detayı ai_detect._vlog ile runtime.log'a gidiyor — burada tekrar basma.

        _, buf = cv2.imencode(".jpg", out_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        image_b64 = base64.b64encode(buf).decode("ascii")

        return {
            "ok": True,
            "objects": objects,
            "vlm_text": raw_text,
            "prompt": prompt,
            "max_stones": max_stones,
            "image_base64": f"data:image/jpeg;base64,{image_b64}",
        }
    except Exception as e:
        import logging
        logging.getLogger(__name__).error("Snapshot AI detection failed: %s", e, exc_info=True)
        return {"ok": False, "error": str(e)}
