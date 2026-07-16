"""
AI Snapshot + OpenCV Hybrid Detection Module (app/vision/ai_detect.py)

Pipeline:
    1. Falcon-Perception (VLM, PyTorch/CUDA) → taş merkezleri + kaba boyut
    2. Her bbox ROI → adaptive threshold → PCA/minAreaRect → açı
    3. VLM bbox crop → ONNX ConvNeXt → orientation (true/false)

Hız: varsayılan ``max_stones=10`` (job: sahnedeki taşları tek seferde bul,
içlerinden face-up olanı seç). Tek taş için ``max_stones=1`` yeter.
Çoklu tespit için ``max_stones`` yükselt.

Thread-safety: inference tek bir worker thread tarafından sırada işlenir.
Çağıranlar (ws.py / vision.py / job_runner) `concurrent.futures.Future` üzerinden
    senkron `future.result(timeout=...)` veya `await asyncio.wrap_future(future)` ile
bekler. Eski `id(batch)` + busy-wait `time.sleep(0.01)` mekanizması race-condition
yaratıyordu (Python `id()` GC sonrası reuse edebilir → iki batch aynı id'ye çarpışıp
birbirinin sonucunu okuyordu). Future ile bu risk yok; sonuç Future içine gömülü.
"""
from __future__ import annotations

import logging
import math
import queue
import time
from concurrent.futures import Future
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np
from PIL import Image

# Re-exports and modular imports
from app.vision.contour_geometry import (
    _angle_distance,
    _directed_angle,
    _filled_contour_points,
    contour_angle_deg,
    normalize_angle,
)
from app.vision.roi_segment import _roi_angle, _split_merged_blob, _trim_to_owner
import app.vision.vlm_worker as _worker_mod
from app.vision.vlm_worker import (
    _AI_DTYPE,
    _AI_MAX_NEW_TOKENS_CAP,
    _AI_MAX_NEW_TOKENS_SINGLE,
    _AI_MODEL_PATH,
    _DEFAULT_MAX_STONES,
    _format_bboxes_raw,
    _format_vlm_tokens,
    _max_new_tokens_for,
    _stop_token_ids_for,
    _vlog,
    ai_status,
    get_ai_model,
)
from app.vision.vlm_preprocess import (
    VLM_IMG_MAX_DIM as _AI_IMG_MAX_DIM,
    VLM_IMG_MIN_DIM as _AI_IMG_MIN_DIM,
    resize_for_vlm,
)

FONT = cv2.FONT_HERSHEY_SIMPLEX
COL_CENTER = (0, 60, 255)
COL_AXIS = (0, 140, 255)
COL_BBOX = (0, 255, 120)  # VLM bbox — yeşil
COL_LABEL = (255, 255, 0)  # true / default
COL_ORIENT_FALSE = (0, 0, 255)  # BGR kırmızı — false orientation
COL_ORIENT_TRUE = (0, 220, 0)  # BGR yeşil — true orientation

logger = logging.getLogger("io_cam.ai_detect")


