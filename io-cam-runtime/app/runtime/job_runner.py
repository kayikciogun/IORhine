from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

from app.config.settings import load_settings, settings
from app.glue_sheet.controller import GlueSheetExhausted
from app.motion.kinematics import FabricOffset, fabric_to_robot
from app.runtime.csv_loader import PlacementRow
from app.runtime.state import JobPhase
from app.vision.calibration import load_fabric_offset, load_homography
from app.vision.ai_detect import (
    Stone,
    detect_all,
    exclusion_box,
    grow_exclusion_box,
    ai_status as _ai_status_fn,
)

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


def is_face_up(stone: Stone, min_true_confidence: float = 0.80) -> bool:
    return stone.orientation == "true" and float(stone.orientation_confidence) >= min_true_confidence


def select_stone_to_pick(
    stones: list[Stone],
    head_xy: tuple[float, float],
    *,
    min_true_confidence: float = 0.80,
) -> Stone | None:
    """Yüz-yukarı (orientation=true) ve emin taşlardan en yakını seç.

    Aynı karede birden fazla taş zaten listelenmişse kullanılır.
    Pick döngüsü bunun yerine ``seek_pickable_stone`` ile tek tek arar.
    """
    pickable = [s for s in stones if is_face_up(s, min_true_confidence)]
    if not pickable:
        return None
    return nearest_stone(pickable, head_xy)


def rejection_box(stone: Stone, pad: int = 24) -> tuple[int, int, int, int]:
    """False taşın piksel kutusu — sonraki VLM çağrısında bu bölge kapanır."""
    del pad
    return exclusion_box(
        stone.bx1, stone.by1, stone.bx2, stone.by2,
        cx=stone.x, cy=stone.y, area=stone.area,
    )


def _already_rejected(
    stone: Stone,
    rejected: list[Stone],
    boxes: list[tuple[int, int, int, int]],
    tol_px: float = 18.0,
) -> bool:
    tol2 = tol_px * tol_px
    for prev, box in zip(rejected, boxes):
        if (stone.x - prev.x) ** 2 + (stone.y - prev.y) ** 2 <= tol2:
            return True
        x1, y1, x2, y2 = box
        if x1 <= stone.x <= x2 and y1 <= stone.y <= y2:
            return True
    return False


