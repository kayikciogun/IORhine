from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

from app.config.settings import settings
from app.glue_sheet.controller import GlueSheet
from app.motion.controller import MotionController
from app.motion.gcode_driver import GcodeDriver
from app.motion.mock_driver import MockSerial
from app.motion.serial_config import load_serial_port
from app.runtime.camera import Camera
from app.runtime.camera_sources import CameraSourceConfig, load_saved_config
from app.runtime.csv_loader import PlacementRow, parse_placement_csv, resolve_template_shape_id
from app.runtime.events import EventBus
from app.runtime.job_runner import JobRunner
from app.runtime.state import JobPhase, RuntimeContext
from app.vision.template_loader import StoneTemplate, build_template_from_dxf_bytes


@dataclass
class AppServices:
    ctx: RuntimeContext = field(default_factory=RuntimeContext)
    bus: EventBus = field(default_factory=EventBus)
    motion: MotionController | None = None
    glue: GlueSheet | None = None
    camera: Camera | None = None
    runner: JobRunner | None = None
    template: StoneTemplate | None = None
    rows: list[PlacementRow] = field(default_factory=list)
    # P3-D31: ``dxf_bytes`` kaldırıldı (write-only). ``ws_clients`` hâlâ
    # kullanılıyor (ws.py append/remove) — yanlışlıkla kaldırılmıştı, geri eklendi.
    ws_clients: list[Any] = field(default_factory=list)

    def ensure_glue(self) -> GlueSheet:
        """Yapışkan levha durumu — seri port / motion gerektirmez."""
        if self.glue is None:
            self.glue = GlueSheet.from_calibration(settings.calibration_dir, settings)
        return self.glue

    def reload_glue_sheet(self) -> GlueSheet:
        self.glue = None
        return self.ensure_glue()

    def ensure_camera(self) -> Camera:
        """Kamera önizlemesi — seri port gerektirmez (WebSocket için)."""
        if self.camera is None:
            mock = settings.mock_hardware
            saved = load_saved_config(settings.calibration_dir)
            cam_cfg = saved or CameraSourceConfig(
                kind="usb",
                source_id=str(settings.camera_index),
            )
            self.camera = Camera(cam_cfg, mock=mock)
        return self.camera

    def init_hardware(self) -> None:
        """Sync backward-compat wrapper — mock path veya sync serial için.

        P2-A9: Yeni kod ``await init_hardware_async()`` kullanmalı; bu sync
        versiyon mock-hardware veya test yolunda kalır. Gerçek serial open
        + 2 sn boot bekleme event loop'u bloklar.
        """
        mock = settings.mock_hardware
        self.ensure_camera()
        if self.motion is None:
            if mock:
                driver = GcodeDriver.from_serial(MockSerial())
            else:
                saved_port = load_serial_port(settings.calibration_dir)
                if saved_port:
                    settings.serial_port = saved_port
                driver = GcodeDriver(settings.serial_port, settings.serial_baud)
            self.motion = MotionController(driver)
        if self.glue is None:
            self.glue = GlueSheet.from_calibration(settings.calibration_dir, settings)

    async def init_hardware_async(self) -> None:
        """P2-A9: Async hardware init — serial open + 2 sn boot bekleme'yi
        ``asyncio.to_thread`` + ``await asyncio.sleep`` ile bloklamadan yapar.
        ``load_job`` zaten async; bu versiyonu tercih et.
        """
        mock = settings.mock_hardware
        self.ensure_camera()
        if self.motion is None:
            if mock:
                driver = GcodeDriver.from_serial(MockSerial())
            else:
                saved_port = load_serial_port(settings.calibration_dir)
                if saved_port:
                    settings.serial_port = saved_port
                # P2-A9: sync GcodeDriver(port, baud) yerine async factory.
                driver = await GcodeDriver.open(
                    settings.serial_port, settings.serial_baud
                )
            self.motion = MotionController(driver)
        if self.glue is None:
            self.glue = GlueSheet.from_calibration(settings.calibration_dir, settings)

    async def load_job(self, csv_text: str, dxf_bytes: bytes | None) -> dict:
        # Önceki job_runner varsa güvenli durdur: aksi halde yeni job yüklenirken
        # eski _run_loop hâlâ çalışıyor olabilir ve aynı hareket/seri port'u
        # paylaşır → donma veya çapraz komut karışması. stop() await'ı blocking
        # I/O'da takılırsa timeout/cancel ile sınırla.
        if self.runner is not None:
            try:
                await asyncio.wait_for(self.runner.stop(), timeout=5.0)
            except (asyncio.TimeoutError, Exception):
                # Görev hâlâ yaşıyorsa manuel iptal et
                t = getattr(self.runner, "_task", None)
                if t is not None and not t.done():
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass
            self.runner = None

        self.ctx.state.phase = JobPhase.PREPARING
        try:
            self.rows = parse_placement_csv(csv_text)
            template_shape_id = resolve_template_shape_id(self.rows)
            # P3-D31: dxf_bytes field kaldırıldı; sadece local param kullan.
            if dxf_bytes:
                self.template = build_template_from_dxf_bytes(template_shape_id, dxf_bytes)
            else:
                import numpy as np

                pts = np.array(
                    [[-5, -5], [5, -5], [5, 5], [-5, 5]], dtype=np.float32
                ).reshape(-1, 1, 2)
                from app.vision.template_loader import build_template_from_contour

                self.template = build_template_from_contour(template_shape_id, pts)
            if not self.template:
                raise ValueError(f"Could not build template for shape_id={template_shape_id}")
            if not self.motion:
                await self.init_hardware_async()
            if self.glue:
                self.glue.reset()
            # ``assert`` üretimde ``python -O`` ile silinir; bu yüzden açık
            # ``RuntimeError`` kullanıyoruz (P1-8).
            if not (self.motion and self.glue and self.camera and self.template):
                raise RuntimeError(
                    "Hardware hazırlığı eksik: "
                    f"motion={self.motion is not None}, glue={self.glue is not None}, "
                    f"camera={self.camera is not None}, template={self.template is not None}"
                )
            job_id = str(uuid.uuid4())[:8]
            self.ctx.state.job_id = job_id
            self.runner = JobRunner(
                self.ctx,
                self.bus,
                self.motion,
                self.glue,
                self.camera,
                self.template,
                self.rows,
                settings.calibration_dir,
            )
            await self.runner.prepare()
            return {"jobId": job_id}
        except Exception:
            self.ctx.state.phase = JobPhase.IDLE
            self.runner = None
            raise

    def get_calibration_summary(self) -> dict:
        cal = settings.calibration_dir
        return {
            "homography": (cal / "homography.npy").is_file(),
            "fabric_offset": (cal / "fabric_offset.json").is_file(),
            "glue_sheet": (cal / "glue_sheet.json").is_file(),
            "glue_sheet_state": (cal / "glue_sheet_state.json").is_file(),
        }


services = AppServices()
