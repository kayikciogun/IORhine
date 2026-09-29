"""Folder-based orientation training (true/false crops) + ONNX export.

Falcon VLM CUDA graph ile aynı process'te train çakışır
(``cudaErrorStreamCaptureUnsupported``). Bu yüzden eğitim **ayrı
subprocess**'te çalışır; progress JSON ile parent'a aktarılır.

``datasets/orientation_labeled/<stone_id>/{true,false}/*.jpg`` →
``datasets/orientation_model_<stone_id>/``.
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

_RUNTIME_ROOT = Path(__file__).resolve().parents[2]
_DATASETS = _RUNTIME_ROOT / "datasets"
_LABELED = _DATASETS / "orientation_labeled"
_CLASS_NAMES = ["false", "true"]  # production ONNX ile aynı sıra
_IMG_SIZE = 128

ProgressCb = Callable[[dict[str, Any]], None]


@dataclass
class TrainJobState:
    status: str = "idle"  # idle | running | done | error
    stone_id: str = ""
    epoch: int = 0
    epochs: int = 0
    train_loss: float = 0.0
    train_acc: float = 0.0
    val_loss: float = 0.0
    val_acc: float = 0.0
    best_val_acc: float = 0.0
    message: str = ""
    model_dir: str = ""
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    history: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "stone_id": self.stone_id,
            "epoch": self.epoch,
            "epochs": self.epochs,
            "train_loss": round(self.train_loss, 4),
            "train_acc": round(self.train_acc, 4),
            "val_loss": round(self.val_loss, 4),
            "val_acc": round(self.val_acc, 4),
            "best_val_acc": round(self.best_val_acc, 4),
            "message": self.message,
            "model_dir": self.model_dir,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "history": self.history[-30:],
        }


_lock = threading.Lock()
_state = TrainJobState()
_thread: threading.Thread | None = None
_proc: subprocess.Popen | None = None


def get_train_state() -> dict[str, Any]:
    with _lock:
        return _state.to_dict()


def _set_state(**kwargs: Any) -> None:
    with _lock:
        for k, v in kwargs.items():
            setattr(_state, k, v)


def _apply_progress(data: dict[str, Any]) -> None:
    with _lock:
        for k in (
            "status",
            "stone_id",
            "epoch",
            "epochs",
            "train_loss",
            "train_acc",
            "val_loss",
            "val_acc",
            "best_val_acc",
            "message",
            "model_dir",
            "started_at",
            "finished_at",
            "error",
            "history",
        ):
            if k in data and data[k] is not None:
                setattr(_state, k, data[k])


def _active_path() -> Path:
    try:
        from app.config.settings import settings

        return Path(settings.calibration_dir) / "orientation_active.json"
    except Exception:
        return _RUNTIME_ROOT / "calibration" / "orientation_active.json"


def read_active_model_dir() -> Path | None:
    p = _active_path()
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        d = Path(data["model_dir"])
        if (d / "orientation_model.onnx").is_file():
            return d
    except Exception:
        return None
    return None


def write_active_model_dir(model_dir: Path) -> Path:
    p = _active_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_dir": str(model_dir.resolve()),
        "updated_at": datetime.now().astimezone().isoformat(),
    }
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return model_dir.resolve()


def list_orientation_models() -> dict[str, Any]:
    """``datasets/orientation_model*`` klasörlerini tara + aktif olanı işaretle."""
    active = read_active_model_dir()
    if active is None:
        try:
            from app.config.settings import settings

            active = Path(settings.orientation_model_dir)
        except Exception:
            active = _DATASETS / "orientation_model_v2"

    active_resolved = active.resolve() if active else None
    models: list[dict[str, Any]] = []
    if not _DATASETS.is_dir():
        return {"models": [], "active_id": None, "active_dir": None}

    for d in sorted(_DATASETS.iterdir(), key=lambda p: p.name.lower()):
        if not d.is_dir():
            continue
        if not d.name.startswith("orientation_model"):
            continue
        onnx = d / "orientation_model.onnx"
        if not onnx.is_file():
            # v128 fallback
            if not (d / "orientation_model_v128.onnx").is_file():
                continue
        meta: dict[str, Any] = {}
        meta_path = d / "class_names.json"
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        report: dict[str, Any] = {}
        report_path = d / "train_report.json"
        if report_path.is_file():
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
            except Exception:
                report = {}
        stone_id = meta.get("stone_id") or report.get("stone_id")
        if not stone_id and d.name.startswith("orientation_model_"):
            suffix = d.name[len("orientation_model_") :]
            stone_id = suffix if suffix else None
        label = stone_id or d.name
        if d.name == "orientation_model_v2":
            label = "v2 (varsayılan)"
        best_acc = report.get("best_val_acc")
        if best_acc is None:
            # best_model.pth içinden okumaya çalışma — ağır; report yeter
            pass
        is_active = active_resolved is not None and d.resolve() == active_resolved
        models.append(
            {
                "id": d.name,
                "label": label,
                "stone_id": stone_id,
                "path": str(d.resolve()),
                "img_size": meta.get("img_size", 128),
                "class_names": meta.get("class_names", ["false", "true"]),
                "best_val_acc": best_acc,
                "counts": report.get("counts"),
                "finished_at": report.get("finished_at"),
                "active": is_active,
            }
        )

    active_id = None
    active_dir = str(active_resolved) if active_resolved else None
    for m in models:
        if m["active"]:
            active_id = m["id"]
            break
    if active_id is None and models and active_resolved:
        # path match failed (symlink?) — closest name
        for m in models:
            if Path(m["path"]).name == active_resolved.name:
                m["active"] = True
                active_id = m["id"]
                break

    return {
        "models": models,
        "active_id": active_id,
        "active_dir": active_dir,
    }


def activate_model(model_dir: str | Path) -> dict[str, Any]:
    root = Path(model_dir)
    if not (root / "orientation_model.onnx").is_file():
        raise ValueError(f"ONNX yok: {root / 'orientation_model.onnx'}")
    if not (root / "class_names.json").is_file():
        raise ValueError(f"class_names.json yok: {root}")
    write_active_model_dir(root)
    from app.vision.orientation_classifier import (
        preload_orientation_model,
        reset_orientation_model,
    )

    reset_orientation_model()
    ok = preload_orientation_model(root)
    if not ok:
        raise RuntimeError("Model yüklendi ama ONNX session açılamadı.")
    return {"ok": True, "model_dir": str(root.resolve())}


def _import_train_helpers():
    """datasets/Train_orientation.py — transforms + model builders."""
    import importlib.util

    path = _DATASETS / "Train_orientation.py"
    if not path.is_file():
        raise RuntimeError(f"Train_orientation.py bulunamadı: {path}")
    spec = importlib.util.spec_from_file_location("train_orientation_mod", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Train_orientation yüklenemedi")
    mod = importlib.util.module_from_spec(spec)
    # Aynı process'te tekrar yükleme için unique name
    import sys

    sys.modules["train_orientation_mod"] = mod
    spec.loader.exec_module(mod)
    return mod


class _FolderSamples:
    """true/false klasörlerinden (path, label_idx) listesi."""

    def __init__(self, stone_dir: Path):
        self.samples: list[tuple[Path, int]] = []
        for name in _CLASS_NAMES:
            d = stone_dir / name
            if not d.is_dir():
                continue
            idx = _CLASS_NAMES.index(name)
            for p in sorted(d.glob("*.jpg")) + sorted(d.glob("*.png")):
                if p.is_file():
                    self.samples.append((p, idx))
        if len(self.samples) < 10:
            raise ValueError(
                f"Çok az örnek ({len(self.samples)}) — en az ~10 gerekir."
            )
        counts = {n: 0 for n in _CLASS_NAMES}
        for _, i in self.samples:
            counts[_CLASS_NAMES[i]] += 1
        if counts["true"] < 5 or counts["false"] < 5:
            raise ValueError(f"Her sınıf için yeterli örnek yok: {counts}")
        self.counts = counts


class _FolderDataset:
    def __init__(self, samples: list[tuple[Path, int]], transform):
        self.samples = samples
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx: int):
        from PIL import Image

        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.transform(img), label


def _emit(
    progress: ProgressCb | None,
    *,
    base: dict[str, Any],
    **kwargs: Any,
) -> dict[str, Any]:
    state = {**base, **kwargs}
    if progress:
        progress(state)
    return state


def run_training_job(
    stone_id: str,
    *,
    epochs: int,
    batch_size: int,
    lr: float,
    val_split: float,
    seed: int,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    """Saf eğitim (subprocess içinde çağrılır — temiz CUDA context)."""
    import torch
    from torch.utils.data import DataLoader

    mod = _import_train_helpers()
    stone_dir = _LABELED / stone_id
    if not stone_dir.is_dir():
        raise ValueError(f"Labeled klasör yok: {stone_dir}")

    out_dir = _DATASETS / f"orientation_model_{stone_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    folder = _FolderSamples(stone_dir)
    device = mod.pick_device()
    train_tf, val_tf = mod.build_transforms(_IMG_SIZE, resolution_aug_prob=0.3)

    started = datetime.now().astimezone().isoformat()
    base: dict[str, Any] = {
        "status": "running",
        "stone_id": stone_id,
        "epoch": 0,
        "epochs": epochs,
        "train_loss": 0.0,
        "train_acc": 0.0,
        "val_loss": 0.0,
        "val_acc": 0.0,
        "best_val_acc": 0.0,
        "model_dir": str(out_dir.resolve()),
        "started_at": started,
        "finished_at": None,
        "error": None,
        "history": [],
        "message": f"device={device}",
    }
    _emit(progress, base=base, message=f"device={device} — veri hazırlanıyor")

    random.seed(seed)
    torch.manual_seed(seed)

    n = len(folder.samples)
    n_val = max(1, int(n * val_split))
    n_train = n - n_val
    indices = list(range(n))
    rng = random.Random(seed)
    rng.shuffle(indices)
    train_samples = [folder.samples[i] for i in indices[:n_train]]
    val_samples = [folder.samples[i] for i in indices[n_train:]]
    train_ds = _FolderDataset(train_samples, train_tf)
    val_ds = _FolderDataset(val_samples, val_tf)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=0)

    model = mod.build_model(num_classes=len(_CLASS_NAMES)).to(device)

    v2_ckpt = _DATASETS / "orientation_model_v2" / "best_model.pth"
    if v2_ckpt.is_file():
        try:
            ckpt = torch.load(v2_ckpt, map_location=device, weights_only=False)
            if list(ckpt.get("class_names", [])) == _CLASS_NAMES:
                model.load_state_dict(ckpt["model_state_dict"])
                msg = f"v2 fine-tune — {folder.counts} @ {device}"
            else:
                msg = f"ImageNet — {folder.counts} @ {device}"
        except Exception as e:
            msg = f"ImageNet ({e}) — {folder.counts} @ {device}"
    else:
        msg = f"ImageNet ConvNeXt — {folder.counts} @ {device}"

    _emit(progress, base=base, message=msg)

    class_counts = torch.zeros(len(_CLASS_NAMES))
    for _, li in folder.samples:
        class_counts[li] += 1
    class_weights = (class_counts.sum() / (len(_CLASS_NAMES) * class_counts)).to(device)
    criterion = torch.nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    best_val_acc = 0.0
    best_path = out_dir / "best_model.pth"
    history: list[dict[str, Any]] = []

    for epoch in range(1, epochs + 1):
        train_loss, train_acc = mod.run_epoch(
            model, train_loader, criterion, optimizer, device, train=True
        )
        val_loss, val_acc = mod.run_epoch(
            model, val_loader, criterion, optimizer, device, train=False
        )
        scheduler.step()
        entry = {
            "epoch": epoch,
            "train_loss": round(train_loss, 4),
            "train_acc": round(train_acc, 4),
            "val_loss": round(val_loss, 4),
            "val_acc": round(val_acc, 4),
        }
        history.append(entry)
        improved = val_acc >= best_val_acc
        if improved:
            best_val_acc = float(val_acc)
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "class_names": _CLASS_NAMES,
                    "img_size": _IMG_SIZE,
                    "val_acc": val_acc,
                    "stone_id": stone_id,
                },
                best_path,
            )
        base = _emit(
            progress,
            base=base,
            epoch=epoch,
            train_loss=float(train_loss),
            train_acc=float(train_acc),
            val_loss=float(val_loss),
            val_acc=float(val_acc),
            best_val_acc=best_val_acc,
            history=list(history),
            message=(
                f"Epoch {epoch}/{epochs} — val_acc={val_acc:.3f}"
                + (" ★ best" if improved else "")
            ),
        )

    _emit(progress, base=base, message="ONNX export…")

    checkpoint = torch.load(best_path, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    # Export CPU'da — graph capture / CUDA export tuhaflıklarını azaltır
    model_cpu = model.cpu()
    dummy = torch.randn(1, 3, _IMG_SIZE, _IMG_SIZE)
    onnx_path = out_dir / "orientation_model.onnx"
    for stale in (onnx_path, out_dir / "orientation_model.onnx.data"):
        if stale.exists():
            try:
                stale.unlink()
            except OSError:
                pass
    torch.onnx.export(
        model_cpu,
        dummy,
        str(onnx_path),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
        opset_version=18,
        dynamo=False,
    )
    (out_dir / "class_names.json").write_text(
        json.dumps(
            {"class_names": _CLASS_NAMES, "img_size": _IMG_SIZE, "stone_id": stone_id},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    finished = datetime.now().astimezone().isoformat()
    report = {
        "stone_id": stone_id,
        "best_val_acc": best_val_acc,
        "epochs": epochs,
        "counts": folder.counts,
        "model_dir": str(out_dir.resolve()),
        "finished_at": finished,
    }
    (out_dir / "train_report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return _emit(
        progress,
        base=base,
        status="done",
        message=f"Tamam — best val_acc={best_val_acc:.3f}",
        best_val_acc=best_val_acc,
        model_dir=str(out_dir.resolve()),
        finished_at=finished,
        history=list(history),
    )


def start_training(
    stone_id: str,
    *,
    epochs: int = 15,
    batch_size: int = 16,
    lr: float = 1e-4,
    val_split: float = 0.2,
    seed: int = 42,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    """Parent process: subprocess spawn + progress poll.

    Falcon CUDA graph ile aynı process'te train yasak — ayrı interpreter.
    """
    global _thread, _proc
    from app.vision.dataset_label import sanitize_stone_id

    sid = sanitize_stone_id(stone_id)
    with _lock:
        if _state.status == "running":
            raise RuntimeError("Eğitim zaten çalışıyor.")
        _state.status = "running"
        _state.stone_id = sid
        _state.epoch = 0
        _state.epochs = epochs
        _state.train_loss = 0.0
        _state.train_acc = 0.0
        _state.val_loss = 0.0
        _state.val_acc = 0.0
        _state.best_val_acc = 0.0
        _state.message = "Ayrı CUDA process başlatılıyor…"
        _state.model_dir = str((_DATASETS / f"orientation_model_{sid}").resolve())
        _state.started_at = datetime.now().astimezone().isoformat()
        _state.finished_at = None
        _state.error = None
        _state.history = []

    out_dir = _DATASETS / f"orientation_model_{sid}"
    out_dir.mkdir(parents=True, exist_ok=True)
    progress_path = out_dir / "train_progress.json"
    if progress_path.exists():
        try:
            progress_path.unlink()
        except OSError:
            pass

    cmd = [
        sys.executable,
        "-m",
        "app.vision.orientation_train",
        "--stone-id",
        sid,
        "--epochs",
        str(epochs),
        "--batch-size",
        str(batch_size),
        "--lr",
        str(lr),
        "--val-split",
        str(val_split),
        "--seed",
        str(seed),
        "--progress-file",
        str(progress_path),
    ]

    def _monitor() -> None:
        global _proc
        try:
            _proc = subprocess.Popen(
                cmd,
                cwd=str(_RUNTIME_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            assert _proc is not None
            # Poll progress file while process runs
            while _proc.poll() is None:
                _read_progress_file(progress_path, progress)
                threading.Event().wait(0.8)
            # Final drain
            out, _ = _proc.communicate(timeout=5)
            _read_progress_file(progress_path, progress)
            if _proc.returncode != 0:
                # Prefer progress-file error; else stdout tail
                cur = get_train_state()
                if cur.get("status") != "done":
                    tail = (out or "")[-800:]
                    err = cur.get("error") or tail or f"exit {_proc.returncode}"
                    _set_state(
                        status="error",
                        error=str(err),
                        message=f"Hata: {err}",
                        finished_at=datetime.now().astimezone().isoformat(),
                    )
                    if progress:
                        progress(get_train_state())
            else:
                cur = get_train_state()
                if cur.get("status") == "running":
                    # Process OK but progress missed done — read report
                    report_p = out_dir / "train_report.json"
                    if report_p.is_file():
                        rep = json.loads(report_p.read_text(encoding="utf-8"))
                        _set_state(
                            status="done",
                            best_val_acc=float(rep.get("best_val_acc", 0)),
                            model_dir=rep.get("model_dir", str(out_dir)),
                            message=f"Tamam — best val_acc={rep.get('best_val_acc', 0):.3f}",
                            finished_at=rep.get("finished_at"),
                        )
                        if progress:
                            progress(get_train_state())
        except Exception as e:
            _set_state(
                status="error",
                error=str(e),
                message=f"Hata: {e}",
                finished_at=datetime.now().astimezone().isoformat(),
            )
            if progress:
                progress(get_train_state())

    _thread = threading.Thread(target=_monitor, daemon=True, name="orientation-train-monitor")
    _thread.start()
    return get_train_state()


def _read_progress_file(path: Path, progress: ProgressCb | None) -> None:
    if not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            _apply_progress(data)
            if progress:
                progress(get_train_state())
    except Exception:
        pass


def _cli_main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Orientation train worker (isolated CUDA)")
    parser.add_argument("--stone-id", required=True)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--progress-file", required=True)
    args = parser.parse_args()

    progress_path = Path(args.progress_file)

    def write_progress(state: dict[str, Any]) -> None:
        tmp = progress_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        tmp.replace(progress_path)

    try:
        run_training_job(
            args.stone_id,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            val_split=args.val_split,
            seed=args.seed,
            progress=write_progress,
        )
    except Exception as e:
        write_progress(
            {
                "status": "error",
                "stone_id": args.stone_id,
                "epoch": 0,
                "epochs": args.epochs,
                "train_loss": 0.0,
                "train_acc": 0.0,
                "val_loss": 0.0,
                "val_acc": 0.0,
                "best_val_acc": 0.0,
                "message": f"Hata: {e}",
                "error": str(e),
                "model_dir": "",
                "finished_at": datetime.now().astimezone().isoformat(),
                "history": [],
            }
        )
        raise SystemExit(1) from e


if __name__ == "__main__":
    _cli_main()
