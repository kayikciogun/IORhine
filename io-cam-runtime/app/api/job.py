from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services import services

router = APIRouter(prefix="/api/job", tags=["job"])

# P3-G44: Upload size limit — büyük CSV/DXF memory exhaustion'i önler.
MAX_CSV_SIZE = 1 * 1024 * 1024  # 1 MB
MAX_DXF_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("")
async def upload_job(
    csv: str = Form(...),
    dxf: UploadFile | None = File(None),
):
    # P3-G44: CSV boyut kontrolü (Form string olarak gelir, len ile kontrol).
    if len(csv.encode('utf-8')) > MAX_CSV_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"CSV çok büyük ({len(csv)} bytes > {MAX_CSV_SIZE} bytes)",
        )
    dxf_bytes = None
    if dxf and dxf.filename:
        # P3-G44: DXF boyut kontrolü — read()'den önce content-type'dan kontrol et,
        # tamamen oku sonra kontrol et (SpooledTemporaryFile boyutu bilinmiyor olabilir).
        dxf_bytes = await dxf.read()
        if len(dxf_bytes) > MAX_DXF_SIZE:
            raise HTTPException(
                status_code=413,
                detail=f"DXF çok büyük ({len(dxf_bytes)} bytes > {MAX_DXF_SIZE} bytes)",
            )
    try:
        result = await services.load_job(csv, dxf_bytes)
        return result
    except (ValueError, KeyError) as e:
        # CSV kolon eksikliği ``KeyError`` fırlatır; bu istemci hatası → 400.
        # ``ValueError`` zaten 400'dü; ikisini bir arada yakala (P1-5).
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
