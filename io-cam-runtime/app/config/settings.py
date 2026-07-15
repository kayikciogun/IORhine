from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_CONFIG_DIR = Path(__file__).resolve().parent
_RUNTIME_ROOT = _CONFIG_DIR.parents[1]  # io-cam-runtime/
_REPO_ROOT = _RUNTIME_ROOT.parent
_DEFAULT_MOTION = _CONFIG_DIR / "motion.json"


def _dotenv_files() -> tuple[str, ...] | None:
    """Tek `.env` — repo kökü. Tüm app (frontend + runtime) buradan okur.

    Eskiden ``io-cam-runtime/.env`` de okunuyordu; iki dosyanın değerleri
    çakışınca kafa karıştırıyordu. Artık yalnızca kök ``.env`` kullanılır.
    """
    path = _REPO_ROOT / ".env"
    return (str(path),) if path.is_file() else None


def _load_motion_defaults() -> dict:
    if _DEFAULT_MOTION.is_file():
        return json.loads(_DEFAULT_MOTION.read_text(encoding="utf-8"))
    return {}


_motion = _load_motion_defaults()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="IO_CAM_",
        env_file=_dotenv_files(),
        env_file_encoding="utf-8",
        # .env değişince process env'de eski değer kalmasın diye file'ı her seferinde oku
        env_ignore_empty=True,
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:9002,http://127.0.0.1:9002"

    calibration_dir: Path = Field(
        default_factory=lambda: Path(__file__).resolve().parents[2] / "calibration"
    )

    mock_hardware: bool = False
    serial_port: str = "/dev/ttyUSB0"
    serial_baud: int = 115200
    # GcodeDriver.send() komut başına deadline (s); kart 'ok' göndermezse burada
    # MarlinError fırlatır. Hareket + dwell + rotation için yeterli olmalı (≥ 5 s).
    serial_timeout_s: float = 10.0

    settling_ms: int = 300
    empty_stone_retries: int = 5
    vacuum_pick_retries: int = 2
    vacuum_sensor_pin: int | None = None

    min_contour_area: int = 50
    blur_kernel: int = 3
    match_threshold: float = 0.25

    glue_cell_size_mm: float = 20.0
    glue_cols: int = 100
    glue_rows: int = 100

    camera_index: int = 0
    camera_idle_fps: float = 24.0
    fast_detect_threshold: int = 130
    max_contour_area: int = 80000
    show_mask: bool = False
    invert_threshold: bool = True

    camera_jpeg_quality: int = 60
    # Stream optimize: encode öncesi downscale (0 = devre dışı).
    # 720p/1080p kamera → 640px'e düşür base64 payload'u küçült + encode hızlansın.
    camera_stream_max_width: int = 640

    # VLM detection — .env'den canlı okunur (load_settings); frontend kodu değişmez.
    vlm_prompt: str = "single black rhinestone"
    vlm_max_stones: int = Field(default=1, ge=1, le=20)

    # Orientation CNN (ONNX) — VLM bbox crop → true / false
    orientation_model_dir: Path = Field(
        default_factory=lambda: _RUNTIME_ROOT / "datasets" / "orientation_model_v2"
    )

    rotation_axis: Literal["A", "E"] = _motion.get("rotation_axis", "A")  # type: ignore[arg-type]
    safe_z: float = _motion.get("safe_z", 5.0)
    pick_z: float = _motion.get("pick_z", 0.5)
    glue_z: float = _motion.get("glue_z", 0.5)
    place_z: float = _motion.get("place_z", 0.5)
    xy_feed: float = _motion.get("xy_feed", 3000)
    z_feed: float = _motion.get("z_feed", 600)
    rotation_feed: float = _motion.get("rotation_feed", 3600)
    vacuum_on_dwell_s: float = _motion.get("vacuum_on_dwell_s", 0.15)
    vacuum_off_dwell_s: float = _motion.get("vacuum_off_dwell_s", 0.15)
    glue_dwell_s: float = _motion.get("glue_dwell_s", 0.5)

    # P3-G45: WebSocket auth token — ``?token=`` query param ile doğrulama.
    # Boş string → auth disabled (dev/test). Production'ta ``IO_CAM_CONTROL_TOKEN``
    # env var ile set et.
    control_token: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


def load_settings() -> Settings:
    """``.env`` dosyasını her çağrıda yeniden okur — prompt değişince runtime restart gerekmez."""
    return Settings()