def __getattr__(name: str) -> Any:
    """Delegate dynamic/mutable module-level variables to vlm_worker."""
    if name in (
        "_ai_status",
        "_model",
        "_tokenizer",
        "_model_args",
        "_engine",
        "_device",
        "_ai_request_queue",
        "_worker_started",
        "_ai_busy_lock",
        "_ai_worker_thread",
    ):
        return getattr(_worker_mod, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def ai_snapshot_detect(
    frame: np.ndarray,
    prompt: str = "stone",
    *,
    thresh_val: int = 0,
    invert_threshold: bool = True,
    use_pca_angle: bool = True,
    is_symmetric: bool = True,
    draw: bool = True,
    block_size: int = 31,
    c_val: int = 8,
    skip_if_busy: bool = False,
    busy_timeout_s: float = 60.0,
    max_stones: int = _DEFAULT_MAX_STONES,
) -> tuple[list[dict[str, Any]], np.ndarray, str]:
    t0 = time.perf_counter()
    out = frame.copy() if draw else frame
    objects: list[dict[str, Any]] = []
    max_stones = max(1, int(max_stones))

    get_ai_model()  # Arka plan thread'ini baslatir (eger baslamamissa)

    if _worker_mod._ai_status != "ready":
        print(f"[VLM] skip — status={_worker_mod._ai_status} (henuz hazir degil)", flush=True)
        if draw:
            h, w = out.shape[:2]
            cv2.rectangle(out, (0, 0), (w, 80), (0, 0, 0), -1)
            cv2.putText(out, f"AI Model Status: {_worker_mod._ai_status.upper()} (Please wait...)", (20, 50), FONT, 1.2, (0, 255, 255), 3)
        return objects, out, ""

    from falcon_perception import build_prompt_for_task

    # Ön küçültme: PagedInferenceEngine Sequence tokenizasyonu öncesi cv2 ile küçült.
    t_pre0 = time.perf_counter()
    small, _, _, _ = resize_for_vlm(frame, max_dim=_AI_IMG_MAX_DIM)
    pil_image = Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))

    subject = (prompt or "").strip() or "stone"
    text_prompt = build_prompt_for_task(subject, "detection")
    max_new_tokens = _max_new_tokens_for(max_stones)
    t_pre1 = time.perf_counter()
    print(
        f"[TIMING] preprocess: {t_pre1 - t_pre0:.3f}s "
        f"(task=detection max_new_tokens={max_new_tokens} max_stones={max_stones} engine=paged)",
        flush=True,
    )

    future: "Future[Any]" = Future()
    req = (future, pil_image, text_prompt, max_new_tokens, max_stones)
    if skip_if_busy:
        # Non-blocking put: queue doluysa ``queue.Full`` → bu frame atlanır.
        try:
            _worker_mod._ai_request_queue.put_nowait(req)
        except queue.Full:
            return objects, out, text_prompt
    else:
        # Blocking put — snapshot/job için önceki iş bitsin (varsayılan 60s).
        try:
            _worker_mod._ai_request_queue.put(req, timeout=busy_timeout_s)
        except queue.Full:
            print(
                f"[VLM] skip — AI queue dolu (busy timeout {busy_timeout_s:.1f}s)",
                flush=True,
            )
            logger.warning("AI queue dolu (busy) — put timeout %.1fs", busy_timeout_s)
            raise RuntimeError(
                f"AI meşgul — {busy_timeout_s:.0f}s içinde sıraya giremedi. "
                "Önceki analizi bekleyip tekrar deneyin."
            )
    # Sync bekleyici: ws.py / vision.py / job_runner hepsi sync context'te.
    # Async context'te çağıran ``await asyncio.wrap_future(future)`` tercih etmeli.
    # İlk torch.compile 30 sn'yi kolay aşar → 180 sn (sonraki istekler hızlı biter).
    t_wait0 = time.perf_counter()
    try:
        result = future.result(timeout=180.0)
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        print(f"[VLM] AI Inference Error: {err}", flush=True)
        logger.error("AI Inference Error: %s", err, exc_info=True)
        return objects, out, text_prompt
    t_wait1 = time.perf_counter()

    worker_gen_sec = -1.0
    stats = None
    if isinstance(result, tuple) and len(result) == 5:
        tokens, aux_outputs, input_len, worker_gen_sec, stats = result
    elif isinstance(result, tuple) and len(result) == 4:
        tokens, aux_outputs, input_len, worker_gen_sec = result
    elif isinstance(result, tuple) and len(result) == 3:
        tokens, aux_outputs, input_len = result
    elif isinstance(result, tuple) and len(result) == 2:
        tokens, aux_outputs = result
        input_len = 0
    else:
        # Eski worker sonucu (sadece aux) — güvenlik
        tokens, aux_outputs, input_len = None, result, 0

    wait_sec = t_wait1 - t_wait0

    t_parse0 = time.perf_counter()
    vlm_reply, gen_ids = _format_vlm_tokens(tokens, input_len=input_len)
    aux = aux_outputs[0]
    n_tok = len(gen_ids)
    ms_per = (worker_gen_sec * 1000.0 / n_tok) if n_tok > 0 and worker_gen_sec >= 0 else 0.0
    prefill_ms = getattr(stats, "prefill_ms", None) if stats else None
    decode_ms = getattr(stats, "decode_wall_ms", None) if stats else None
    finalize_ms = getattr(stats, "finalize_ms", None) if stats else None
    print(
        f"[TIMING] VLM wait+generate: {wait_sec:.3f}s "
        f"(worker_generate={worker_gen_sec:.3f}s "
        f"gen_tokens={n_tok} ~{ms_per:.1f}ms/token "
        f"prefill_ms={prefill_ms} decode_ms={decode_ms} finalize_ms={finalize_ms})",
        flush=True,
    )

    # ── Get bboxes from aux ─────────────────────────────────────
    # bboxes_raw is a flat alternating list: [{x,y}, {h,w}, {x,y}, {h,w}, ...].
    # Boyutu kullanmak sabit 40 px ROI'nin büyük taşı kesmesini veya küçük taşta
    # gereksiz arka plan toplamasını önler.
    raw = getattr(aux, "bboxes_raw", []) or []
    detections: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
    for raw_index, item in enumerate(raw):
        if not isinstance(item, dict) or "x" not in item or "y" not in item:
            continue
        size = None
        if raw_index + 1 < len(raw):
            candidate = raw[raw_index + 1]
            if isinstance(candidate, dict) and "h" in candidate and "w" in candidate:
                size = candidate
        detections.append((item, size))
    # Model yine fazla döndürebilir — decode erken bitsin diye token kısıtlı;
    # güvenlik ağı olarak üst sınırı uygula.
    detections = detections[:max_stones]
    t_parse1 = time.perf_counter()
    print(
        f"[TIMING] bbox parse: {t_parse1 - t_parse0:.3f}s "
        f"gen_tokens={len(gen_ids)} boxes={len(detections)}",
        flush=True,
    )

    _vlog(
        "max_new_tokens=%d gen_tokens=%d subject=%r objects_cap=%d early_stop_seg=%s",
        max_new_tokens,
        len(gen_ids),
        subject,
        max_stones,
        max_stones <= 1,
    )
    _vlog("gen_ids=%s", "[" + ", ".join(str(i) for i in gen_ids) + "]")
    _vlog("cevap=%s", vlm_reply)
    _vlog("bboxes_raw=%s", _format_bboxes_raw(raw))
    _vlog("bbox_keep=%d", len(detections))

    if not detections:
        t_end = time.perf_counter()
        total = t_end - t0
        print(
            f"[TIMING] TOPLAM: {total:.3f}s ({(1.0 / total) if total > 0 else 0.0:.2f} FPS) "
            f"(0 stone — VLM/preprocess dominant)",
            flush=True,
        )
        _vlog("AI detection returned no centers")
        return objects, out, vlm_reply

    img_h, img_w = frame.shape[:2]
    from app.vision.orientation_classifier import classify_orientations_batch

    # Tüm taşların merkezleri — değen taşlarda kontur ayrımı (Voronoi) için
    # her taşın kendi merkezini komşularından ayırt edebilmemiz gerekiyor.
    all_centers = [
        (float(xy["x"]) * img_w, float(xy["y"]) * img_h) for xy, _ in detections
    ]

    angle_total = 0.0
    stones_meta: list[dict[str, Any]] = []
    boxes: list[tuple[int, int, int, int]] = []

    for i, (xy, size) in enumerate(detections, 1):
        # VLM küçük görüntüden normalize (0-1) koordinat döndürür. Orijinal
        # görüntüye geri ölçekle.
        cx = int(float(xy["x"]) * img_w)
        cy = int(float(xy["y"]) * img_h)
        other_centers = [c for j, c in enumerate(all_centers) if j != i - 1]

        # VLM bbox (tam boyut) — çizim + object meta
        box_w = 80.0
        box_h = 80.0
        if size is not None:
            try:
                bw = abs(float(size["w"])) * img_w
                bh = abs(float(size["h"])) * img_h
                if bw >= 4 and bh >= 4:
                    box_w, box_h = bw, bh
            except (TypeError, ValueError):
                pass

        bx1 = max(0, int(round(cx - box_w / 2)))
        by1 = max(0, int(round(cy - box_h / 2)))
        bx2 = min(img_w, int(round(cx + box_w / 2)))
        by2 = min(img_h, int(round(cy + box_h / 2)))

        # Açı ROI: VLM'in verdiği bbox'ın kendisi — büyütme/küçültme/sabit
        # tavan yok. Eski (×0.7, clip 24-120) yaklaşımı büyük taşları ROI'ye
        # sıkıştırıp kenar temasından eleniyordu (bkz. sabit angle=0.0 kaçağı).
        #
        # Yakın/değen taşlarda ROI bbox'ları örtüşünce Canny komşu taşların
        # kenarlarını da algılıyordu. Çözüm: ROI boyutunda Voronoi maskesi
        # hesaplayıp Canny'nin EDGE MAP'ine uygula (girdiye değil).
        t_a = time.perf_counter()
        roi_voronoi_mask: np.ndarray | None = None
        if other_centers:
            _roi_h = by2 - by1
            _roi_w = bx2 - bx1
            _ys_r, _xs_r = np.mgrid[by1:by2, bx1:bx2]
            _own_dist_sq = (_xs_r - cx) ** 2 + (_ys_r - cy) ** 2
            _other_min_dist_sq = np.full((_roi_h, _roi_w), np.inf, dtype=np.float64)
            for _ox, _oy in other_centers:
                _other_min_dist_sq = np.minimum(
                    _other_min_dist_sq,
                    (_xs_r - _ox) ** 2 + (_ys_r - _oy) ** 2,
                )
            roi_voronoi_mask = (_own_dist_sq <= _other_min_dist_sq).astype(np.uint8) * 255
            print(
                f"[VORONOI] stone {i}: edge-map maskeli (komsu={len(other_centers)})",
                flush=True,
            )
        angle = _roi_angle(
            frame, bx1, by1, bx2, by2,
            thresh_val=thresh_val,
            block_size=block_size, c_val=c_val,
            invert=invert_threshold, use_pca=use_pca_angle,
            is_symmetric=is_symmetric,
            own_center=(float(cx), float(cy)),
            other_centers=other_centers,
            voronoi_mask=roi_voronoi_mask,
        )
        angle_sec = time.perf_counter() - t_a
        angle_total += angle_sec
        print(f"[TIMING] stone {i}: angle={angle_sec:.3f}s", flush=True)

        boxes.append((bx1, by1, bx2, by2))
        stones_meta.append({
            "i": i,
            "cx": cx,
            "cy": cy,
            "bx1": bx1,
            "by1": by1,
            "bx2": bx2,
            "by2": by2,
            "box_w": box_w,
            "box_h": box_h,
            "angle": angle,
        })

    # Tek session.run — N crop (önceki: taş başına ayrı run ≈ 10× overhead)
    t_cls0 = time.perf_counter()
    orient_results = classify_orientations_batch(frame, boxes)
    classify_total = time.perf_counter() - t_cls0
    print(
        f"[TIMING] classify_batch: {classify_total:.3f}s ({len(boxes)} stones)",
        flush=True,
    )

    for meta, (orientation, orient_conf) in zip(stones_meta, orient_results):
        i = meta["i"]
        cx, cy = meta["cx"], meta["cy"]
        bx1, by1, bx2, by2 = meta["bx1"], meta["by1"], meta["bx2"], meta["by2"]
        box_w, box_h = meta["box_w"], meta["box_h"]
        angle = meta["angle"]
        _vlog(
            "stone#%d cx=%d cy=%d angle=%.1f orient=%s conf=%.2f",
            i, cx, cy, angle, orientation, orient_conf,
        )

        if draw:
            box_color = COL_ORIENT_FALSE if orientation == "false" else COL_BBOX
            cv2.rectangle(out, (bx1, by1), (bx2, by2), box_color, 2)
            cv2.circle(out, (cx, cy), 5, COL_CENTER, -1)
            length = max(10, min(int(box_w), int(box_h)) // 2 - 5)
            rad = math.radians(angle)
            cv2.arrowedLine(
                out, (cx, cy),
                (int(cx + length * math.cos(rad)), int(cy + length * math.sin(rad))),
                COL_AXIS, 2, tipLength=0.2,
            )
            orient_tag = orientation if orientation != "uncertain" else "?"
            label = f"#{i}  {int(round(angle))}  {orient_tag}"
            tw, th = cv2.getTextSize(label, FONT, 0.4, 1)[0]
            lx, ly = cx - tw // 2, max(th + 6, by1 - 6)
            cv2.rectangle(out, (lx - 2, ly - th - 3), (lx + tw + 2, ly + 4), (0, 0, 0), -1)
            if orientation == "false":
                label_color = COL_ORIENT_FALSE
            elif orientation == "true":
                label_color = COL_ORIENT_TRUE
            else:
                label_color = COL_LABEL
            cv2.putText(out, label, (lx, ly), FONT, 0.4, label_color, 1, cv2.LINE_AA)

        objects.append({
            "id": i, "index": i,
            "x": float(cx), "y": float(cy),
            "cx": cx, "cy": cy,
            "w": int(round(box_w)),
            "h": int(round(box_h)),
            "area": int(round(box_w * box_h)),
            "angle": round(angle, 1),
            "orientation": orientation,
            "orientation_confidence": round(orient_conf, 3),
            "score": round(orient_conf, 3) if orientation != "uncertain" else 1.0,
        })

    t_end = time.perf_counter()
    total = t_end - t0
    post_sec = angle_total + classify_total
    print(
        f"[TIMING] postprocess: angle_sum={angle_total:.3f}s "
        f"classify_batch={classify_total:.3f}s ({len(detections)} stones)",
        flush=True,
    )
    print(
        f"[TIMING] TOPLAM: {total:.3f}s ({(1.0 / total) if total > 0 else 0.0:.2f} FPS) "
        f"| pre={t_pre1 - t_pre0:.3f}s vlm={worker_gen_sec:.3f}s "
        f"wait={wait_sec:.3f}s post={post_sec:.3f}s",
        flush=True,
    )
    return objects, out, vlm_reply


@dataclass
class Stone:
    x: float
    y: float
    angle: float
    score: float
    area: float = 0.0
    robot_x: float = 0.0
    robot_y: float = 0.0
    orientation: str = "uncertain"  # true | false | uncertain
    orientation_confidence: float = 0.0


def detect_all(
    frame: np.ndarray,
    template: Any,
    *,
    homography: np.ndarray | None = None,
    cal_dir=None,
    max_stones: int | None = None,
) -> list[Stone]:
    from app.config.settings import load_settings
    from app.vision.calibration import load_homography, pixel_to_robot
    if homography is None and cal_dir is not None:
        homography = load_homography(cal_dir)

    live = load_settings()
    stones_limit = max_stones if max_stones is not None else live.vlm_max_stones
    is_symmetric = template.is_symmetric if hasattr(template, "is_symmetric") else True
    objects, _, _ = ai_snapshot_detect(
        frame,
        prompt=live.vlm_prompt,
        draw=False,
        is_symmetric=is_symmetric,
        max_stones=stones_limit,
    )

    stones = []
    for obj in objects:
        rx, ry = float(obj["cx"]), float(obj["cy"])
        if homography is not None:
            rx, ry = pixel_to_robot(obj["cx"], obj["cy"], homography)
        stones.append(Stone(
            x=float(obj["cx"]),
            y=float(obj["cy"]),
            angle=obj["angle"],
            score=obj["score"],
            area=obj.get("area", 0.0),
            robot_x=rx,
            robot_y=ry,
            orientation=str(obj.get("orientation", "uncertain")),
            orientation_confidence=float(obj.get("orientation_confidence", 0.0)),
        ))
    return stones