"""VLM eğitim verisi: kameradan seri kare → JPEG (varsayılan: orijinal çözünürlük)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.config.settings import settings
from app.runtime.camera import Camera
from app.runtime.camera_sources import CameraSourceConfig, load_saved_config
from app.vision.vlm_preprocess import resize_for_vlm


@dataclass
class DatasetCaptureResult:
    saved: int
    requested: int
    out_dir: Path
    manifest_path: Path
    entries: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _wait_for_live_frame(camera: Camera, timeout_s: float) -> np.ndarray:
    deadline = time.monotonic() + max(timeout_s, 0.5)
    last_err = ""
    while time.monotonic() < deadline:
        if camera.is_live:
            try:
                return camera.capture()
            except RuntimeError as e:
                last_err = str(e)
        else:
            last_err = camera.error or "frame yok"
        time.sleep(0.05)
    raise RuntimeError(last_err or "Kamera frame zaman aşımı")


def capture_vlm_dataset(
    out_dir: Path | str,
    *,
    count: int = 200,
    interval_s: float = 0.25,
    max_dim: int | None = None,
    prefix: str = "new1",
    jpeg_quality: int = 95,
    wait_first_frame_s: float = 8.0,
    camera: Camera | None = None,
    own_camera: bool = False,
) -> DatasetCaptureResult:
    """Seri çekim: her kare varsayılan olarak orijinal çözünürlükte kaydedilir.

    Args:
        out_dir: Çıktı klasörü (oluşturulur).
        count: Kaydedilecek görüntü sayısı (varsayılan 200).
        interval_s: Kareler arası bekleme (saniye).
        max_dim: Verilirse uzun kenarı bu değere küçültür; ``None`` = olduğu gibi.
        prefix: Dosya adı öneki → ``new1_20260715_185930_00001.jpg``.
        jpeg_quality: JPEG kalitesi (0–100).
        wait_first_frame_s: İlk geçerli kare için bekleme.
        camera: Hazır ``Camera``; verilmezse kayıtlı cihaz açılır.
        own_camera: True ise fonksiyon sonunda ``camera.close()`` çağrılır.
    """
    if count < 1:
        raise ValueError("count >= 1 olmalı")

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    cam = camera
    if cam is None:
        saved = load_saved_config(settings.calibration_dir)
        cfg = saved or CameraSourceConfig(kind="usb", source_id=str(settings.camera_index))
        cam = Camera(cfg, mock=settings.mock_hardware)
        own_camera = True

    entries: list[dict[str, Any]] = []
    errors: list[str] = []
    saved_n = 0

    try:
        cam.open()
        _wait_for_live_frame(cam, wait_first_frame_s)

        started = datetime.now().astimezone()
        session_stamp = started.strftime("%Y%m%d_%H%M%S")
        session_id = started.isoformat()
        file_prefix = f"{prefix}_{session_stamp}"
        manifest_path = out / f"manifest_{session_stamp}.json"

        for i in range(1, count + 1):
            try:
                frame = cam.capture()
                if max_dim is not None and max_dim > 0:
                    out_bgr, scale, orig_wh, new_wh = resize_for_vlm(frame, max_dim=max_dim)
                else:
                    h, w = frame.shape[:2]
                    out_bgr, scale, orig_wh, new_wh = frame, 1.0, (w, h), (w, h)

                fname = f"{file_prefix}_{i:05d}.jpg"
                fpath = out / fname
                ok = cv2.imwrite(
                    str(fpath),
                    out_bgr,
                    [cv2.IMWRITE_JPEG_QUALITY, int(np.clip(jpeg_quality, 1, 100))],
                )
                if not ok:
                    raise RuntimeError(f"cv2.imwrite başarısız: {fpath}")

                entry = {
                    "index": i,
                    "file": fname,
                    "path": str(fpath.resolve()),
                    "captured_at": datetime.now().astimezone().isoformat(),
                    "orig_size": {"w": orig_wh[0], "h": orig_wh[1]},
                    "saved_size": {"w": new_wh[0], "h": new_wh[1]},
                    "scale": round(scale, 6),
                    "max_dim": max_dim,
                }
                entries.append(entry)
                saved_n += 1

                if i < count and interval_s > 0:
                    time.sleep(interval_s)
            except Exception as e:
                errors.append(f"frame {i}: {e}")

        preprocess = (
            f"resize_for_vlm (longest edge <= {max_dim}, INTER_AREA, no upscale)"
            if max_dim is not None and max_dim > 0
            else "none (original camera resolution)"
        )
        manifest = {
            "session_id": session_id,
            "session_stamp": session_stamp,
            "created_at": datetime.now().astimezone().isoformat(),
            "requested": count,
            "saved": saved_n,
            "prefix": prefix,
            "file_prefix": file_prefix,
            "max_dim": max_dim,
            "interval_s": interval_s,
            "jpeg_quality": jpeg_quality,
            "preprocess": preprocess,
            "entries": entries,
            "errors": errors,
        }
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return DatasetCaptureResult(
            saved=saved_n,
            requested=count,
            out_dir=out,
            manifest_path=manifest_path,
            entries=entries,
            errors=errors,
        )
    finally:
        if own_camera and cam is not None:
            cam.close()
