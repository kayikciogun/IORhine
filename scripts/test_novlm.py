"""
test_cv_only_detection.py
============================

VLM olmadan, sadece OpenCV (adaptive threshold + contour) ile taş
konumlarını bulmayı dener ve sonucu elindeki gerçek (VisoLabel'de
etiketlenmiş) bbox'larla karşılaştırır.

Amaç: "VLM'e hâlâ ihtiyacımız var mı" sorusunu tahminle değil,
gerçek veri üzerinde recall/precision ölçerek cevaplamak.

Kullanım:
    python test_cv_only_detection.py \
        --coco son_dataset.json \
        --images /path/to/dataset_images
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np


def _iou(box_a, box_b) -> float:
    """box = (x1, y1, x2, y2)"""
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def detect_stones_cv(
    frame_bgr: np.ndarray,
    *,
    block_size: int = 35,
    c_val: int = 6,
    min_area: int = 200,
    max_area: int = 20000,
) -> list[tuple[int, int, int, int]]:
    """Tam kare üzerinde adaptive threshold + contour ile taş bbox'ları bulur."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    bw = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, block_size, c_val,
    )
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kern)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kern)

    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area or area > max_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        boxes.append((x, y, x + w, y + h))
    return boxes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coco", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--iou-threshold", type=float, default=0.3,
                         help="Bir gerçek taşın 'bulundu' sayılması için minimum IoU")
    parser.add_argument("--max-images", type=int, default=0,
                         help="Hızlı test için sadece ilk N görüntüyü kullan (0 = hepsi)")
    args = parser.parse_args()

    with open(args.coco, "r", encoding="utf-8") as f:
        coco = json.load(f)

    img_dir = Path(args.images)
    file_index = {p.name: p for p in img_dir.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")}

    img_map = {im["id"]: im["file_name"] for im in coco["images"]}
    gt_by_image: dict[int, list[tuple[int, int, int, int]]] = {}
    for ann in coco["annotations"]:
        x, y, w, h = ann["bbox"]
        gt_by_image.setdefault(ann["image_id"], []).append((int(x), int(y), int(x + w), int(y + h)))

    image_ids = list(img_map.keys())
    if args.max_images > 0:
        image_ids = image_ids[: args.max_images]

    total_gt = 0
    total_matched = 0
    total_pred = 0
    total_false_positive = 0
    skipped = 0

    for image_id in image_ids:
        fname = Path(img_map[image_id]).name
        if fname not in file_index:
            skipped += 1
            continue

        frame = cv2.imread(str(file_index[fname]))
        if frame is None:
            skipped += 1
            continue

        gt_boxes = gt_by_image.get(image_id, [])
        pred_boxes = detect_stones_cv(frame)

        total_gt += len(gt_boxes)
        total_pred += len(pred_boxes)

        matched_gt = set()
        matched_pred = set()
        for gi, gbox in enumerate(gt_boxes):
            best_iou, best_pi = 0.0, -1
            for pi, pbox in enumerate(pred_boxes):
                if pi in matched_pred:
                    continue
                iou = _iou(gbox, pbox)
                if iou > best_iou:
                    best_iou, best_pi = iou, pi
            if best_iou >= args.iou_threshold:
                matched_gt.add(gi)
                matched_pred.add(best_pi)

        total_matched += len(matched_gt)
        total_false_positive += len(pred_boxes) - len(matched_pred)

    recall = total_matched / total_gt if total_gt else 0.0
    precision = total_matched / total_pred if total_pred else 0.0

    print(f"\n{'='*50}")
    print(f"İşlenen görüntü: {len(image_ids) - skipped} / {len(image_ids)} (atlanan: {skipped})")
    print(f"Toplam gerçek taş (ground truth): {total_gt}")
    print(f"Toplam CV tahmini: {total_pred}")
    print(f"Eşleşen (doğru bulunan): {total_matched}")
    print(f"Yanlış pozitif (taş olmayan ama tespit edilen): {total_false_positive}")
    print(f"\nRECALL    : {recall:.1%}  (gerçek taşların yüzde kaçı bulundu)")
    print(f"PRECISION : {precision:.1%}  (bulunanların yüzde kaçı gerçek taştı)")
    print(f"{'='*50}")

    print("\n── Yorum ──")
    if recall > 0.90 and precision > 0.80:
        print("CV-only detection oldukça güvenilir görünüyor — VLM'i kaldırmayı ciddi ciddi düşünebilirsin.")
    elif recall > 0.75:
        print("CV-only detection orta düzeyde çalışıyor ama kaçırılan taş oranı üretimde risk yaratabilir.")
    else:
        print("CV-only detection güvenilir değil — VLM'e hâlâ ihtiyaç var, mermer dokusu/gölge gibi gürültü hâlâ sorun yaratıyor olabilir.")
    print("Not: block_size / c_val / min_area / max_area parametrelerini kendi sahnene göre ayarlayıp tekrar dene.")


if __name__ == "__main__":
    main()