from __future__ import annotations

import asyncio
import re
import time
from typing import Protocol


class MarlinError(RuntimeError):
    pass


# P2-A4: precise error detection. Eski ``"error" in low`` çok agresif —
# comment'lerde ``error`` geçen komutları yanlış pozitif yapardı. Marlin 2.1+
# ``!!`` prefix ile hard-fault bildirir; ``Resend:`` checksum mismatch'tir.
_ERR_RE = re.compile(r"(?:^|\s)(?:error|!{2}|resend:\s*\d+)", re.IGNORECASE)


class SerialLike(Protocol):
    def write(self, data: bytes) -> int: ...
    def readline(self) -> bytes: ...
    def reset_input_buffer(self) -> None: ...


class GcodeDriver:
    """Send-and-wait Marlin G-code over serial.

    Güvenlik: ``send()`` her zaman sonunda bir ``ok`` satırı bekler. Kart takılırsa
    veya yanıt gelmezse sonsuz döngüye girmek yerine ``settings.serial_timeout_s``
    (varsayılan 10 s) içinde ``MarlinError`` fırlatır. M400 / G4 gibi hareket/dwell
    komutları yüzlerce ms sürebilir; timeout en azından ``vacuum_on_dwell_s +
    rotation_feed_time + safe margin`` kadar olmalıdır.
    """

    def __init__(self, port: str, baud: int = 115200, timeout: float = 2.0):
        import serial

        self.ser: SerialLike = serial.Serial(port, baud, timeout=timeout)
        # P2-A4: bloklayan ``time.sleep(2)`` event loop'u 2 sn dondurur. Sync
        # constructor hâlâ var (backward-compat) ama yeni kod ``open()`` async
        # factory kullanmalı — orada ``asyncio.to_thread`` + ``await asyncio.sleep``.
        time.sleep(2)
        self._drain()

    @classmethod
    async def open(cls, port: str, baud: int = 115200, timeout: float = 2.0) -> "GcodeDriver":
        """Async factory: serial open + 2 sn bekleme'yi thread'e taşır (P2-A4).

        ``__init__`` sync olduğu için event loop'u bloklar; bu factory
        ``asyncio.to_thread`` ile serial open'ı arka plana alır ve
        ``await asyncio.sleep(2)`` ile bloklamadan bekler.
        """
        inst = await asyncio.to_thread(cls, port, baud, timeout)
        await asyncio.sleep(2)  # Marlin boot bekleme — non-blocking
        return inst

    @classmethod
    def from_serial(cls, ser: SerialLike) -> GcodeDriver:
        inst = cls.__new__(cls)
        inst.ser = ser
        return inst

    def close(self) -> None:
        if hasattr(self.ser, "close"):
            self.ser.close()

    def _drain(self) -> None:
        if hasattr(self.ser, "reset_input_buffer"):
            self.ser.reset_input_buffer()

    def send(self, cmd: str) -> list[str]:
        line = cmd.strip()
        if not line:
            return []
        # Komut başına deadline; her readline() seri timeout'a düşer ama sonsuz
        # döngüye karşı ek koruma sağlar (kart hiç yanıt vermezse burada yakalar).
        deadline = time.monotonic() + self._send_timeout()
        self.ser.write(f"{line}\n".encode())
        responses: list[str] = []
        while True:
            if time.monotonic() > deadline:
                raise MarlinError(
                    f"timeout: no 'ok' within {self._send_timeout():.1f}s for {line!r}"
                )
            raw = self.ser.readline()
            if not raw:
                continue
            text = raw.decode(errors="replace").strip()
            if not text:
                continue
            responses.append(text)
            low = text.lower()
            if re.search(r"(?:^|\s)ok(?:\s|$)", low):
                return responses
            # P2-A4: precise error regex (error/!!/resend:) — comment'lerde
            # "error" geçen komutlar artık false-positive yapmaz.
            if _ERR_RE.search(low):
                raise MarlinError(text)
            if "busy" in low or "processing" in low:
                # P2-A4: busy/processing geldiğinde deadline'ı resetle —
                # kart ilerliyor ama uzun süren işlerde timeout'a düşmesin.
                deadline = time.monotonic() + self._send_timeout()
                continue

    def _send_timeout(self) -> float:
        # Lazy import: settings modülü gcode_driver'a bağımlı, döngüsel import'tan kaçın.
        try:
            from app.config.settings import settings as _s  # type: ignore
            return float(getattr(_s, "serial_timeout_s", 10.0))
        except Exception:
            return 10.0
