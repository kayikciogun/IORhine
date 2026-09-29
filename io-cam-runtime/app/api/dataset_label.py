"""Orientation dataset labeling API — yeni taş tanıtma sihirbazı."""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.vision import dataset_label as dl

router = APIRouter(prefix="/api/vision/dataset", tags=["dataset"])

TARGET_PER_CLASS = 100


class CreateStoneBody(BaseModel):
    stone_id: str = Field(..., min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    is_symmetric: bool = True


class LabelItem(BaseModel):
    bx1: int
    by1: int
    bx2: int
    by2: int
    label: Literal["true", "false"]


class LabelBatchBody(BaseModel):
    stone_id: str = Field(..., min_length=1, max_length=64)
    frame_jpeg_base64: str = Field(..., min_length=16)
    labels: list[LabelItem] = Field(default_factory=list, max_length=100)


@router.post("/stones")
async def create_stone(body: CreateStoneBody) -> dict[str, Any]:
    try:
        root = await asyncio.to_thread(
            dl.ensure_stone_meta,
            body.stone_id,
            name=body.name,
            is_symmetric=body.is_symmetric,
        )
        counts = await asyncio.to_thread(dl.count_labels, body.stone_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "ok": True,
        "stone_id": dl.sanitize_stone_id(body.stone_id),
        "path": str(root),
        "counts": counts,
        "target_per_class": TARGET_PER_CLASS,
    }


@router.get("/stones")
async def list_stones() -> dict[str, Any]:
    stones = await asyncio.to_thread(dl.list_stones)
    return {"stones": stones, "target_per_class": TARGET_PER_CLASS}


@router.get("/stats/{stone_id}")
async def get_stats(stone_id: str) -> dict[str, Any]:
    try:
        counts = await asyncio.to_thread(dl.count_labels, stone_id)
        sid = dl.sanitize_stone_id(stone_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {
        "stone_id": sid,
        "true": counts["true"],
        "false": counts["false"],
        "target_per_class": TARGET_PER_CLASS,
        "ready_to_train": (
            counts["true"] >= TARGET_PER_CLASS
            and counts["false"] >= TARGET_PER_CLASS
        ),
    }


@router.post("/label-batch")
async def label_batch(body: LabelBatchBody) -> dict[str, Any]:
    if not body.labels:
        raise HTTPException(status_code=400, detail="labels boş — en az 1 etiket gerekli.")
    try:
        frame = await asyncio.to_thread(dl.decode_frame_b64, body.frame_jpeg_base64)
        result = await asyncio.to_thread(
            dl.save_labeled_crops,
            body.stone_id,
            frame,
            [item.model_dump() for item in body.labels],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    counts = result["counts"]
    result["target_per_class"] = TARGET_PER_CLASS
    result["ready_to_train"] = (
        counts["true"] >= TARGET_PER_CLASS and counts["false"] >= TARGET_PER_CLASS
    )
    return result


@router.delete("/stones/{stone_id}")
async def delete_stone(stone_id: str) -> dict[str, Any]:
    try:
        result = await asyncio.to_thread(dl.delete_stone, stone_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return result


class TrainStartBody(BaseModel):
    stone_id: str = Field(..., min_length=1, max_length=64)
    epochs: int = Field(default=15, ge=3, le=60)
    batch_size: int = Field(default=16, ge=4, le=64)
    lr: float = Field(default=1e-4, gt=0, le=1e-2)


class ActivateBody(BaseModel):
    model_dir: str | None = None
    stone_id: str | None = None


def _progress_broadcast(state: dict[str, Any]) -> None:
    try:
        import asyncio
        from app.services import services

        loop = getattr(services, "_train_loop", None)
        if loop is None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
        asyncio.run_coroutine_threadsafe(
            services.bus.emit("training_progress", state),
            loop,
        )
    except Exception:
        pass


@router.get("/models")
async def list_models() -> dict[str, Any]:
    from app.vision.orientation_train import list_orientation_models

    return await asyncio.to_thread(list_orientation_models)


@router.post("/train")
async def start_train(body: TrainStartBody) -> dict[str, Any]:
    import asyncio
    from app.services import services
    from app.vision import orientation_train as ot

    # Worker thread EventBus emit için loop referansı
    services._train_loop = asyncio.get_running_loop()  # type: ignore[attr-defined]
    try:
        state = await asyncio.to_thread(
            ot.start_training,
            body.stone_id,
            epochs=body.epochs,
            batch_size=body.batch_size,
            lr=body.lr,
            progress=_progress_broadcast,
        )
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True, **state}


@router.get("/train/status")
async def train_status() -> dict[str, Any]:
    from app.vision.orientation_train import get_train_state

    return get_train_state()


@router.post("/train/activate")
async def train_activate(body: ActivateBody) -> dict[str, Any]:
    import asyncio
    from pathlib import Path

    from app.vision import orientation_train as ot

    model_dir = body.model_dir
    if not model_dir and body.stone_id:
        model_dir = str(
            Path(__file__).resolve().parents[2]
            / "datasets"
            / f"orientation_model_{body.stone_id}"
        )
    if not model_dir:
        raise HTTPException(status_code=400, detail="model_dir veya stone_id gerekli.")
    try:
        result = await asyncio.to_thread(ot.activate_model, model_dir)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    try:
        from app.services import services

        await services.bus.emit(
            "ai_status",
            {"status": "orientation_ready", "detail": result["model_dir"]},
        )
    except Exception:
        pass
    return result
