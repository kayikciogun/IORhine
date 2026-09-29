"""Orientation dataset: bbox crop kaydet + sayaç.

Kullanıcı yeni taş tanıtma sihirbazında etiketlediği kutuları buraya gönderir.
Klasör yapısı::

    datasets/orientation_labeled/<stone_id>/true/*.jpg
    datasets/orientation_labeled/<stone_id>/false/*.jpg
    datasets/orientation_labeled/<stone_id>/manifest.jsonl
"""
from __future__ import annotations

import base64
import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np

_RUNTIME_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_ROOT = _RUNTIME_ROOT / "datasets" / "orientation_labeled"

_STONE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}$")
LabelKind = Literal["true", "false"]


def _dataset_root() -> Path:
    try:
        from app.config.settings import settings

        custom = getattr(settings, "orientation_dataset_dir", None)
        if custom:
            return Path(custom)
    except Exception:
        pass
    return _DEFAULT_ROOT


def sanitize_stone_id(stone_id: str) -> str:
    sid = (stone_id or "").strip()
    if not _STONE_ID_RE.match(sid):
        raise ValueError(
            "stone_id geçersiz — harf/rakam ile başlasın, "
            "yalnızca a-zA-Z0-9_- (max 64)."
        )
    return sid


def stone_dir(stone_id: str) -> Path:
    return _dataset_root() / sanitize_stone_id(stone_id)


def decode_frame_b64(frame_b64: str) -> np.ndarray:
    """``data:image/jpeg;base64,...`` veya ham base64 → BGR frame."""
    raw = (frame_b64 or "").strip()
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        buf = base64.b64decode(raw, validate=False)
    except Exception as e:
        raise ValueError(f"base64 decode başarısız: {e}") from e
    arr = np.frombuffer(buf, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None or frame.size == 0:
        raise ValueError("JPEG decode başarısız — geçersiz görüntü.")
    return frame


def count_labels(stone_id: str) -> dict[str, int]:
    root = stone_dir(stone_id)
    out = {"true": 0, "false": 0}
    for label in ("true", "false"):
        d = root / label
        if d.is_dir():
            out[label] = sum(1 for p in d.glob("*.jpg") if p.is_file())
    return out


def list_stones() -> list[dict[str, Any]]:
    root = _dataset_root()
    if not root.is_dir():
        return []
    stones: list[dict[str, Any]] = []
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        try:
            sid = sanitize_stone_id(d.name)
        except ValueError:
            continue
        counts = count_labels(sid)
        meta_path = d / "meta.json"
        meta: dict[str, Any] = {}
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        stones.append(
            {
                "stone_id": sid,
                "true": counts["true"],
                "false": counts["false"],
                "name": meta.get("name", sid),
                "is_symmetric": bool(meta.get("is_symmetric", True)),
            }
        )
    return stones


def ensure_stone_meta(
    stone_id: str,
    *,
    name: str | None = None,
    is_symmetric: bool = True,
) -> Path:
    sid = sanitize_stone_id(stone_id)
    root = stone_dir(sid)
    (root / "true").mkdir(parents=True, exist_ok=True)
    (root / "false").mkdir(parents=True, exist_ok=True)
    meta_path = root / "meta.json"
    meta = {
        "stone_id": sid,
        "name": (name or sid).strip() or sid,
        "is_symmetric": bool(is_symmetric),
        "updated_at": datetime.now().astimezone().isoformat(),
    }
    if meta_path.is_file():
        try:
            prev = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["created_at"] = prev.get("created_at", meta["updated_at"])
            if name is None and prev.get("name"):
                meta["name"] = prev["name"]
            if name is None:
                meta["is_symmetric"] = bool(prev.get("is_symmetric", is_symmetric))
        except Exception:
            meta["created_at"] = meta["updated_at"]
    else:
        meta["created_at"] = meta["updated_at"]
    meta_path.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return root


def save_labeled_crops(
    stone_id: str,
    frame: np.ndarray,
    labels: list[dict[str, Any]],
    *,
    jpeg_quality: int = 95,
) -> dict[str, Any]:
    """Etiketli bbox'ları crop olarak kaydet.

    ``labels`` öğeleri: ``{bx1, by1, bx2, by2, label: "true"|"false"}``.
    ``skip`` gönderilmez (frontend filtreler).
    """
    sid = sanitize_stone_id(stone_id)
    root = ensure_stone_meta(sid)
    h, w = frame.shape[:2]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    ms = int(time.time() * 1000) % 1000
    saved: list[dict[str, Any]] = []
    errors: list[str] = []
    manifest_path = root / "manifest.jsonl"

    for i, item in enumerate(labels):
        try:
            label = str(item.get("label", "")).strip().lower()
            if label not in ("true", "false"):
                errors.append(f"#{i}: label true/false olmalı, geldi={label!r}")
                continue
            bx1 = max(0, min(int(item["bx1"]), w))
            by1 = max(0, min(int(item["by1"]), h))
            bx2 = max(0, min(int(item["bx2"]), w))
            by2 = max(0, min(int(item["by2"]), h))
            if bx2 <= bx1 + 2 or by2 <= by1 + 2:
                errors.append(f"#{i}: bbox çok küçük ({bx1},{by1})-({bx2},{by2})")
                continue
            crop = frame[by1:by2, bx1:bx2]
            if crop.size == 0:
                errors.append(f"#{i}: boş crop")
                continue
            fname = f"{stamp}_{ms:03d}_{i:03d}.jpg"
            fpath = root / label / fname
            ok = cv2.imwrite(
                str(fpath),
                crop,
                [cv2.IMWRITE_JPEG_QUALITY, int(np.clip(jpeg_quality, 1, 100))],
            )
            if not ok:
                errors.append(f"#{i}: imwrite başarısız")
                continue
            entry = {
                "file": f"{label}/{fname}",
                "label": label,
                "bbox": [bx1, by1, bx2, by2],
                "saved_at": datetime.now().astimezone().isoformat(),
                "stone_id": sid,
            }
            with manifest_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            saved.append(entry)
        except Exception as e:
            errors.append(f"#{i}: {e}")

    counts = count_labels(sid)
    return {
        "ok": True,
        "stone_id": sid,
        "saved": len(saved),
        "entries": saved,
        "errors": errors,
        "counts": counts,
    }


def delete_stone(stone_id: str) -> dict[str, Any]:
    """Taş session klasörünü tamamen sil (true/false/manifest/meta)."""
    import shutil

    sid = sanitize_stone_id(stone_id)
    root = stone_dir(sid)
    dataset_root = _dataset_root().resolve()
    target = root.resolve()
    # Path traversal koruması — yalnızca dataset kökü altındaki klasör
    if dataset_root not in target.parents and target != dataset_root:
        raise ValueError("Geçersiz silme yolu.")
    if not target.is_dir():
        return {"ok": True, "stone_id": sid, "deleted": False, "reason": "not_found"}
    shutil.rmtree(target)
    return {"ok": True, "stone_id": sid, "deleted": True}
