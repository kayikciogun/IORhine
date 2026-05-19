from __future__ import annotations

import re
import time
from typing import Protocol


class MarlinError(RuntimeError):
    pass


class SerialLike(Protocol):
    def write(self, data: bytes) -> int: ...
    def readline(self) -> bytes: ...
    def reset_input_buffer(self) -> None: ...


class GcodeDriver:
    """Send-and-wait Marlin G-code over serial."""

    def __init__(self, port: str, baud: int = 115200, timeout: float = 2.0):
        import serial

        self.ser: SerialLike = serial.Serial(port, baud, timeout=timeout)
        time.sleep(2)
        self._drain()

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
        self.ser.write(f"{line}\n".encode())
        responses: list[str] = []
        while True:
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
            if "error" in low:
                raise MarlinError(text)
            if "busy" in low or "processing" in low:
                continue
