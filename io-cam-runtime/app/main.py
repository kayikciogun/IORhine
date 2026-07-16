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

    import asyncio
    import logging

    _log = logging.getLogger(__name__)
    loop = asyncio.get_running_loop()

    # AI durum değişimlerini control WS üzerinden UI'ye yayınla
    def _broadcast_ai_status(status: str) -> None:
        asyncio.run_coroutine_threadsafe(
            services.bus.emit("ai_status", {"status": status}),
            loop,
        )

    from app.vision.vlm_worker import on_ai_status_change

    on_ai_status_change(_broadcast_ai_status)

    # Server başlar başlamaz VLM modelini arka plan thread'inde yükle + compile warmup
    from app.vision.ai_detect import get_ai_model

    get_ai_model()

    async def _preload_orientation() -> None:
        from app.vision.orientation_classifier import preload_orientation_model

        try:
            ok = await asyncio.to_thread(preload_orientation_model)
            if ok:
                _log.info("Orientation ONNX model önceden yüklendi")
                await services.bus.emit(
                    "ai_status",
                    {"status": "orientation_ready", "detail": "orientation_onnx"},
                )
            else:
                _log.warning("Orientation ONNX ön yükleme atlandı / başarısız")
        except Exception as e:
            _log.warning("Orientation ONNX ön yükleme hatası: %s", e)

    # Son kaydedilen kamerayı arka planda aç — üretim sayfasında "Bağla" tıklaması gerekmesin.
    async def _restore_saved_camera() -> None:
        from app.runtime.camera_sources import load_saved_config

        saved = load_saved_config(settings.calibration_dir)
        if saved is None and not settings.mock_hardware:
            return
        cam = services.ensure_camera()
        try:
            await asyncio.to_thread(cam.open)
            _log.info(
                "Kayıtlı kamera otomatik açıldı: %s:%s",
                cam.config.kind if cam.config else "?",
                cam.config.source_id if cam.config else "?",
            )
        except Exception as e:
            _log.warning("Kayıtlı kamera otomatik açılamadı: %s", e)

    asyncio.create_task(_preload_orientation())
    asyncio.create_task(_restore_saved_camera())
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
        from app.vision.ai_detect import ai_status as _ai_status_fn

        status = _ai_status_fn()
    except ImportError:
        status = "uninitialized"

    return {"status": "ok", "mock": settings.mock_hardware, "ai_status": status}
