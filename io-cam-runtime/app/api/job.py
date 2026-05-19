from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services import services

router = APIRouter(prefix="/api/job", tags=["job"])


@router.post("")
async def upload_job(
    csv: str = Form(...),
    dxf: UploadFile | None = File(None),
):
    dxf_bytes = None
    if dxf and dxf.filename:
        dxf_bytes = await dxf.read()
    try:
        result = await services.load_job(csv, dxf_bytes)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Runtime hardware hazırlanamadı: {e}. "
                "Gerçek Marlin kartı bağlı değilse ./scripts/start.sh --mock ile başlatın."
            ),
        ) from e


@router.get("/status")
async def job_status():
    return services.ctx.state.to_status()
