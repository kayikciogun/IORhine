"""
ROI Segmentation and Angle Determination (app/vision/roi_segment.py)

Handles Voronoi ownership trimming for touching stones, watershed splitting for
merged blobs, edge detection (Canny/Otsu/CLAHE), and ROI angle evaluation.
"""
from __future__ import annotations

import math
import os

import cv2
import numpy as np

from app.vision.contour_geometry import (
    _filled_contour_points,
    contour_angle_deg,
    normalize_angle,
)


def _trim_to_owner(
    mask: np.ndarray,
    own_center_rel: tuple[float, float],
    other_centers_rel: list[tuple[float, float]],
) -> np.ndarray:
    """Değen/birleşen taşlarda Voronoi benzeri ayrım: her piksel en yakın
    merkeze aittir. ``mask`` (kendi + komşu birleşik blob) içinden yalnızca
    kendi merkezine daha yakın pikselleri bırakır — komşu taşın parçasını
    kesip atar, PCA'yı bozmasını önler.
    """
    h, w = mask.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    own_x, own_y = own_center_rel
    dist_own_sq = (xs - own_x) ** 2 + (ys - own_y) ** 2
    dist_other_min_sq = np.full((h, w), np.inf, dtype=np.float64)
    for ox, oy in other_centers_rel:
        d = (xs - ox) ** 2 + (ys - oy) ** 2
        dist_other_min_sq = np.minimum(dist_other_min_sq, d)
    owner_mask = (dist_own_sq <= dist_other_min_sq).astype(np.uint8) * 255
    return cv2.bitwise_and(mask, owner_mask)


def _split_merged_blob(mask: np.ndarray, roi_center: np.ndarray) -> np.ndarray:
    """VLM komşu taşı ayrı obje olarak bulamadıysa (tek bbox) — distance
    transform tepe noktalarını marker yapıp watershed ile böl, ROI merkezine
    en yakın parçayı döndür. ``_trim_to_owner``'ın komşu-merkezsiz karşılığı.
    """
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    max_val = float(dist.max())
    if max_val <= 0:
        return mask

    # Tek eşik her geometride ayrılmayı garanti etmez (yumuşak "bel"lerde
    # düşük eşik iki tepeyi tekrar birleştirir). Yüksekten alçağa dene, ilk
    # gerçek ayrımı (n_labels>=3 → 2+ tepe bölgesi) kullan. Tek taşta hiçbir
    # eşikte ayrılma olmaz (tepe zaten tek) — güvenli.
    sure_fg = None
    for frac in (0.7, 0.6, 0.5, 0.4, 0.3):
        _, candidate = cv2.threshold(dist, frac * max_val, 255, cv2.THRESH_BINARY)
        candidate = candidate.astype(np.uint8)
        n_labels, labels = cv2.connectedComponents(candidate)
        if n_labels > 2:
            sure_fg = candidate
            break
    if sure_fg is None:
        # Hiçbir eşikte ayrılmadı — birleşik blob değil, ayrım gerekmiyor.
        return mask

    unknown = cv2.subtract(mask, sure_fg)
    markers = labels.astype(np.int32) + 1  # 1 = arka plan/belirsiz taban
    markers[unknown == 255] = 0  # 0 = watershed'in çözeceği belirsiz bölge
    dist_u8 = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    dist_bgr = cv2.cvtColor(dist_u8, cv2.COLOR_GRAY2BGR)
    cv2.watershed(dist_bgr, markers)

    best_label, best_dist_sq = None, math.inf
    for lbl in range(2, n_labels + 1):
        ys, xs = np.where(markers == lbl)
        if len(xs) == 0:
            continue
        cx_l, cy_l = float(xs.mean()), float(ys.mean())
        d = (cx_l - roi_center[0]) ** 2 + (cy_l - roi_center[1]) ** 2
        if d < best_dist_sq:
            best_dist_sq = d
            best_label = lbl
    if best_label is None:
        return mask
    out = np.zeros_like(mask)
    out[markers == best_label] = 255
    return out


