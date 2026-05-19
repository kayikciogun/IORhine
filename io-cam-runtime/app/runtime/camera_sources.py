from __future__ import annotations

import glob
import json
import os
import platform
import sys
import threading
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

CameraKind = Literal["usb", "mock"]


@dataclass
class CameraDeviceInfo:
    id: str
    label: str
    kind: CameraKind
    available: bool = True
    meta: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if d.get("meta") is None:
            d["meta"] = {}
        return d


@dataclass
class CameraSourceConfig:
    kind: CameraKind
    """USB path (/dev/video0), capture index, or 'mock'."""
    source_id: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CameraSourceConfig:
        kind = data["kind"]
        # Eski kayıtlar: webcam → usb
        if kind == "webcam":
            kind = "usb"
        if kind not in ("usb", "mock"):
            raise ValueError(f"Desteklenmeyen kamera türü: {kind!r}")
        return cls(kind=kind, source_id=str(data["source_id"]))

    def to_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "source_id": self.source_id}


def config_path(cal_dir: Path) -> Path:
    return cal_dir / "camera_source.json"


def load_saved_config(cal_dir: Path) -> CameraSourceConfig | None:
    p = config_path(cal_dir)
    if not p.is_file():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    return CameraSourceConfig.from_dict(data)


def save_config(cal_dir: Path, cfg: CameraSourceConfig) -> None:
    cal_dir.mkdir(parents=True, exist_ok=True)
    config_path(cal_dir).write_text(json.dumps(cfg.to_dict(), indent=2), encoding="utf-8")


class FrameSource(ABC):
    @abstractmethod
    def open(self) -> None: ...

    @abstractmethod
    def read(self) -> tuple[bool, Any]: ...

    @abstractmethod
    def close(self) -> None: ...

    @property
    def label(self) -> str:
        return getattr(self, "_label", self.__class__.__name__)


class MockFrameSource(FrameSource):
    def open(self) -> None:
        pass

    def read(self) -> tuple[bool, Any]:
        from app.runtime.camera import _mock_frame

        return True, _mock_frame()

    def close(self) -> None:
        pass


class OpenCvFrameSource(FrameSource):
    """USB path (/dev/video0) veya capture index."""

    def __init__(self, source: str | int, *, use_v4l2: bool = False):
        self.source = source
        self.use_v4l2 = use_v4l2
        self._cap = None
        self._io_lock = threading.Lock()
        self._label = f"opencv:{source}"

    def _configure_capture(self) -> None:
        """AVFoundation / Continuity Camera için kararlı ayarlar."""
        import cv2

        if self._cap is None or not self._cap.isOpened():
            return
        if platform.system() == "Darwin":
            # iPhone Continuity: yüksek FPS / grab() cihazı düşürür.
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            self._cap.set(cv2.CAP_PROP_FPS, 15)
        try:
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        # İlk kare bazen boş; bir kez ısıt.
        for _ in range(3):
            self._cap.read()

    def open(self) -> None:
        import cv2

        with self._io_lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None
            backend = cv2.CAP_V4L2 if self.use_v4l2 else _opencv_capture_backend()
            if isinstance(self.source, str) and self.source.startswith("/dev/video"):
                self._cap = cv2.VideoCapture(self.source, backend)
            elif isinstance(self.source, str) and self.source.isdigit():
                self._cap = cv2.VideoCapture(int(self.source), backend)
            else:
                self._cap = cv2.VideoCapture(self.source, backend)

            if not self._cap or not self._cap.isOpened():
                raise RuntimeError(f"Kamera açılamadı: {self.source!r}")

            self._configure_capture()

    def read(self) -> tuple[bool, Any]:
        import cv2

        with self._io_lock:
            if self._cap is None:
                return False, None
            if not self._cap.isOpened():
                return False, None
            # grab()+read() AVFoundation / Continuity'de takılma yapıyor.
            ok, frame = self._cap.read()
            if ok and frame is not None and frame.ndim == 2:
                frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            return ok, frame

    def close(self) -> None:
        with self._io_lock:
            if self._cap is not None:
                self._cap.release()
                self._cap = None


