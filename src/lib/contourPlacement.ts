import type * as THREE from 'three';
import type { Point2D } from '@/Utils/contourAngle';
import { extractPointsFromEntityData } from '@/Utils/contourAngle';

/** Line2 instanceStart/instanceEnd → dünya uzayı noktaları */
export function extractLineGeometryPoints(obj: {
  geometry?: {
    attributes?: {
      instanceStart?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ?: (i: number) => number };
      instanceEnd?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ?: (i: number) => number };
    };
  };
}): Point2D[] {
  const startAttr = obj.geometry?.attributes?.instanceStart;
  const endAttr = obj.geometry?.attributes?.instanceEnd;
  if (!startAttr || !endAttr || typeof startAttr.count !== 'number') return [];

  const pts: Point2D[] = [];
  for (let i = 0; i < startAttr.count; i++) {
    if (i === 0) {
      pts.push({
        x: startAttr.getX(i),
        y: startAttr.getY(i),
      });
    }
    pts.push({
      x: endAttr.getX(i),
      y: endAttr.getY(i),
    });
  }
  return pts;
}

/**
 * Sahne nesnesinden yerleştirme/CSV için 2D noktalar (stripGenerator ile uyumlu).
 * Açık LWPOLYLINE segmentleri (handle *_seg_N) dahil.
 */
export function extractPointsFromSceneObject(obj: THREE.Object3D): Point2D[] {
  const tObj = obj as THREE.Object3D & {
    isMesh?: boolean;
    isLine?: boolean;
    isLine2?: boolean;
    geometry?: THREE.BufferGeometry & { isBufferGeometry?: boolean; isLineGeometry?: boolean };
  };
  const type = tObj.userData?.type as string | undefined;
  const data = tObj.userData?.data;
  if (!type || !data) return [];

  const pts: Point2D[] = [];

  if (type === 'LINE') {
    const lineGeometryPoints = extractLineGeometryPoints(tObj);
    if ((data.isBulge || lineGeometryPoints.length > 2) && lineGeometryPoints.length > 1) {
      return lineGeometryPoints;
    }
    if (data.startPoint && data.endPoint) {
      pts.push({ x: data.startPoint.x, y: data.startPoint.y });
      pts.push({ x: data.endPoint.x, y: data.endPoint.y });
      return pts;
    }
    return lineGeometryPoints;
  }

  if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    if (data.vertices) {
      data.vertices.forEach((v: { x?: number; y?: number }) => {
        pts.push({ x: v.x ?? 0, y: v.y ?? 0 });
      });
    }
    return pts;
  }

  if (type === 'ARC') {
    if (data.points?.length) {
      data.points.forEach((p: { x: number; y: number }) => pts.push({ x: p.x, y: p.y }));
      return pts;
    }
    const fromGeo = extractLineGeometryPoints(tObj);
    if (fromGeo.length > 1) return fromGeo;
  }

  if (type === 'SPLINE' && data.points?.length) {
    data.points.forEach((p: { x: number; y: number }) => pts.push({ x: p.x, y: p.y }));
    return pts;
  }

  const fromEntity = extractPointsFromEntityData(type, data);
  if (fromEntity.length >= 2) return fromEntity;

  const linePts = extractLineGeometryPoints(tObj);
  if (linePts.length > 0) return linePts;

  if (tObj.geometry?.isBufferGeometry && !tObj.geometry.isLineGeometry) {
    const pos = tObj.geometry.attributes?.position;
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        pts.push({ x: pos.getX(i), y: pos.getY(i) });
      }
    }
  }

  return pts;
}

/** Kontür geometrisinin eksen hizalı bounding box merkezi (CSV target_x/y). */
export function calcBboxCenter(points: Point2D[]): { x: number; y: number } | null {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function calcPlacementCenterFromSceneObject(obj: THREE.Object3D): { x: number; y: number } {
  const bbox = calcBboxCenter(extractPointsFromSceneObject(obj));
  if (bbox) return bbox;

  const data = obj.userData?.data;
  if (data?.vertices?.length) {
    let sx = 0;
    let sy = 0;
    data.vertices.forEach((v: { x?: number; y?: number }) => {
      sx += v.x ?? 0;
      sy += v.y ?? 0;
    });
    return { x: sx / data.vertices.length, y: sy / data.vertices.length };
  }
  if (data?.center) {
    return { x: data.center.x, y: data.center.y };
  }
  return { x: 0, y: 0 };
}
