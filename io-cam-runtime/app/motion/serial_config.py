from __future__ import annotations

import json
from pathlib import Path

_FILENAME = "motion_serial.json"


def load_serial_port(cal_dir: Path) -> str | None:
    path = cal_dir / _FILENAME
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    port = data.get("serial_port")
    return str(port) if port else None


def save_serial_port(cal_dir: Path, serial_port: str) -> None:
    cal_dir.mkdir(parents=True, exist_ok=True)
    path = cal_dir / _FILENAME
    path.write_text(
        json.dumps({"serial_port": serial_port}, indent=2),
        encoding="utf-8",
    )
