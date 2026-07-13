from __future__ import annotations

import os
import platform
from contextlib import asynccontextmanager

if platform.system() == "Darwin":
    # OpenCV'nin macOS'ta AVFoundation yetki kontrolünü arka plan thread'lerinde ("can not spin main run loop from other thread") çökmek yerine atlamasını sağlar.
    os.environ["OPENCV_AVFOUNDATION_SKIP_AUTH"] = "1"

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import calibration, camera, job, motion, vision, ws
from app.config.runtime_store import init_runtime_store
from app.config.settings import settings
from app.motion.config_store import apply_motion_config, load_motion_config
from app.services import services


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("IO_CAM_MOCK_HARDWARE", "").lower() in ("1", "true", "yes"):
        settings.mock_hardware = True
    apply_motion_config(settings, load_motion_config(settings.calibration_dir))
    init_runtime_store()

    # Server başlar başlamaz VLM modelini arka plan thread'inde yükle ve ısıt
    from app.vision.ai_detect import get_ai_model
    get_ai_model()
    yield
    # Lifespan teardown: motion driver + kamera thread/VideoCapture leak'i
    # önlemek için kapat (P1-6). Kamera arka plan thread + OpenCV capture
    # tutuyorsa release edilmezse process kapansa bile cihaz kilitli kalabilir.
    # P3-D: getattr ile güvenli erişim — test mock'ları ``driver`` attribute'e
    # sahip olmayabilir (MotionController yerine minimal mock kullanılırsa).
    _driver = getattr(services.motion, "driver", None) if services.motion else None
    if _driver and hasattr(_driver, "close"):
        try:
            _driver.close()
        except Exception:
            pass
    if services.camera is not None:
        try:
            services.camera.close()
        except Exception:
            pass


app = FastAPI(title="IO-CAM Runtime", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    # P3-G43: CORS restrict — ``*`` yerine explicit method/headers.
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(job.router)
app.include_router(camera.router)
app.include_router(motion.router)
app.include_router(calibration.router)
app.include_router(vision.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    try:
        from app.vision.ai_detect import _ai_status
        ai_status = _ai_status
    except ImportError:
        ai_status = "uninitialized"
        
    return {"status": "ok", "mock": settings.mock_hardware, "ai_status": ai_status}
