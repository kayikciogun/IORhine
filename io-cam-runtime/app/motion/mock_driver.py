from __future__ import annotations

import io
from typing import List


class MockSerial:
    """In-memory serial for tests and mock hardware mode."""

    def __init__(self) -> None:
        self._in = io.BytesIO()
        self._out = io.BytesIO()
        self._pending: List[bytes] = []

    def write(self, data: bytes) -> int:
        text = data.decode().strip()
        for line in text.splitlines():
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
