from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_FILENAME = "motion_config.json"

MOTION_CONFIG_KEYS = {
    "rotation_axis",
    "safe_z",
    "pick_z",
    "glue_z",
    "place_z",
    "xy_feed",
    "z_feed",
    "rotation_feed",
    "vacuum_on_dwell_s",
    "vacuum_off_dwell_s",
    "glue_dwell_s",
}


def motion_config_path(cal_dir: Path) -> Path:
    return cal_dir / _FILENAME


def load_motion_config(cal_dir: Path) -> dict[str, Any]:
    path = motion_config_path(cal_dir)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if k in MOTION_CONFIG_KEYS}


def save_motion_config(cal_dir: Path, data: dict[str, Any]) -> None:
    cal_dir.mkdir(parents=True, exist_ok=True)
    path = motion_config_path(cal_dir)
    payload = {k: data[k] for k in MOTION_CONFIG_KEYS if k in data}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def apply_motion_config(settings, data: dict[str, Any]) -> None:
    for key, value in data.items():
        if key in MOTION_CONFIG_KEYS:
            setattr(settings, key, value)
