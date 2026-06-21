from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from app.config.settings import settings
from app.glue_sheet.controller import GlueSheetExhausted
from app.motion.kinematics import FabricOffset, fabric_to_robot
from app.runtime.csv_loader import PlacementRow
from app.runtime.state import JobPhase
from app.vision.calibration import load_fabric_offset
from app.vision.detector import Stone, detect_all

if TYPE_CHECKING:
    from app.glue_sheet.controller import GlueSheet
    from app.motion.controller import MotionController
    from app.runtime.camera import Camera
    from app.runtime.events import EventBus
    from app.runtime.state import RuntimeContext
    from app.vision.template_loader import StoneTemplate


def nearest_stone(stones: list[Stone], head_xy: tuple[float, float]) -> Stone:
    hx, hy = head_xy
    return min(stones, key=lambda s: (s.robot_x - hx) ** 2 + (s.robot_y - hy) ** 2)


def shortest_delta_c(target: float, current: float) -> float:
    delta = target - current
    return ((delta + 180) % 360) - 180


class JobRunner:
    def __init__(
        self,
        ctx: RuntimeContext,
        bus: EventBus,
        motion: MotionController,
        glue: GlueSheet,
        camera: Camera,
        template: StoneTemplate,
        rows: list[PlacementRow],
        cal_dir,
    ):
        self.ctx = ctx
        self.bus = bus
        self.motion = motion
        self.glue = glue
        self.camera = camera
        self.template = template
        self.rows = rows
        self.cal_dir = cal_dir
        self._task: asyncio.Task | None = None

    async def prepare(self) -> None:
        self.ctx.state.phase = JobPhase.PREPARING
        self.ctx.vacuum_fail_streak = 0
        await self.bus.emit("state", {"phase": "preparing", "i": 0, "total": len(self.rows)})
        self.motion.home()
        self.camera.open()
        self.ctx.state.phase = JobPhase.READY
        self.ctx.state.total = len(self.rows)
        self.ctx.state.index = 0
        await self.bus.emit("state", {"phase": "ready", "i": 0, "total": len(self.rows)})

    async def start(self) -> None:
        # Yalnızca READY (veya PAUSED → start yok, resume kullan) fazında başlat.
        # Aksi halde kullanıcı yanlışlıkla çalışan bir job'ı yeniden başlatmaya
        # çalışır; faz durumu idempotent tutulmalı.
        if self._task and not self._task.done():
            return
        if self.ctx.state.phase != JobPhase.READY:
            await self.bus.emit(
                "error",
                {
                    "code": "invalid_phase",
                    "msg": f"start() yalnızca ready fazında; mevcut={self.ctx.state.phase.value}",
                },
            )
            return
        self.ctx.stop_requested = False
        self.ctx.state.phase = JobPhase.RUNNING
        self._task = asyncio.create_task(self._run_loop())

    async def pause(self) -> None:
        self.ctx.state.phase = JobPhase.PAUSED
        self.ctx.pause_event.clear()
        await self.bus.emit("state", {"phase": "paused", "i": self.ctx.state.index, "total": self.ctx.state.total})

    async def resume(self) -> None:
        self.ctx.state.phase = JobPhase.RUNNING
        self.ctx.pause_event.set()
        await self.bus.emit("state", {"phase": "running", "i": self.ctx.state.index, "total": self.ctx.state.total})

    async def stop(self) -> None:
        """İşi güvenli durdur.

        ``await self._task`` blocking I/O'da sonsuza kadar bekleyebilir; bu yüzden
        görevi kısa bir süre içinde tamamlanmasını bekler, sonra iptal eder.
        """
        self.ctx.stop_requested = True
        self.ctx.pause_event.set()  # pause'ta bekliyorsa uyandır
        self.ctx.state.phase = JobPhase.STOPPING
        task = self._task
        if task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
        except asyncio.TimeoutError:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        except (asyncio.CancelledError, Exception):
            pass

    async def _run_loop(self) -> None:
        dx, dy = load_fabric_offset(self.cal_dir)
        offset = FabricOffset(dx=dx, dy=dy)
        i = self.ctx.state.index
        total = len(self.rows)
        empty_retries = 0

        try:
            while i < total:
                if self.ctx.stop_requested:
                    break
                await self.ctx.pause_event.wait()

                hedef = self.rows[i]
                t0 = time.monotonic()

                # ── PICK (vision) ──────────────────────────────────────────────
                await asyncio.sleep(settings.settling_ms / 1000.0)
                frame = self.camera.capture()
                stones = detect_all(frame, self.template, cal_dir=self.cal_dir)

                if not stones:
                    await self.bus.emit("operator_feed_required", {})
                    await asyncio.sleep(settings.settling_ms / 1000.0)
                    empty_retries += 1
                    if empty_retries >= settings.empty_stone_retries:
                        # Retry aşımı: döngüyü durdur + ERROR fazına geç.
                        # Eski davranış "continue" ile aynı satıra sonsuza dek takılıyordu.
                        self.ctx.state.phase = JobPhase.ERROR
                        self.ctx.state.message = (
                            f"no_stone_detected after {empty_retries} retries at row {i}"
                        )
                        await self.bus.emit(
                            "error",
                            {
                                "code": "no_stone_detected",
                                "msg": self.ctx.state.message,
                            },
                        )
                        return
                    continue
                empty_retries = 0

                head = self.motion.position()
                stone = nearest_stone(stones, (head[0], head[1]))
                pick_x, pick_y = stone.robot_x, stone.robot_y

                # Pick Z: taş yüzeyine inmek için kumaş Z + taş kalınlığı
                pick_z_with_thickness = settings.pick_z + hedef.thickness

                picked = False
                max_attempts = settings.vacuum_pick_retries + 1
                for _attempt in range(max_attempts):
                    self.motion.move_to_safe_z()
                    self.motion.move_xy(pick_x, pick_y)
                    self.motion.sync()
                    self.motion.move_z(pick_z_with_thickness)
                    self.motion.vacuum_on()
                    self.motion.dwell(settings.vacuum_on_dwell_s)
                    self.motion.move_to_safe_z()
                    if self.motion.vacuum_gripped():
                        picked = True
                        break
                    self.motion.vacuum_off()
                if not picked:
                    # Aynı satır için pick başarısız: kullanıcı README'ye göre bu
                    # satırı atlayıp devam etmeyi seçebilir, ama art arda çok
                    # satırda aynı hata olursa büyük bir sorun var — sıralı olarak
                    # ``vacuum_pick_failed`` event'lerini gösteriyoruz, sonra ERROR'a
                    # geçiyoruz ki frontend ve kullanıcı durumu net görsün.
                    self.ctx.vacuum_fail_streak += 1
                    await self.bus.emit(
                        "error",
                        {
                            "code": "vacuum_pick_failed",
                            "msg": (
                                f"Vacuum pick failed after {max_attempts} attempts "
                                f"(row {i}, streak {self.ctx.vacuum_fail_streak})"
                            ),
                        },
                    )
                    if self.ctx.vacuum_fail_streak >= settings.vacuum_pick_retries + 1:
                        self.ctx.state.phase = JobPhase.ERROR
                        self.ctx.state.message = (
                            f"Vacuum pick failed {self.ctx.vacuum_fail_streak} satır üst üste"
                        )
                        await self.bus.emit(
                            "error",
                            {
                                "code": "vacuum_pick_failed",
                                "msg": self.ctx.state.message,
                            },
                        )
                        return
                    continue
                # Başarılı pick → streak'i sıfırla
                self.ctx.vacuum_fail_streak = 0

                # ── ROTATE ─────────────────────────────────────────────────────
                # delta_c = CSV target_angle − vision stone.angle
                delta_c = shortest_delta_c(hedef.target_angle, stone.angle)
                if abs(delta_c) > 0.5:
                    self.motion.rotate_c(delta_c)

                # ── GLUE ───────────────────────────────────────────────────────
                # P2-A8: reserve_cell + commit pattern. Eski ``next_cell`` cursor'u
                # motion başarısından ÖNCE ilerletiyordu — motion fail olursa
                # gap oluşuyordu. Şimdi: reserve (no advance) → motion → commit.
                try:
                    glue_cell_num = self.glue.cursor + 1
                    gx, gy, gz = self.glue.reserve_cell()
                    await self.bus.emit(
                        "glue_cell",
                        {"cell": glue_cell_num, "x": gx, "y": gy},
                    )
                except GlueSheetExhausted:
                    # Levha bitti: operatörün reset + WS resume yapması gerekiyor
                    # (README §10). Eski kod ``pause_event.wait()`` sonrası tekrar
                    # ``next_cell()`` çağırıyordu; bu, reset yapılmadan resume
                    # gelirse sonsuz tükenme döngüsü yaratıyordu. Şimdi:
                    #   1. exhausted event'i yayınla, faz = paused
                    #   2. resume gelene kadar bekle
                    #   3. tekrar dene — başarısızsa ERROR'a geç (sonsuz döngü yok)
                    self.ctx.state.phase = JobPhase.PAUSED
                    await self.bus.emit("glue_sheet_exhausted", {})
                    await self.ctx.pause_event.wait()
                    if self.ctx.stop_requested:
                        return
                    try:
                        glue_cell_num = self.glue.cursor + 1
                        gx, gy, gz = self.glue.reserve_cell()
                        await self.bus.emit(
                            "glue_cell",
                            {"cell": glue_cell_num, "x": gx, "y": gy},
                        )
                    except GlueSheetExhausted:
                        # Operatör levhayı değiştirmemiş/reset etmemiş — ERROR'a düş.
                        self.ctx.state.phase = JobPhase.ERROR
                        self.ctx.state.message = (
                            "GlueSheetExhausted persists after resume; "
                            "POST /api/glue_sheet/reset gerekli"
                        )
                        await self.bus.emit(
                            "error",
                            {
                                "code": "glue_sheet_exhausted",
                                "msg": self.ctx.state.message,
                            },
                        )
                        return

                self.motion.move_xy(gx, gy)
                self.motion.sync()
                # Glue Z: yapışkan levha yüzeyi + taş kalınlığı (taş kafada, altı yapışkana değmeli)
                glue_z_with_thickness = gz + hedef.thickness
                self.motion.move_z(glue_z_with_thickness)
                self.motion.dwell(settings.glue_dwell_s)
                self.motion.move_to_safe_z()
                # P2-A8: motion başarılı → hücreyi commit et (cursor advance + save).
                self.glue.commit()

                # ── PLACE ──────────────────────────────────────────────────────
                rx, ry = fabric_to_robot(hedef.target_x, hedef.target_y, offset)
                # Place Z: taşı bırakmak için kumaş Z + taş kalınlığı (taş kafada, nozzle altında)
                place_z_with_thickness = settings.place_z + hedef.thickness
                self.motion.move_xy(rx, ry)
                self.motion.sync()
                self.motion.move_z(place_z_with_thickness)
                self.motion.vacuum_off()
                self.motion.dwell(settings.vacuum_off_dwell_s)
                self.motion.move_to_safe_z()

                self.motion.rotate_c_to(0)
                self.motion.sync()

                i += 1
                self.ctx.state.index = i
                took_ms = int((time.monotonic() - t0) * 1000)
                await self.bus.emit("placed", {"i": i, "took_ms": took_ms})
                await self.bus.emit(
                    "state",
                    {"phase": "running", "i": i, "total": total},
                )

            if not self.ctx.stop_requested:
                self.ctx.state.phase = JobPhase.COMPLETE
                self.motion.home()
                await self.bus.emit("job_complete", {})
            else:
                self.ctx.state.phase = JobPhase.IDLE
        except Exception as e:
            self.ctx.state.phase = JobPhase.ERROR
            self.ctx.state.message = str(e)
            await self.bus.emit("error", {"code": "runtime_error", "msg": str(e)})
            # Güvenlik: exception sonrası robot güvensiz konumda kalabilir
            # (vakum açık, Z aşağıda, vs.). emergency_stop() vakumu kapatır +
            # M410 gönderir. Bu olmadan taş havada asılı kalabilir (P1-9).
            try:
                if self.motion is not None:
                    self.motion.emergency_stop()
            except Exception:
                pass
