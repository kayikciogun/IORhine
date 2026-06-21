from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass


@dataclass
class PlacementRow:
    id: int
    target_x: float
    target_y: float
    target_angle: float
    shape_id: str
    thickness: float = 0.0


def parse_placement_csv(text: str) -> list[PlacementRow]:
    reader = csv.DictReader(io.StringIO(text.strip()))
    rows: list[PlacementRow] = []
    for r in reader:
        # P2-A2: thickness negatif/NaN/Inf → Z negatif → kafa çarpar. Ayrıca
        # CSV kolon eksikliği ``KeyError`` fırlatır; row context ile sarmala.
        try:
            raw_thickness = r.get("thickness")
            thickness = (
                float(raw_thickness) if raw_thickness not in (None, "") else 0.0
            )
        except (TypeError, ValueError) as e:
            raise ValueError(
                f"row {r.get('id')!r}: invalid thickness {raw_thickness!r}"
            ) from e
        if not math.isfinite(thickness) or thickness < 0:
            raise ValueError(
                f"row {r.get('id')!r}: thickness must be >= 0 and finite, got {thickness}"
            )
        try:
            rows.append(
                PlacementRow(
                    id=int(r["id"]),
                    target_x=float(r["target_x"]),
                    target_y=float(r["target_y"]),
                    target_angle=float(r["target_angle"]),
                    shape_id=str(r["shape_id"]).strip(),
                    thickness=thickness,
                )
            )
        except KeyError as e:
            raise ValueError(
                f"row {r.get('id')!r}: missing required column {e}"
            ) from e
        except (TypeError, ValueError) as e:
            raise ValueError(f"row {r.get('id')!r}: {e}") from e
    return rows


# P3-D29: ``validate_single_shape`` kaldırıldı — dead code (only test çağırıyordu).
# ``resolve_template_shape_id(rows, strict=True)`` ile aynı işlevi yapar.


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