def _roi_angle(
    frame: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
    *,
    thresh_val: int = 0,
    block_size: int = 31,
    c_val: int = 8,
    invert: bool = True,
    use_pca: bool = True,
    is_symmetric: bool = True,
    own_center: tuple[float, float] | None = None,
    other_centers: list[tuple[float, float]] | None = None,
    voronoi_mask: np.ndarray | None = None,
) -> float:
    """ROI içindeki taşın açısını Canny kenar tespiti ile hesapla.

    Eski yaklaşım (adaptive threshold + Otsu + multi-mask scoring) yansıtıcı
    taşlarda güvenilir kontur üretemiyordu. Canny kenar tespiti parlaklık
    seviyesinden bağımsız çalışır — sadece gradient geçişlerine bakar.

    Değen taşlarda ``own_center`` / ``other_centers`` ile Voronoi ayrımı
    yapılır (mevcut mantık korunuyor).

    ``voronoi_mask``: ROI koordinatlarında uint8 maske (0/255). Canny'nin
    edge map'ine uygulanır — Canny girdisine değil. Böylece:
    - Gerçek piksel gradyanları bozulmadan hesaplanır (yapay kenar yok).
    - Komşu taşlara ait kenarlar suppress edilir.
    """
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return 0.0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi
    h, w = gray.shape[:2]
    roi_area = float(h * w)
    if roi_area <= 0:
        return 0.0
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    roi_center = np.array([w / 2.0, h / 2.0])
    diagonal = math.hypot(w, h)

    # ── Segmentasyon: çoklu strateji, en iyi konturu topla ──
    # Koyu/düşük kontrastlı taşlar (arka planla benzer parlaklık) ham Canny/Otsu
    # ile ayrılamıyor. CLAHE lokal kontrastı artırıp bu taşları görünür kılıyor.
    def _collect_contours(src: np.ndarray, vm: np.ndarray | None = None) -> list[np.ndarray]:
        found: list[np.ndarray] = []
        otsu_v, _ = cv2.threshold(src, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        # 1) Canny
        edges = cv2.Canny(src, max(20, int(otsu_v * 0.5)), max(50, int(otsu_v)))
        ck = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, ck)
        # Kenar boşluklarını kapat (dilate → küçük açıklıkları köprüle)
        edges = cv2.dilate(edges, ck, iterations=1)
        # Voronoi maskesi: komşu taşa ait kenarları sil (yapay Canny kenarı yok)
        if vm is not None:
            _vm = vm if vm.shape == edges.shape else cv2.resize(vm, (w, h), interpolation=cv2.INTER_NEAREST)
            edges = cv2.bitwise_and(edges, _vm)
        cs, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        found.extend(cs)
        # 2) Otsu (her iki polarite)
        mk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        for thr_type in (cv2.THRESH_BINARY_INV, cv2.THRESH_BINARY):
            _, m = cv2.threshold(src, 0, 255, thr_type | cv2.THRESH_OTSU)
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, mk)
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, mk)
            if vm is not None:
                _vm = vm if vm.shape == m.shape else cv2.resize(vm, (w, h), interpolation=cv2.INTER_NEAREST)
                m = cv2.bitwise_and(m, _vm)
            cs2, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            found.extend(cs2)
        return found

    contours = _collect_contours(blur, voronoi_mask)

    # Yeterince büyük kontur bulunmadıysa CLAHE ile kontrast artırıp tekrar dene
    def _max_area(cs: list[np.ndarray]) -> float:
        return max((cv2.contourArea(c) for c in cs), default=0.0)

    if _max_area(contours) < roi_area * 0.15:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        enhanced = cv2.GaussianBlur(enhanced, (5, 5), 0)
        clahe_contours = _collect_contours(enhanced, voronoi_mask)
        if _max_area(clahe_contours) > _max_area(contours):
            contours = clahe_contours

    best_contour: np.ndarray | None = None
    best_score = -math.inf

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < max(20.0, roi_area * 0.008) or area / roi_area > 0.97:
            continue
        moments = cv2.moments(contour)
        if moments["m00"] <= 0:
            continue
        centroid = np.array([
            moments["m10"] / moments["m00"],
            moments["m01"] / moments["m00"],
        ])
        center_distance = float(np.linalg.norm(centroid - roi_center)) / diagonal
        if center_distance > 0.42:
            continue
        bx, by, bw, bh = cv2.boundingRect(contour)
        touches_border = int(bx <= 1) + int(by <= 1)
        touches_border += int(bx + bw >= w - 1) + int(by + bh >= h - 1)
        contains_center = cv2.pointPolygonTest(
            contour, (float(roi_center[0]), float(roi_center[1])), False
        ) >= 0

        # Voronoi sahiplik: komşu taşın konturu mu?
        ownership_bonus = 0.0
        if own_center is not None and other_centers:
            own_rel = (own_center[0] - x1, own_center[1] - y1)
            margin = 0.25 * diagonal
            others_rel = [
                (ox - x1, oy - y1) for ox, oy in other_centers
                if -margin <= (ox - x1) <= w + margin and -margin <= (oy - y1) <= h + margin
            ]
            if others_rel:
                c_mask = np.zeros((h, w), dtype=np.uint8)
                cv2.drawContours(c_mask, [contour], -1, 255, thickness=cv2.FILLED)
                c_ys, c_xs = np.nonzero(c_mask)
                if len(c_xs) > 0:
                    own_x, own_y = own_rel
                    dist_own = (c_xs - own_x) ** 2 + (c_ys - own_y) ** 2
                    dist_other_min = np.full(len(c_xs), np.inf)
                    for ox, oy in others_rel:
                        d = (c_xs - ox) ** 2 + (c_ys - oy) ** 2
                        dist_other_min = np.minimum(dist_other_min, d)
                    ratio = float(np.mean(dist_own <= dist_other_min))
                    ownership_bonus = (ratio - 0.5) * 4.0

        area_ratio = area / roi_area
        score = (
            (1.5 if contains_center else 0.0)
            + min(area_ratio, 0.35) * 2.0
            - center_distance * 4.0
            - touches_border * 0.55
            + ownership_bonus
        )
        if score > best_score:
            best_score = score
            best_contour = contour

    if best_contour is None:
        return 0.0

    # ── Değen taşlar: Voronoi trim ──
    def _filled_mask(contour: np.ndarray) -> np.ndarray:
        m = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(m, [contour], -1, 255, thickness=cv2.FILLED)
        return m

    if own_center is not None and other_centers:
        own_rel = (own_center[0] - x1, own_center[1] - y1)
        margin = 0.25 * diagonal
        others_rel = [
            (ox - x1, oy - y1) for ox, oy in other_centers
            if -margin <= (ox - x1) <= w + margin and -margin <= (oy - y1) <= h + margin
        ]
        if others_rel:
            trimmed = _trim_to_owner(_filled_mask(best_contour), own_rel, others_rel)
            trimmed_contours, _ = cv2.findContours(
                trimmed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if trimmed_contours:
                candidate = max(trimmed_contours, key=cv2.contourArea)
                if cv2.contourArea(candidate) >= 20.0:
                    best_contour = candidate

    # Watershed split (komşu bilgisi olmayan birleşik bloblar)
    hull_area = float(cv2.contourArea(cv2.convexHull(best_contour)))
    solidity = float(cv2.contourArea(best_contour)) / max(hull_area, 1.0)
    if solidity < 0.85:
        split_mask = _split_merged_blob(_filled_mask(best_contour), roi_center)
        split_contours, _ = cv2.findContours(
            split_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if split_contours:
            candidate = max(split_contours, key=cv2.contourArea)
            if cv2.contourArea(candidate) >= 20.0:
                best_contour = candidate

    # ── Açı hesapla + debug karşılaştırma ──
    c_area = float(cv2.contourArea(best_contour))
    c_rect = cv2.minAreaRect(best_contour.astype(np.float32))
    rect_angle = normalize_angle(c_rect)
    pca_angle = contour_angle_deg(best_contour.astype(np.float32), is_symmetric)

    # fitEllipse (en az 5 nokta gerekli)
    ellipse_angle = -1.0
    if len(best_contour) >= 5:
        try:
            ell = cv2.fitEllipse(best_contour.astype(np.float32))
            # fitEllipse açısı: height > width olacak şekilde normalize
            ew, eh = ell[1]
            ea = ell[2]
            if ew > eh:
                ea = (ea + 90.0) % 180.0
            ellipse_angle = ea % 180.0
        except cv2.error:
            pass

    # Eigenvalue bilgisi (anizotropi kontrolü)
    pts = _filled_contour_points(best_contour.astype(np.int32))
    aniso = 0.0
    if len(pts) >= 3:
        c_centered = pts - pts.mean(axis=0)
        c_cov = c_centered.T @ c_centered / len(c_centered)
        c_eigvals = np.linalg.eigh(c_cov)[0]
        aniso = float((c_eigvals[1] - c_eigvals[0]) / max(c_eigvals[1], 1e-9))

    print(
        f"[ANGLE_DEBUG] roi=({x1},{y1})-({x2},{y2}) "
        f"contour_area={c_area:.0f} roi_area={roi_area:.0f} "
        f"ratio={c_area/max(roi_area,1):.2f} aniso={aniso:.3f} | "
        f"PCA={pca_angle:.1f} minAreaRect={rect_angle:.1f} "
        f"fitEllipse={ellipse_angle:.1f} "
        f"rect_size=({c_rect[1][0]:.0f}x{c_rect[1][1]:.0f})",
        flush=True,
    )

    # ── Debug görsel dump: env IOCAM_DEBUG_ROI=1 ise ROI+kontur diske yaz ──
    if os.environ.get("IOCAM_DEBUG_ROI") == "1":
        try:
            dbg_dir = os.environ.get("IOCAM_DEBUG_DIR", "/tmp/iocam_roi")
            os.makedirs(dbg_dir, exist_ok=True)
            vis = roi.copy() if roi.ndim == 3 else cv2.cvtColor(roi, cv2.COLOR_GRAY2BGR)
            # Bulunan kontur (yeşil)
            cv2.drawContours(vis, [best_contour.astype(np.int32)], -1, (0, 255, 0), 1)
            # minAreaRect (mavi)
            box = cv2.boxPoints(c_rect).astype(np.int32)
            cv2.drawContours(vis, [box], 0, (255, 100, 0), 1)
            # PCA açı oku (kırmızı)
            cxr, cyr = int(w / 2), int(h / 2)
            L = min(w, h) // 2
            ar = math.radians(pca_angle)
            cv2.arrowedLine(vis, (cxr, cyr),
                            (int(cxr + L * math.cos(ar)), int(cyr + L * math.sin(ar))),
                            (0, 0, 255), 1, tipLength=0.25)
            # 3x büyüt (küçük ROI'ler görünür olsun)
            vis = cv2.resize(vis, (w * 3, h * 3), interpolation=cv2.INTER_NEAREST)
            fname = f"{dbg_dir}/roi_{x1}_{y1}_pca{int(pca_angle)}_ratio{int(c_area/max(roi_area,1)*100)}.png"
            cv2.imwrite(fname, vis)
        except Exception as _e:
            print(f"[ANGLE_DEBUG] dump failed: {_e}", flush=True)

    if use_pca:
        return pca_angle
    return rect_angle
