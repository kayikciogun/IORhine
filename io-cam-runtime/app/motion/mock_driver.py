from __future__ import annotations

import io
from typing import List


class MockSerial:
    """In-memory serial for tests and mock hardware mode."""

    def __init__(self) -> None:
        self._in = io.BytesIO()
        self._out = io.BytesIO()
        self._pending: List[bytes] = []
        # Yazılan komutları kaydet — test'ler G-code assertion yapabilsin (P2-C20).
        self.written: list[str] = []

    def write(self, data: bytes) -> int:
        text = data.decode().strip()
        for line in text.splitlines():
            cmd = line.strip().upper()
            self.written.append(line)
            # P2-A6: M114 gerçek Marlin gibi position data döndür; yoksa
            # position() her zaman (0,0,0,0) döner ve test'ler gerçekçi olmaz.
            if cmd.startswith("M114"):
                self._pending.append(
                    b"X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0\n"
                )
                self._pending.append(b"ok\n")
            else:
                self._pending.append(b"ok\n")
        return len(data)

    def readline(self) -> bytes:
        if self._pending:
            return self._pending.pop(0)
        return b""

    def reset_input_buffer(self) -> None:
        self._pending.clear()

    def close(self) -> None:
        pass