def seek_pickable_stone(
    detect,
    frame,
    template,
    *,
    cal_dir,
    skip_limit: int,
    min_true_confidence: float = 0.80,
) -> tuple[Stone | None, list[Stone]]:
    """Her seferinde tek taş iste. False ise kutusunu kapat, sıradakini iste.

    İlk taş true ise tek VLM çağrısı yeter. Hepsi false ise ``skip_limit``
    kadar dener ve (None, elenenler) döner — çağıran yeni kare bekler.
    VLM maskeye rağmen aynı taşı tekrar verirse arama durur.
    """
    excluded: list[tuple[int, int, int, int]] = []
    rejected: list[Stone] = []
    grows = 0
    for _ in range(max(1, int(skip_limit))):
        stones = detect(
            frame,
            template,
            cal_dir=cal_dir,
            max_stones=1,
            exclude_boxes=excluded or None,
        )
        if not stones:
            return None, rejected
        stone = stones[0]
        if _already_rejected(stone, rejected, excluded):
            if grows < 2 and excluded:
                excluded[-1] = grow_exclusion_box(excluded[-1])
                grows += 1
                continue
            return None, rejected
        grows = 0
        if is_face_up(stone, min_true_confidence):
            return stone, rejected
        rejected.append(stone)
        excluded.append(rejection_box(stone))
    return None, rejected


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
        # ── Kalibrasyon kontrolü — homography yoksa pick yanlış yere gider ──
        homography = load_homography(self.cal_dir)
        if homography is None:
            self.ctx.state.phase = JobPhase.ERROR
            self.ctx.state.message = (
                "homography.npy yok — kalibrasyon yapın (CalibrationPanel > Homography)"
            )
            await self.bus.emit(
                "error",
                {
                    "code": "calibration_missing",
                    "msg": self.ctx.state.message,
                },
            )
            return

        # ── Vacuum sensör uyarısı — pin yoksa pick başarısı doğrulanamaz ──
        if settings.vacuum_sensor_pin is None:
            await self.bus.emit(
                "error",
                {
                    "code": "vacuum_sensor_missing",
                    "msg": "vacuum_sensor_pin ayarlı değil — pick başarısı doğrulanamıyor (her zaman True)",
                },
            )

        dx, dy = load_fabric_offset(self.cal_dir)
        offset = FabricOffset(dx=dx, dy=dy)
        # Fabric offset yoksa (0,0) döner — place koordinatları kayar.
        # Hard-fail değil ama operatöre uyarı ver.
        if dx == 0.0 and dy == 0.0:
            await self.bus.emit(
                "error",
                {
                    "code": "fabric_offset_missing",
                    "msg": "fabric_offset.json yok — yerleşim merkeze kayabilir (CalibrationPanel > Fabric)",
                },
            )
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
                try:
                    frame = self.camera.capture()
                except RuntimeError as e:
                    await self.bus.emit(
                        "error",
                        {"code": "camera", "msg": str(e)},
                    )
                    await asyncio.sleep(settings.settling_ms / 1000.0)
                    empty_retries += 1
                    if empty_retries >= settings.empty_stone_retries:
                        self.ctx.state.phase = JobPhase.ERROR
                        self.ctx.state.message = f"camera_capture_failed after {empty_retries} retries: {e}"
                        await self.bus.emit(
                            "error",
                            {"code": "camera", "msg": self.ctx.state.message},
                        )
                        return
                    continue
                # VLM henüz ready değilse detect_all boş liste döner (ai_snapshot_detect
                # içinde ``_ai_status != "ready"`` kontrolü var). Bu durumda job'u
                # PAUSE yapıp operatörü uyar — eski kod boş liste alıp "taş yok" sanıp
                # retry tüketiyordu. ``_ai_status_fn`` module-level referans → testler
                # monkey-patch'leyebilir.
                if _ai_status_fn() != "ready":
                    self.ctx.state.phase = JobPhase.PAUSED
                    self.ctx.state.message = (
                        "AI model hazır değil — VLM ısınması bitene kadar bekleyin, sonra resume."
                    )
                    await self.bus.emit(
                        "error",
                        {
                            "code": "ai_not_ready",
                            "msg": self.ctx.state.message,
                        },
                    )
                    await self.ctx.pause_event.wait()
                    if self.ctx.stop_requested:
                        return
                    continue
                # Her VLM çağrısı 1 taş (hızlı). False ise o kutu kapanır,
                # sıradaki tek taş istenir. Limit dolunca bu kare bırakılır.
                stone, rejected = await asyncio.to_thread(
                    seek_pickable_stone,
                    detect_all,
                    frame,
                    self.template,
                    cal_dir=self.cal_dir,
                    skip_limit=load_settings().vlm_false_skip_limit,
                )

                if stone is None and not rejected:
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

                if stone is None:
                    await self.bus.emit(
                        "operator_feed_required",
                        {
                            "reason": "no_true_orientation",
                            "detected": len(rejected),
                            "skipped_false": len(rejected),
                            "orientations": [s.orientation for s in rejected],
                        },
                    )
                    await asyncio.sleep(settings.settling_ms / 1000.0)
                    empty_retries += 1
                    if empty_retries >= settings.empty_stone_retries:
                        self.ctx.state.phase = JobPhase.ERROR
                        self.ctx.state.message = (
                            f"no_true_orientation_stone after {empty_retries} frames "
                            f"at row {i} (skipped_false={len(rejected)})"
                        )
                        await self.bus.emit(
                            "error",
                            {
                                "code": "no_true_orientation_stone",
                                "msg": self.ctx.state.message,
                            },
                        )
                        return
                    continue

                empty_retries = 0
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