def _opencv_capture_backend() -> int:
    import cv2

    system = platform.system()
    if system == "Darwin" and hasattr(cv2, "CAP_AVFOUNDATION"):
        return cv2.CAP_AVFOUNDATION
    if system == "Windows" and hasattr(cv2, "CAP_DSHOW"):
        return cv2.CAP_DSHOW
    return cv2.CAP_ANY


def _macos_system_cameras() -> list[dict[str, str]]:
    """system_profiler — bağlı tüm kameralar (iPhone Continuity dahil)."""
    import json
    import subprocess

    try:
        proc = subprocess.run(
            ["system_profiler", "SPCameraDataType", "-json"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return []
        data = json.loads(proc.stdout)
        out: list[dict[str, str]] = []
        for c in data.get("SPCameraDataType") or []:
            name = str(c.get("_name") or c.get("spcamera_model-id") or "").strip()
            if not name:
                continue
            out.append(
                {
                    "name": name,
                    "unique_id": str(c.get("spcamera_unique-id") or ""),
                }
            )
        return out
    except Exception:
        return []


def _ffmpeg_avfoundation_index_names() -> dict[int, str]:
    """ffmpeg AVFoundation listesi: {avfoundation_index: device_name}.

    ffmpeg çıktısı zaten indeksi içerdiği için bu eşleştirme pozisyonel
    değil, doğrudan indeks bazlıdır.  Screen capture cihazları filtrelenir.
    """
    import re
    import subprocess

    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        text = (proc.stderr or "") + (proc.stdout or "")
        out: dict[int, str] = {}
        in_video = False
        for line in text.splitlines():
            if "AVFoundation video devices" in line:
                in_video = True
                continue
            if in_video and "AVFoundation audio devices" in line:
                break
            if not in_video:
                continue
            m = re.search(r"\[(\d+)\]\s*(.+)$", line)
            if not m:
                continue
            idx = int(m.group(1))
            name = m.group(2).strip()
            if "capture screen" in name.lower() or name.lower() == "screen":
                continue
            out[idx] = name
        return out
    except Exception:
        return {}


def _probe_opencv_index(index: int, *, backend: int) -> tuple[bool, bool]:
    import cv2
    import time

    cap = cv2.VideoCapture(index, backend)
    try:
        if not cap.isOpened():
            return False, False
        readable = False
        for _ in range(4):
            ok, frame = cap.read()
            if ok and frame is not None:
                readable = True
                break
            time.sleep(0.08)
        return True, readable
    finally:
        cap.release()


def _suppress_opencv_stderr():
    devnull = open(os.devnull, "w")
    old_stderr = sys.stderr.fileno()
    try:
        saved = os.dup(old_stderr)
        os.dup2(devnull.fileno(), old_stderr)
    except Exception:
        saved = None
    return devnull, saved, old_stderr


def _restore_stderr(devnull, saved, old_stderr) -> None:
    if saved is not None:
        try:
            os.dup2(saved, old_stderr)
            os.close(saved)
        except Exception:
            pass
    devnull.close()


def _scan_opencv_indices(
    max_index: int = 8,
    *,
    name_hints: list[str] | None = None,
    max_consecutive_misses: int = 2,
) -> list[CameraDeviceInfo]:
    """macOS / Windows: capture index ile tarama."""
    backend = _opencv_capture_backend()
    hints = name_hints or []

    found: list[CameraDeviceInfo] = []
    devnull, saved, old_stderr = _suppress_opencv_stderr()
    misses = 0

    try:
        for i in range(max_index):
            ok, readable = _probe_opencv_index(i, backend=backend)
            if ok:
                misses = 0
                label = hints[i] if i < len(hints) and hints[i] else f"Kamera {i}"
                found.append(
                    CameraDeviceInfo(
                        id=f"usb:{i}",
                        label=label,
                        kind="usb",
                        available=True,
                        meta={"index": i, "readable": readable, "backend": backend},
                    )
                )
            else:
                misses += 1
                if misses >= max_consecutive_misses and i > 0:
                    break
    finally:
        _restore_stderr(devnull, saved, old_stderr)

    return found


def _scan_darwin_cameras() -> list[CameraDeviceInfo]:
    """
    macOS: ffmpeg AVFoundation index→isim eşleştirmesi + OpenCV probe.

    Eski yaklaşım system_profiler/ffmpeg sırasını OpenCV index sırasıyla
    pozisyonel olarak eşleştiriyordu; bu cihaz takma/sürücü kayıt sırası
    farklı olduğunda yanlış isim atamasına ve eksik cihazlara yol açıyordu.
    Yeni yaklaşım ffmpeg'in çıktısından gelen gerçek AVFoundation indeksini
    kullanır, ardından OpenCV probe ile erişilebilirliği doğrular.
    """
    ffmpeg_map = _ffmpeg_avfoundation_index_names()  # {avf_index: name}
    sys_uid: dict[str, str] = {
        c["name"]: c.get("unique_id", "") for c in _macos_system_cameras()
    }

    # ffmpeg'in bildirdiği en yüksek index'in üstüne tampon bırak
    max_known = max(ffmpeg_map.keys(), default=-1)
    scan_count = max(10, max_known + 3)

    probed = _scan_opencv_indices(scan_count, max_consecutive_misses=4)
    probed_set: set[int] = set()
    by_index: dict[int, CameraDeviceInfo] = {}

    for d in probed:
        idx = int(d.meta.get("index", -1))
        if idx < 0:
            continue
        probed_set.add(idx)
        # ffmpeg indeksi OpenCV indeksiyle birebir eşleşir (AVFoundation)
        name = ffmpeg_map.get(idx) or f"Kamera {idx}"
        by_index[idx] = CameraDeviceInfo(
            id=f"usb:{idx}",
            label=name,
            kind="usb",
            available=d.available,
            meta={**d.meta, "unique_id": sys_uid.get(name, "")},
        )

    # ffmpeg'de görünüp OpenCV ile açılamayanlar (available=False olarak ekle)
    for idx, name in ffmpeg_map.items():
        if idx not in probed_set:
            by_index[idx] = CameraDeviceInfo(
                id=f"usb:{idx}",
                label=name,
                kind="usb",
                available=False,
                meta={
                    "index": idx,
                    "unique_id": sys_uid.get(name, ""),
                    "hint": "AVFoundation'da görünüyor ama açılamadı; iPhone kilidini açın veya Continuity açık olsun",
                },
            )

    return sorted(by_index.values(), key=lambda d: int(d.meta.get("index", 999)))


def scan_usb_devices() -> list[CameraDeviceInfo]:
    system = platform.system()
    if system == "Darwin":
        return _scan_darwin_cameras()
    if system == "Linux":
        devices: list[CameraDeviceInfo] = []
        for path in sorted(glob.glob("/dev/video*")):
            readable = False
            try:
                import cv2

                cap = cv2.VideoCapture(path, cv2.CAP_V4L2)
                if cap.isOpened():
                    readable, _ = cap.read()
                cap.release()
            except Exception:
                pass
            devices.append(
                CameraDeviceInfo(
                    id=f"usb:{path}",
                    label=f"USB {path}",
                    kind="usb",
                    meta={"path": path, "backend": "v4l2", "readable": readable},
                )
            )
        return devices
    if system == "Windows":
        return _scan_opencv_indices(8, max_consecutive_misses=3)
    return []


def list_all_devices() -> dict[str, list[dict[str, Any]]]:
    return {"usb": [d.to_dict() for d in scan_usb_devices()]}


def create_frame_source(cfg: CameraSourceConfig, *, mock_hardware: bool = False) -> FrameSource:
    if mock_hardware or cfg.kind == "mock":
        return MockFrameSource()

    if cfg.kind == "usb":
        path = cfg.source_id
        if path.startswith("usb:"):
            path = path[4:]
        use_v4l2 = path.startswith("/dev/video")
        src: str | int = path if use_v4l2 else int(path) if path.isdigit() else path
        return OpenCvFrameSource(src, use_v4l2=use_v4l2)

    raise ValueError(f"Unknown camera kind: {cfg.kind}")
