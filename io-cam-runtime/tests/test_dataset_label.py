"""dataset_label: crop kaydet + sayaç."""
from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.vision import dataset_label as dl


def test_sanitize_stone_id_rejects_bad():
    with pytest.raises(ValueError):
        dl.sanitize_stone_id("../evil")
    with pytest.raises(ValueError):
        dl.sanitize_stone_id("")
    assert dl.sanitize_stone_id("oval_A1") == "oval_A1"


def test_save_labeled_crops_and_stats(tmp_path, monkeypatch):
    monkeypatch.setattr(dl, "_dataset_root", lambda: tmp_path)

    frame = np.full((120, 160, 3), 40, dtype=np.uint8)
    cv2.rectangle(frame, (20, 20), (60, 70), (200, 200, 200), -1)
    cv2.rectangle(frame, (90, 40), (140, 90), (180, 180, 180), -1)

    dl.ensure_stone_meta("demo_stone", name="Demo", is_symmetric=True)
    result = dl.save_labeled_crops(
        "demo_stone",
        frame,
        [
            {"bx1": 20, "by1": 20, "bx2": 60, "by2": 70, "label": "true"},
            {"bx1": 90, "by1": 40, "bx2": 140, "by2": 90, "label": "false"},
        ],
    )
    assert result["saved"] == 2
    counts = dl.count_labels("demo_stone")
    assert counts == {"true": 1, "false": 1}
    assert (tmp_path / "demo_stone" / "true").is_dir()
    assert (tmp_path / "demo_stone" / "manifest.jsonl").is_file()


def test_delete_stone(tmp_path, monkeypatch):
    monkeypatch.setattr(dl, "_dataset_root", lambda: tmp_path)
    frame = np.zeros((40, 40, 3), dtype=np.uint8)
    dl.ensure_stone_meta("to_delete", name="X")
    dl.save_labeled_crops(
        "to_delete",
        frame,
        [{"bx1": 2, "by1": 2, "bx2": 20, "by2": 20, "label": "true"}],
    )
    assert (tmp_path / "to_delete").is_dir()
    out = dl.delete_stone("to_delete")
    assert out["deleted"] is True
    assert not (tmp_path / "to_delete").exists()
    out2 = dl.delete_stone("to_delete")
    assert out2["deleted"] is False


def test_decode_frame_b64_roundtrip():
    frame = np.zeros((32, 48, 3), dtype=np.uint8)
    frame[:] = (10, 20, 30)
    ok, buf = cv2.imencode(".jpg", frame)
    assert ok
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")
    out = dl.decode_frame_b64(b64)
    assert out.shape[0] == 32 and out.shape[1] == 48
