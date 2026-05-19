from __future__ import annotations

import csv
import io
from dataclasses import dataclass


@dataclass
class PlacementRow:
    id: int
    target_x: float
    target_y: float
    target_angle: float
    shape_id: str


def parse_placement_csv(text: str) -> list[PlacementRow]:
    reader = csv.DictReader(io.StringIO(text.strip()))
    rows: list[PlacementRow] = []
    for r in reader:
        rows.append(
            PlacementRow(
                id=int(r["id"]),
                target_x=float(r["target_x"]),
                target_y=float(r["target_y"]),
                target_angle=float(r["target_angle"]),
                shape_id=str(r["shape_id"]).strip(),
            )
        )
    return rows


def validate_single_shape(rows: list[PlacementRow]) -> str:
    """Tek shape_id zorunluluğu (eski API)."""
    return resolve_template_shape_id(rows, strict=True)


def resolve_template_shape_id(rows: list[PlacementRow], *, strict: bool = False) -> str:
    """
    Vision şablonu için DXF handle döndürür.
    CSV'de birden fazla shape_id olabilir (her kontur farklı handle);
    bu durumda ilk satırın handle'ı şablon olarak kullanılır (konveyörde aynı taş tipi).
    """
    if not rows:
        raise ValueError("CSV is empty")
    shapes = {r.shape_id for r in rows}
    if len(shapes) == 1:
        return next(iter(shapes))
    if strict:
        raise ValueError(f"Expected single shape_id per job, got: {shapes}")
    return rows[0].shape_id
