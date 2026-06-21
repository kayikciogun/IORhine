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
    # C eksenini sıfırla — ``rotation_axis`` "A" veya "E" olabilir; firmware'de
    # hangisi yapılandırıldıysa onu kullan. G92 A0 her zaman çalışmaz (E modunda
    # Marlin A'yı ekstruder olarak yorumlayabilir).
    rot = (self.rotation_axis or "A").upper()
    if rot == "A":
      self.driver.send("G92 A0")
    else:
      self.driver.send("G92 E0")
      # E modunda sonraki hareketler için mutlak moda dönmek güvenli; relative
      # dönüşler _rotate tarafından M82 + G91 ile yapılıyor.
    self.c_pos = 0.0
    self._e_absolute = False
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
      # Marlin A ekseni relative modda delta alır; mutlak ise delta yerine hedef açıyı yaz.
      if relative:
        self.driver.send(f"G1 A{delta_deg:.3f} F{f:.0f}")
      else:
        self.driver.send(f"G1 A{delta_deg:.3f} F{f:.0f}")
      self.c_pos = (self.c_pos + (delta_deg if relative else 0.0)) % 360
      if not relative:
        self.c_pos = delta_deg % 360
    else:
      # E ekseni: M82 mutlak, M83 relative. delta_deg her zaman bağıl dönüş;
      # mutlak hedef istendiyse rotate_c_to() zaten delta'ya çevirdi. Bu yüzden
      # her seferinde relative mod (M83 + G1 E<delta>) kullanıyoruz; E'yi sürekli
      # "akümülatör" tutmak firmware tarafında güvenli.
      self.driver.send("M83")
      self._e_absolute = False
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
    # Marlin M42 cevabı: ``Pin: <N> Value:1`` veya ``ok``. Eski/sahte firmware
    # ``ok`` döndürebilir ama Value alanı yoksa "gripped" varsayımı yanlış olur.
    # ``"1" in text`` çok geniş — ``ok`` (içinde '1' yok ama) veya firmware
    # sürümü ``1.0`` gibi alt-string'leri yanlış pozitif yapar. Bu yüzden
    # ``value:1`` (Marlin M42 formatı) veya ``s255`` (M106 echo) arıyoruz.
    if "value:1" in text or "s255" in text:
      return True
    # ``value:0`` veya ``s0`` ise açıkça serbest → False.
    if "value:0" in text or "s0" in text:
      return False
    # Belirsiz cevap (sadece ``ok``) → sensör okunamadı; güvenli tarafı seç.
    return False

  def dwell(self, seconds: float) -> None:
    self.driver.send(f"G4 S{seconds:.3f}")

  def sync(self) -> None:
    self.driver.send("M400")

  def position(self) -> tuple[float, float, float, float]:
    lines = self.driver.send("M114")
    text = " ".join(lines)
    x = y = z = c = 0.0
    # M114 parser: A ve E çakışmasını önlemek için iki ayrı slot kullanılır.
    # Kullanılan rotation ekseni (`self.rotation_axis` → "A" veya "E")
    # sürücünün M114 çıktısında hangisinin döndüğünü belirler; diğeri yok sayılır.
    a_val: float | None = None
    e_val: float | None = None
    for axis in ("X", "Y", "Z", "A", "E"):
      m = re.search(rf"{axis}:\s*([-+]?\d*\.?\d+)", text, re.I)
      if not m:
        continue
      val = float(m.group(1))
      if axis == "X":
        x = val
      elif axis == "Y":
        y = val
      elif axis == "Z":
        z = val
      elif axis == "A":
        a_val = val
      elif axis == "E":
        e_val = val

    rot_axis = (self.rotation_axis or "A").upper()
    if rot_axis == "E" and e_val is not None:
      c = e_val
    elif rot_axis == "A" and a_val is not None:
      c = a_val
    elif a_val is not None:
      c = a_val
    elif e_val is not None:
      c = e_val
    return x, y, z, c

  def emergency_stop(self) -> None:
    try:
      self.vacuum_off()
    except Exception:
      pass
    self.driver.send("M410")
