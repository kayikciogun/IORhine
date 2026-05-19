from __future__ import annotations

import re
from typing import Literal

from app.config.settings import settings
from app.motion.gcode_driver import GcodeDriver


class MotionController:
  def __init__(
      self,
      driver: GcodeDriver,
      *,
      rotation_axis: Literal["A", "E"] | None = None,
  ):
    self.driver = driver
    self.rotation_axis = rotation_axis or settings.rotation_axis
    self.c_pos = 0.0
    self._e_absolute = False

  def home(self) -> None:
    self.driver.send("G21")
    self.driver.send("G90")
    self.driver.send("G28")
    self.driver.send("G92 A0")
    self.c_pos = 0.0
    self.move_to_safe_z()

  def move_xy(self, x_mm: float, y_mm: float, feed: float | None = None) -> None:
    f = feed if feed is not None else settings.xy_feed
    self.driver.send(f"G0 X{x_mm:.3f} Y{y_mm:.3f} F{f:.0f}")

  def move_z(self, z_mm: float, feed: float | None = None) -> None:
    f = feed if feed is not None else settings.z_feed
    self.driver.send(f"G1 Z{z_mm:.3f} F{f:.0f}")
    self.sync()

  def move_to_safe_z(self) -> None:
    self.move_z(settings.safe_z)

  def rotate_c(self, delta_deg: float) -> None:
    self._rotate(delta_deg, relative=True)

  def rotate_c_to(self, abs_deg: float) -> None:
    delta = ((abs_deg - self.c_pos + 180) % 360) - 180
    self._rotate(delta, relative=True)
    self.c_pos = abs_deg % 360

  def _rotate(self, delta_deg: float, *, relative: bool) -> None:
    if abs(delta_deg) < 1e-6:
      return
    f = settings.rotation_feed
    if self.rotation_axis == "A":
      if relative:
        self.driver.send(f"G1 A{delta_deg:.3f} F{f:.0f}")
        self.c_pos = (self.c_pos + delta_deg) % 360
      else:
        self.driver.send(f"G1 A{delta_deg:.3f} F{f:.0f}")
        self.c_pos = delta_deg % 360
    else:
      if not self._e_absolute:
        self.driver.send("M82")
        self._e_absolute = True
      self.driver.send(f"G1 E{delta_deg:.3f} F{f:.0f}")
      self.c_pos = (self.c_pos + delta_deg) % 360

  def vacuum_on(self) -> None:
    self.driver.send("M106 S255")
    self.sync()

  def vacuum_off(self) -> None:
    self.driver.send("M107")
    self.sync()

  def vacuum_gripped(self) -> bool:
    """True if vacuum holds a stone. Uses sensor pin when configured."""
    pin = settings.vacuum_sensor_pin
    if pin is None:
      return True
    lines = self.driver.send(f"M42 P{pin}")
    text = " ".join(lines).lower()
    return "s255" in text or "1" in text

  def dwell(self, seconds: float) -> None:
    self.driver.send(f"G4 S{seconds:.3f}")

  def sync(self) -> None:
    self.driver.send("M400")

  def position(self) -> tuple[float, float, float, float]:
    lines = self.driver.send("M114")
    text = " ".join(lines)
    x = y = z = c = 0.0
    for axis, idx in (("X", 0), ("Y", 1), ("Z", 2), ("A", 3), ("E", 3)):
      m = re.search(rf"{axis}:\s*([-+]?\d*\.?\d+)", text, re.I)
      if m:
        val = float(m.group(1))
        if idx == 0:
          x = val
        elif idx == 1:
          y = val
        elif idx == 2:
          z = val
        else:
          c = val
    return x, y, z, c

  def emergency_stop(self) -> None:
    try:
      self.vacuum_off()
    except Exception:
      pass
    self.driver.send("M410")
