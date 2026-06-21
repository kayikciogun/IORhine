from __future__ import annotations

import io
import math
from dataclasses import dataclass

import cv2
import ezdxf
import numpy as np
from ezdxf.entities import Arc, Circle, LWPolyline


@dataclass
class StoneTemplate:
    shape_id: str
    contour: np.ndarray
    is_symmetric: bool
    # P3-D30: ``hu_moments`` ve ``asymmetry_signature`` kaldırıldı — dead fields.
    # ``cv2.matchShapes`` (detector.py) ``template.contour`` kullanır; hu_moments
    # hiçbir yerde okunmuyordu. ``cv2.HuMoments`` computation da kaldırıldı.


def normalize_contour(contour: np.ndarray) -> np.ndarray:
    pts = contour.reshape(-1, 2).astype(np.float32)
    centroid = pts.mean(axis=0)
    pts -= centroid
    if len(pts) < 3:
        return contour
    cov = np.cov(pts.T)
    _, eigvecs = np.linalg.eigh(cov)
    major = eigvecs[:, 1]
    angle = np.arctan2(major[1], major[0])
    c, s = np.cos(-angle), np.sin(-angle)
    rot = np.array([[c, -s], [s, c]])
    pts = pts @ rot.T
    return pts.reshape(-1, 1, 2).astype(np.float32)


def build_template_from_contour(
    shape_id: str,
    contour: np.ndarray,
    *,
    is_symmetric: bool = False,
) -> StoneTemplate:
    norm = normalize_contour(contour)
    # P3-D30: cv2.HuMoments computation kaldırıldı — dead field (hiç okunmuyordu).
    return StoneTemplate(
        shape_id=shape_id,
        contour=norm,
        is_symmetric=is_symmetric,
    )


def _detect_symmetry(contour: np.ndarray, *, tol: float = 0.05) -> bool:
    """P2-A7: kontürün 180° rotasyonel simetrisini tespit et.

    Simetrik taşlar (daire, kare, düzgün çokgen) için PCA major-axis
    açısı 180° belirsizdir; ``is_symmetric=True`` ile ``contour_angle_deg``
    0-180 normalize eder (daha stabil). Asimetrik taşlar için ``False`` → 0-360.
    """
    pts = contour.reshape(-1, 2).astype(np.float64)
    if len(pts) < 4:
        return False
    centroid = pts.mean(axis=0)
    # 180° rotation about centroid: p' = 2*c - p
    rotated = 2 * centroid - pts
    # Her rotated noktasının en yakın original noktaya olan mesafesi
    # (brute-force KD-tree yerine — küçük N için yeterli)
    scale = np.linalg.norm(pts.std(axis=0)) + 1e-9
    max_dist = 0.0
    for rp in rotated:
        dists = np.linalg.norm(pts - rp, axis=1)
        max_dist = max(max_dist, float(dists.min()))
    return max_dist < tol * scale


def _arc_points(arc: Arc, step_deg: float = 5.0) -> list[tuple[float, float]]:
    center = arc.dxf.center
    radius = arc.dxf.radius
    start = math.radians(arc.dxf.start_angle)
    end = math.radians(arc.dxf.end_angle)
    if end < start:
        end += 2 * math.pi
    pts: list[tuple[float, float]] = []
    a = start
    while a <= end + 1e-6:
        pts.append(
            (
                center.x + radius * math.cos(a),
                center.y + radius * math.sin(a),
            )
        )
        a += math.radians(step_deg)
    return pts


def _circle_points(circle: Circle, segments: int = 36) -> list[tuple[float, float]]:
    center = circle.dxf.center
    radius = circle.dxf.radius
    pts: list[tuple[float, float]] = []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        pts.append((center.x + radius * math.cos(a), center.y + radius * math.sin(a)))
    return pts


def _lwpolyline_points(entity: LWPolyline) -> list[tuple[float, float]]:
    return [(float(x), float(y)) for x, y, *_ in entity.get_points("xy")]


def _entity_to_points(entity) -> list[tuple[float, float]] | None:
    dxftype = entity.dxftype()
    if dxftype == "LWPOLYLINE":
        return _lwpolyline_points(entity)
    if dxftype == "LINE":
        return [
            (entity.dxf.start.x, entity.dxf.start.y),
            (entity.dxf.end.x, entity.dxf.end.y),
        ]
    if dxftype == "ARC":
        return _arc_points(entity)
    if dxftype == "CIRCLE":
        return _circle_points(entity)
    return None


def _find_entity_by_handle(doc: ezdxf.document.Drawing, shape_id: str):
    target = shape_id.upper()
    for entity in doc.modelspace():
        if entity.dxf.handle.upper() == target:
            return entity
    try:
        return doc.entitydb[target]
    except KeyError:
        pass
    try:
        return doc.entitydb[shape_id]
    except KeyError:
        pass
    return None


def extract_contour_from_dxf_bytes(shape_id: str, dxf_bytes: bytes) -> np.ndarray | None:
    """Parse DXF and return contour points for shape_id (DXF handle)."""
    try:
        if dxf_bytes[:22].strip().upper().startswith(b"AC10"):
            doc = ezdxf.read(io.BytesIO(dxf_bytes))
        else:
            doc = ezdxf.read(io.StringIO(dxf_bytes.decode(errors="replace")))
    except Exception:
        return None

    entity = _find_entity_by_handle(doc, shape_id)
    if entity is None:
        return None

    pts = _entity_to_points(entity)
    if not pts or len(pts) < 3:
        return None

    arr = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
    return arr


def build_template_from_dxf_bytes(shape_id: str, dxf_bytes: bytes) -> StoneTemplate | None:
    """Build template from DXF; uses placeholder contour if parse fails."""
    contour = extract_contour_from_dxf_bytes(shape_id, dxf_bytes)
    if contour is not None:
        # P2-A7: DXF entity tipinden simetri tespiti. CIRCLE → simetrik;
        # LWPOLYLINE/LINE → _detect_symmetry ile geometric kontrol.
        sym = _detect_symmetry(contour)
        return build_template_from_contour(shape_id, contour, is_symmetric=sym)

    # Frontend can assign synthetic handles for split LWPOLYLINE segments
    # (example: "432_seg_6"). Those ids do not exist in the raw DXF, so try
    # the parent entity handle before falling back to a generic template.
    if "_seg_" in shape_id:
        parent_shape_id = shape_id.split("_seg_", 1)[0]
        contour = extract_contour_from_dxf_bytes(parent_shape_id, dxf_bytes)
        if contour is not None:
            sym = _detect_symmetry(contour)
            return build_template_from_contour(parent_shape_id, contour, is_symmetric=sym)

    pts = np.array(
        [[-5, -5], [5, -5], [5, 5], [-5, 5]],
        dtype=np.float32,
    ).reshape(-1, 1, 2)
    return build_template_from_contour(shape_id, pts, is_symmetric=True)
