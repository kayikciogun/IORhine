from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_CONFIG_DIR = Path(__file__).resolve().parent
_DEFAULT_MOTION = _CONFIG_DIR / "motion.json"


def _load_motion_defaults() -> dict:
    if _DEFAULT_MOTION.is_file():
        return json.loads(_DEFAULT_MOTION.read_text(encoding="utf-8"))
    return {}


_motion = _load_motion_defaults()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="IO_CAM_",
        env_file=".env",
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

    settling_ms: int = 300
    empty_stone_retries: int = 5
    vacuum_pick_retries: int = 2
    vacuum_sensor_pin: int | None = None

    min_contour_area: int = 500
    blur_kernel: int = 9
    match_threshold: float = 0.15

    glue_cell_size_mm: float = 20.0
    glue_cols: int = 100
    glue_rows: int = 100

    camera_index: int = 0
    camera_idle_fps: float = 30.0
    fast_detect_threshold: int = 120
    max_contour_area: int = 80000
    show_mask: bool = False
    camera_jpeg_quality: int = 80

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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
