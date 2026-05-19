from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FabricOffset:
    dx: float = 0.0
    dy: float = 0.0


def fabric_to_robot(
    target_x: float,
    target_y: float,
    offset: FabricOffset,
) -> tuple[float, float]:
    return target_x + offset.dx, target_y + offset.dy
