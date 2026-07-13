from __future__ import annotations

import threading
import time

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
    ):
        self._config = config
        self.mock = mock
        # P3-D32: ``on_reopen`` kaldırıldı — unused param (zero callers passed it).
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
        # Sessiz fail fix (P1-10): eskiden exception'u yutup sadece ``_error``
        # set ediyordu; çağıran kod (ws.py, calibration.py) ``open()`` başarılı
        # sanıp sahte kare ile devam ediyordu → yanıltıcı kalibrasyon. Artık
        # hatayı yeniden fırlat; thread yine de başlatılır (yeniden deneme için).
        try:
            self._open_source()
        except Exception as e:
            with self._lock:
                self._error = str(e)
            self._start_thread()
            raise
        # P2-fix: başarılı open'da da arka plan thread'i başlat — yoksa
        # ``_latest`` hiç dolmaz ve ``capture()`` hata verir.
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
                    # P3-D32: on_reopen callback kaldırıldı (unused)
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
            # Min sleep 0 — capture thread ne kadar hızlı okuyabilirse o kadar.
            # 20ms alt sınır duplicate frame'lere sebep oluyordu (50 FPS cap).
            time.sleep(max(0.0, interval - elapsed))

    def capture(self) -> np.ndarray:
        """Son kareyi döndürür; VideoCapture yalnızca arka plan thread'inde okunur.

        Henüz geçerli kare yoksa ``RuntimeError`` fırlatır (sahte mock görüntü yok).
        ``is_live`` ile çağıran kod kare hazır mı bakabilir.
        """
        with self._lock:
            if self._latest is not None:
                return self._latest.copy()
            err = self._error or "Kamera frame yok"
        raise RuntimeError(err)

    @property
    def is_live(self) -> bool:
        """Son geçerli kamera karesi var mı?"""
        with self._lock:
            return self._latest is not None

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
