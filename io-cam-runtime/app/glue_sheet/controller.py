from __future__ import annotations

import json
from pathlib import Path


class GlueSheetExhausted(Exception):
    pass


class GlueSheet:
    def __init__(
        self,
        cols: int,
        rows: int,
        origin_xy: tuple[float, float],
        cell_size: float,
        z: float,
        *,
        state_path: Path | None = None,
    ):
        self.cols = cols
        self.rows = rows
        self.origin_x, self.origin_y = origin_xy
        self.cell_size = cell_size
        self.z = z
        self.state_path = state_path
        self.cursor = 0
        if state_path and state_path.is_file():
            data = json.loads(state_path.read_text(encoding="utf-8"))
            self.cursor = int(data.get("cursor", 0))

    @classmethod
    def from_calibration(cls, cal_dir: Path, settings) -> GlueSheet:
        cfg_path = cal_dir / "glue_sheet.json"
        cols, rows = settings.glue_cols, settings.glue_rows
        ox, oy, z = 0.0, 0.0, settings.glue_z
        cell = settings.glue_cell_size_mm
        if cfg_path.is_file():
            data = json.loads(cfg_path.read_text(encoding="utf-8"))
            cols = int(data.get("cols", cols))
            rows = int(data.get("rows", rows))
            ox = float(data.get("origin_x", ox))
            oy = float(data.get("origin_y", oy))
            z = float(data.get("z", z))
            cell = float(data.get("cell_size", cell))
        return cls(
            cols,
            rows,
            (ox, oy),
            cell,
            z,
            state_path=cal_dir / "glue_sheet_state.json",
        )

    def _save_state(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            json.dumps({"cursor": self.cursor}, indent=2),
            encoding="utf-8",
        )

    def next_cell(self) -> tuple[float, float, float]:
        """Bir sonraki boş hücrenin (x, y, z) merkezini döndür."""
        if self.cursor >= self.cols * self.rows:
            raise GlueSheetExhausted()
        idx = self.cursor
        col = idx % self.cols
        row = idx // self.cols
        half = self.cell_size / 2
        x = self.origin_x + col * self.cell_size + half
        y = self.origin_y + row * self.cell_size + half
        self.cursor += 1
        self._save_state()
        return x, y, self.z

    def remaining(self) -> int:
        return max(0, self.cols * self.rows - self.cursor)

    def reset(self) -> None:
        self.cursor = 0
        self._save_state()

    def status(self) -> dict:
        total = self.cols * self.rows
        return {
            "cursor": self.cursor,
            "total": total,
            "remaining": self.remaining(),
            "cols": self.cols,
            "rows": self.rows,
        }
