from __future__ import annotations

import os
from contextlib import asynccontextmanager

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
    yield
    if services.motion and hasattr(services.motion.driver, "close"):
        services.motion.driver.close()


app = FastAPI(title="IO-CAM Runtime", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(job.router)
app.include_router(camera.router)
app.include_router(motion.router)
app.include_router(calibration.router)
app.include_router(vision.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok", "mock": settings.mock_hardware}
