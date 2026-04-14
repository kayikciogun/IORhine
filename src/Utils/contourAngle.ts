/**
 * Contour Angle Calculator
 * Convex Hull + Rotating Calipers → Minimum Bounding Rectangle → Açı
 *
 * Kontürün DXF desen üzerindeki duruş açısını hesaplar (rota eksenine vereceğimiz derece).
 * Çember/kare gibi aspect ratio ≈ 1 şekillerde 0° döner (her yönde aynı).
 */

export type Point2D = { x: number; y: number };

/**
 * Andrew's Monotone Chain — O(n log n) Convex Hull
 */
export function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const cross = (O: Point2D, A: Point2D, B: Point2D) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Min Oriented Bounding Box (OBB) via Rotating Calipers
 * Returns { angle, width, height }
 * angle: radyan cinsinden — korunturmda uzun kenarının X ekseniyle açısı
 */
export function minBoundingRect(hullPoints: Point2D[]): {
  angle: number; // radyan
  width: number;
  height: number;
  area: number;
} {
  const n = hullPoints.length;
  if (n === 0) return { angle: 0, width: 0, height: 0, area: 0 };
  if (n === 1) return { angle: 0, width: 0, height: 0, area: 0 };
  if (n === 2) {
    const dx = hullPoints[1].x - hullPoints[0].x;
    const dy = hullPoints[1].y - hullPoints[0].y;
    return { angle: Math.atan2(dy, dx), width: Math.hypot(dx, dy), height: 0, area: 0 };
  }

  let minArea = Infinity;
  let bestAngle = 0;
  let bestWidth = 0;
  let bestHeight = 0;

  for (let i = 0; i < n; i++) {
    const p1 = hullPoints[i];
    const p2 = hullPoints[(i + 1) % n];

    // Bu kenarın yönü
    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const cosA = Math.cos(-edgeAngle);
    const sinA = Math.sin(-edgeAngle);

    // Hull noktalarını bu kenar yönünde döndür
    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const p of hullPoints) {
      const u = p.x * cosA - p.y * sinA;
      const v = p.x * sinA + p.y * cosA;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;

    if (area < minArea) {
      minArea = area;
      bestWidth = w;
      bestHeight = h;
      bestAngle = edgeAngle;
    }
  }

  // Her zaman uzun kenarı temel al
  if (bestHeight > bestWidth) {
    bestAngle += Math.PI / 2;
    [bestWidth, bestHeight] = [bestHeight, bestWidth];
  }

  return { angle: bestAngle, width: bestWidth, height: bestHeight, area: minArea };
}

/**
 * Ana fonksiyon: Ham nokta listesinden taşın dizim açısını (derece) hesapla.
 *
 * @param points  Kontürü oluşturan 2D noktalar (local koordinatta, DXF'ten gelen)
 * @param aspectThreshold  Bu değerin altındaki en/boy oranlarında taş yuvarlak/kare sayılır → 0° döner
 * @returns  Derece [0, 180) aralığında. Simetrik taşlar için 0-180 yeterli.
 */
export function calcContourPlacementAngle(
  points: Point2D[],
  aspectThreshold = 0.95,
): number {
  if (points.length < 2) return 0;

  const hull = convexHull(points);
  const obb = minBoundingRect(hull);

  // Width/height oranı — 1'e yakınsa döndürmeye gerek yok
  const smaller = Math.min(obb.width, obb.height);
  const larger  = Math.max(obb.width, obb.height);
  if (larger === 0) return 0;
  const aspectRatio = smaller / larger;

  if (aspectRatio >= aspectThreshold) {
    // Dairesel veya kareye yakın — açı fark etmez
    return 0;
  }

  // radyan → derece, normalize to [0, 180)
  let deg = (obb.angle * 180) / Math.PI;
  deg = ((deg % 180) + 180) % 180; // [-∞, ∞] → [0, 180)

  return Math.round(deg * 100) / 100; // 2 ondalık
}

/**
 * DXF entity data'sından nokta listesi çıkar (stripGenerator ile aynı mantık)
 */
export function extractPointsFromEntityData(
  type: string,
  data: any,
  sampleCount = 32,
): Point2D[] {
  const pts: Point2D[] = [];

  if (type === 'LINE') {
    if (data.startPoint) pts.push({ x: data.startPoint.x, y: data.startPoint.y });
    if (data.endPoint)   pts.push({ x: data.endPoint.x,   y: data.endPoint.y });

  } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    if (data.vertices) {
      data.vertices.forEach((v: any) => pts.push({ x: v.x ?? 0, y: v.y ?? 0 }));
    }

  } else if (type === 'CIRCLE') {
    const c = data.center ?? { x: 0, y: 0 };
    const r = data.radius ?? 1;
    for (let i = 0; i < sampleCount; i++) {
      const a = (2 * Math.PI * i) / sampleCount;
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }

  } else if (type === 'ARC') {
    const c = data.center ?? { x: 0, y: 0 };
    const r = data.radius ?? 1;
    let startA = data.startAngle ?? 0;
    let endA   = data.endAngle   ?? Math.PI * 2;
    if (endA < startA) endA += Math.PI * 2;
    const steps = Math.max(4, Math.round((endA - startA) / (2 * Math.PI) * sampleCount));
    for (let i = 0; i <= steps; i++) {
      const a = startA + ((endA - startA) * i) / steps;
      pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }

  } else if (type === 'ELLIPSE') {
    const c  = data.center ?? { x: 0, y: 0 };
    const rx = data.radiusX ?? data.majorR ?? 1;
    const ry = data.radiusY ?? data.minorR ?? 1;
    for (let i = 0; i < sampleCount; i++) {
      const a = (2 * Math.PI * i) / sampleCount;
      pts.push({ x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry });
    }
  }

  return pts;
}

/**
 * Sahne nesnesinden (Three.js userData) açı hesapla
 */
export function calcAngleFromSceneObject(obj: any): number {
  const type = obj?.userData?.type;
  const data = obj?.userData?.data;
  if (!type || !data) return 0;
  const pts = extractPointsFromEntityData(type, data);
  return calcContourPlacementAngle(pts);
}
