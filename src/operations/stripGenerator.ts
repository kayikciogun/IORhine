import * as THREE from 'three';
import { StoneType, PickPlaceConfig } from '@/types/pickplace';
import { DxfWriter } from '@/Utils/dxfWriter';
import { Path, pathToCavalierPolyline, convertVertexesToPath } from '@/Utils/offsetUtils';
import { calcAngleFromSceneObject } from '@/Utils/contourAngle';

export interface StripCell {
  x: number;
  y: number;
  stoneTypeId: string;
  color: string;
  originalHandle: string;
  path: Path;
  polylinePoints?: { x: number; y: number }[];
  /** Hedef yerleştirme açısı (°) — glue hücresi ve robot C ekseni için. */
  targetAngle: number;
  /** false → açık kontur (ARC gibi), SVG'de Z ile kapatılmaz. */
  isClosed: boolean;
}

function extractLineGeometryPoints(obj: any): [number, number, number][] {
  const startAttr = obj?.geometry?.attributes?.instanceStart;
  const endAttr = obj?.geometry?.attributes?.instanceEnd;
  if (!startAttr || !endAttr || typeof startAttr.count !== 'number') return [];

  const pts: [number, number, number][] = [];
  for (let i = 0; i < startAttr.count; i++) {
    if (i === 0) {
      pts.push([startAttr.getX(i), startAttr.getY(i), startAttr.getZ?.(i) ?? 0]);
    }
    pts.push([endAttr.getX(i), endAttr.getY(i), endAttr.getZ?.(i) ?? 0]);
  }
  return pts;
}

