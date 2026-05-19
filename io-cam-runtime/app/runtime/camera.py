from __future__ import annotations

import threading
import time
from typing import Callable

import numpy as np

from app.config.settings import settings
from app.runtime.camera_sources import (
    CameraSourceConfig,
    FrameSource,
    create_frame_source,
    load_saved_config,
)


class Camera:
    """Threaded USB capture camera."""

    def __init__(
        self,
        config: CameraSourceConfig | None = None,
        *,
        mock: bool = False,
        on_reopen: Callable[[], None] | None = None,
    ):
        self._config = config
        self.mock = mock
        self._on_reopen = on_reopen
        self._source: FrameSource | None = None
        self._latest: np.ndarray | None = None
        self._latest_ts: float = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._reopen = threading.Event()
        self._thread: threading.Thread | None = None
        self._error = ""
        self._read_failures = 0

    @property
    def config(self) -> CameraSourceConfig | None:
        return self._config

    def open(self) -> None:
        try:
            self._open_source()
        except Exception as e:
            with self._lock:
                self._error = str(e)
        self._start_thread()

    def _open_source(self) -> None:
        cfg = self._config
        if cfg is None and not self.mock:
            saved = load_saved_config(settings.calibration_dir)
            cfg = saved or CameraSourceConfig(kind="usb", source_id="0")
            self._config = cfg

        if self.mock:
            cfg = CameraSourceConfig(kind="mock", source_id="mock")

        self.close_source_only()
        try:
            self._source = create_frame_source(cfg, mock_hardware=self.mock)  # type: ignore[arg-type]
            self._source.open()
            with self._lock:
                self._error = ""
        except Exception as e:
            with self._lock:
                self._error = str(e)
            raise

    def close_source_only(self) -> None:
        if self._source is not None:
            try:
                self._source.close()
            except Exception:
                pass
            self._source = None

    def _start_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def select_source(self, config: CameraSourceConfig) -> None:
        self._config = config
        self._reopen.set()

    def _loop(self) -> None:
        interval = 1.0 / max(settings.camera_idle_fps, 1.0)
        while not self._stop.is_set():
            t0 = time.monotonic()

            if self._reopen.is_set():
                self._reopen.clear()
                self._read_failures = 0
                try:
                    self._open_source()
                    if self._on_reopen:
                        self._on_reopen()
                except Exception:
                    pass

            try:
                if self._source is None:
                    self._open_source()
                ok, frame = self._source.read() if self._source else (False, None)
                if ok and frame is not None:
                    self._read_failures = 0
                    with self._lock:
                        self._latest = frame
                        self._latest_ts = time.monotonic()
                        self._error = ""
                else:
                    self._read_failures += 1
                    with self._lock:
                        self._error = self._error or "Frame okunamadı"
                    # Continuity Camera: birkaç hata sonra yeniden aç.
                    if self._read_failures >= 8:
                        self._read_failures = 0
                        try:
                            self._open_source()
                        except Exception as e:
                            with self._lock:
                                self._error = str(e)
                        time.sleep(0.3)
            except Exception as e:
                self._read_failures += 1
                with self._lock:
                    self._error = str(e)
                if self._read_failures >= 8:
                    self._read_failures = 0
                    try:
                        self._open_source()
                    except Exception:
                        time.sleep(0.5)

            elapsed = time.monotonic() - t0
            time.sleep(max(0.02, interval - elapsed))

    def capture(self) -> np.ndarray:
        """Son kareyi döndürür; VideoCapture yalnızca arka plan thread'inde okunur."""
        with self._lock:
            if self._latest is not None:
                return self._latest.copy()
        return _mock_frame()

    def close(self) -> None:
        self._stop.set()
        self._reopen.set()
        if self._thread:
            self._thread.join(timeout=1.5)
        self.close_source_only()

    @property
    def error(self) -> str:
        with self._lock:
            return self._error


def _mock_frame() -> np.ndarray:
    import cv2

    t = time.time()
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    ox = int(30 * np.sin(t * 2))
    cv2.rectangle(img, (200 + ox, 180), (280 + ox, 260), (255, 255, 255), -1)
    cv2.rectangle(img, (350, 200), (420, 270), (180, 180, 180), -1)
    cv2.putText(
        img,
        "MOCK",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (100, 200, 255),
        2,
    )
    return img