export function generateStripData(
  scene: THREE.Scene | THREE.Group,
  stoneTypes: StoneType[],
  config: PickPlaceConfig
): StripCell[] {
  const cells: StripCell[] = [];
  let currentIndex = 0;

  // O(1) handle → sahne objesi — tek traverse ile
  const handleIndex = new Map<string, THREE.Object3D>();
  scene.traverse((obj) => {
    const h = obj.userData?.handle;
    if (h) handleIndex.set(h, obj);
  });

  for (const st of stoneTypes) {
    for (const handle of st.contourIds) {
      const targetObj = handleIndex.get(handle) ?? null;
      if (!targetObj) continue;

      const vertexes: [number, number, number][] = [];
      let isClosed = true;

      const tObj: any = targetObj;
      const type = tObj.userData?.type;
      const data = tObj.userData?.data;

      if (!type || !data) continue;

      if (type === 'LINE') {
        const lineGeometryPoints = extractLineGeometryPoints(tObj);
        // LWPOLYLINE içindeki bulge'lı yaylar dxfSceneBuilder'da type=LINE,
        // data.isBulge=true olarak gelir; gerçek eğri noktaları Line2 geometry'dedir.
        if ((data.isBulge || lineGeometryPoints.length > 2) && lineGeometryPoints.length > 1) {
          vertexes.push(...lineGeometryPoints);
          isClosed = false;
        } else if (data.startPoint && data.endPoint) {
          vertexes.push([data.startPoint.x, data.startPoint.y, 0]);
          vertexes.push([data.endPoint.x, data.endPoint.y, 0]);
          isClosed = false;
        }
      } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        isClosed = !!data.shape || !!data.closed || data.isClosed;
        if (data.vertices) {
          data.vertices.forEach((v: any) => {
            vertexes.push([v.x || 0, v.y || 0, v.bulge || 0]);
          });
        }
      } else if (type === 'CIRCLE') {
        if (data.center) {
          const c = data.center;
          const r = data.radius || 1;
          vertexes.push([c.x - r, c.y, 1]);
          vertexes.push([c.x + r, c.y, 1]);
          isClosed = true;
        }
      } else if (type === 'ARC') {
        // Sahne ARC objesi dxfSceneBuilder'da örneklenmiş Line2 olarak çiziliyor.
        // Aynı noktaları kullan; arc'ı bulge/path dönüşümüne sokma.
        if (data.points && data.points.length > 0) {
          data.points.forEach((p: any) => {
            vertexes.push([p.x, p.y, 0]);
          });
        } else {
          vertexes.push(...extractLineGeometryPoints(tObj));
        }

        if (vertexes.length < 3 && data.center) {
          vertexes.length = 0;
          // Fallback: center+radius+angles (radian) ile örnekle
          const c = data.center;
          const r = data.radius || 1;
          const startAngle = data.startAngle ?? 0;
          const endAngle   = data.endAngle   ?? 0;
          let sweep = data.sweepAngleRad ?? (endAngle - startAngle);
          if (sweep <= 0) sweep += Math.PI * 2;
          const segments = Math.max(16, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
          for (let k = 0; k <= segments; k++) {
            const ang = startAngle + (k / segments) * sweep;
            vertexes.push([c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r, 0]);
          }
        }

        isClosed = false;
      } else if (tObj.isMesh || tObj.isLine || tObj.isLine2) {
        const linePoints = extractLineGeometryPoints(tObj);
        if (linePoints.length > 0) {
          vertexes.push(...linePoints);
          isClosed = false;
        } else if (data.center) {
          // no-op: handled by typed branches above
        } else {
          const geo = tObj.geometry;
          if (geo && geo.isBufferGeometry && !geo.isLineGeometry) {
            const pos = geo.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              vertexes.push([pos.getX(i), pos.getY(i), 0]);
            }
          }
        }
      }

      if (vertexes.length < 2) continue;

      // Merkezileştir
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      vertexes.forEach(v => {
        if (v[0] < minX) minX = v[0];
        if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1];
        if (v[1] > maxY) maxY = v[1];
      });
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      const localVertexes = vertexes.map(v => [v[0] - cx, v[1] - cy, v[2]] as [number, number, number]);
      const polylinePoints = !isClosed
        ? localVertexes.map(([x, y]) => ({ x, y }))
        : undefined;

      let finalPath: Path = [];
      if (localVertexes.length > 1 && !polylinePoints) {
        finalPath = convertVertexesToPath(localVertexes, isClosed);
      }

      const pitch = config.cellSize;
      const col = currentIndex % config.rowLength;
      const row = Math.floor(currentIndex / config.rowLength);
      const cellX = config.stripOriginX + col * pitch + config.cellSize / 2;
      const cellY = config.stripOriginY + row * pitch + config.cellSize / 2;

      const targetAngle = calcAngleFromSceneObject(targetObj);

      cells.push({
        x: cellX,
        y: cellY,
        stoneTypeId: st.id,
        color: st.color,
        originalHandle: handle,
        path: finalPath,
        polylinePoints,
        targetAngle,
        isClosed,
      });

      currentIndex++;
    }
  }

  return cells;
}

/**
 * Yapışkan levha şablonunu lazer kesimine hazır DXF olarak dışa aktar.
 *
 * Sadece taş kontürleri export edilir (grid kareleri yok).
 */
export function exportStripToDxf(cells: StripCell[], config: PickPlaceConfig): string {
  const writer = new DxfWriter();

  cells.forEach((cell) => {
    // Taş kontürü
    if (cell.polylinePoints && cell.polylinePoints.length > 1) {
      const pts = cell.polylinePoints.map((p) => ({
        x: cell.x + p.x,
        y: cell.y + p.y,
        bulge: 0,
      }));
      writer.addPolyline(pts, cell.isClosed, 'CONTOUR');
    } else if (cell.path && cell.path.length > 0) {
      const cavData = pathToCavalierPolyline(cell.path, true);
      if (cavData && cavData.vertexes) {
        const pts = cavData.vertexes.map((v: number[]) => ({
          x: cell.x + v[0],
          y: cell.y + v[1],
          bulge: v[2] || 0
        }));
        writer.addPolyline(pts, true, 'CONTOUR');
      }
    }

  });

  return writer.generate();
}
