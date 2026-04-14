import * as THREE from 'three';
import { StoneType, StripConfig } from '@/types/pickplace';
import { DxfWriter } from '@/Utils/dxfWriter';
import { createCavalierOffsets, Path, ArcSegment, LineSegment, pathToCavalierPolyline, convertVertexesToPath } from '@/Utils/offsetUtils';

export interface StripCell {
  x: number;
  y: number;
  stoneTypeId: string;
  color: string;
  originalHandle: string;
  path: Path;
}

export function generateStripData(
  scene: THREE.Scene | THREE.Group,
  stoneTypes: StoneType[],
  config: StripConfig
): StripCell[] {
  const cells: StripCell[] = [];
  let currentIndex = 0;

  // Tüm taş tiplerindeki contourId'leri sırayla topla
  for (const st of stoneTypes) {
    for (const handle of st.contourIds) {
      // Scene içinden mesh'i bul
      let targetObj: THREE.Object3D | null = null;
      scene.traverse((obj) => {
        if (obj.userData?.handle === handle) {
          targetObj = obj;
        }
      });

      if (!targetObj) continue;

      // Objenin noktalarını çıkar
      const vertexes: [number, number, number][] = [];
      let isClosed = true;
      
      const tObj: any = targetObj;
      const type = tObj.userData?.type;
      const data = tObj.userData?.data;
      
      if (!type || !data) continue;

      if (type === 'LINE') {
         if (data.startPoint && data.endPoint) {
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
             // İki yarım çember olarak çiz (bulge = 1 -> yarıçap kadar kavis)
             vertexes.push([c.x - r, c.y, 1]);
             vertexes.push([c.x + r, c.y, 1]);
             isClosed = true;
         }
      } else if (type === 'ARC') {
         if (data.center) {
             const c = data.center;
             const r = data.radius || 1;
             const startAngle = data.startAngle || 0;
             const endAngle = data.endAngle || 0;
             let angleDiff = endAngle - startAngle;
             
             if (angleDiff < 0) angleDiff += Math.PI * 2;
             
             // Çok büyük açıysa tek bulge ile çizilemeyebilir, 2'ye bölelim
             const p1 = [c.x + Math.cos(startAngle)*r, c.y + Math.sin(startAngle)*r, 0];
             const p3 = [c.x + Math.cos(endAngle)*r, c.y + Math.sin(endAngle)*r, 0];
             
             if (angleDiff > Math.PI) {
                 const midAngle = startAngle + angleDiff / 2;
                 const p2 = [c.x + Math.cos(midAngle)*r, c.y + Math.sin(midAngle)*r, 0];
                 const bulge = Math.tan(angleDiff / 8); 
                 vertexes.push([p1[0], p1[1], bulge]);
                 vertexes.push([p2[0], p2[1], bulge]);
                 vertexes.push([p3[0], p3[1], 0]);
             } else {
                 const bulge = Math.tan(angleDiff / 4);
                 vertexes.push([p1[0], p1[1], bulge]);
                 vertexes.push([p3[0], p3[1], 0]); 
             }
             isClosed = false;
         }
      } else if (tObj.isMesh || tObj.isLine || tObj.isLine2) {
         // Fallback to geometry if it's not a generic DXF object
         const geo = tObj.geometry;
         if (geo && geo.isBufferGeometry && !geo.isLineGeometry) {
           const pos = geo.attributes.position;
           for (let i = 0; i < pos.count; i++) {
              vertexes.push([pos.getX(i), pos.getY(i), 0]);
           }
         }
      }

      // Merkezileştirme: shape'in lokal merkezini orijine taşı
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

      // Path nesnesine dönüştür
      let finalPath: Path = [];
      if (localVertexes.length > 1) {
          finalPath = convertVertexesToPath(localVertexes, isClosed);
      }
      
      // Offset (CavalierContours)
      if (finalPath.length > 0 && config.contourOffset > 0.001) {
        try {
          // contourOffset geçme payıdır.
          const offsetResult = createCavalierOffsets(finalPath, config.contourOffset, isClosed);
          if (offsetResult && offsetResult.length > 0 && offsetResult[0].length > 0) {
            finalPath = offsetResult[0];
          }
        } catch (e) {
          console.warn('[stripGenerator] Offset failed for handle', handle, e);
        }
      }

      // Grid içindeki pozisyonunu hesapla
      const col = currentIndex % config.rowLength;
      const row = Math.floor(currentIndex / config.rowLength);
      
      // X ve Y (örneğin sol alt orijinden başlıyor)
      const cellX = col * config.cellSize + (config.cellSize / 2);
      const cellY = row * config.cellSize + (config.cellSize / 2);

      cells.push({
        x: cellX,
        y: cellY,
        stoneTypeId: st.id,
        color: st.color,
        originalHandle: handle,
        path: finalPath
      });

      currentIndex++;
    }
  }

  return cells;
}

export function exportStripToDxf(cells: StripCell[], config: StripConfig): string {
  const writer = new DxfWriter();
  
  // Outer frame for the whole strip (opsiyonel)
  // writer.addRectangle(...)
  
  cells.forEach((cell, i) => {
    // Kutu ekle
    const hs = config.cellSize / 2;
    writer.addPolyline([
      {x: cell.x - hs, y: cell.y - hs},
      {x: cell.x + hs, y: cell.y - hs},
      {x: cell.x + hs, y: cell.y + hs},
      {x: cell.x - hs, y: cell.y + hs}
    ], true);
    
    // Taş kontürünü ekle (offset'li, gerçek kavislerle)
    if (cell.path && cell.path.length > 0) {
      // Path'i vertexlere çevir ki bulge (42) kodunu da dışarı aktarabilelim
      const cavData = pathToCavalierPolyline(cell.path, true); // true = kapalı polyline varsayımı
      if (cavData && cavData.vertexes) {
         const pts = cavData.vertexes.map((v: number[]) => ({
            x: cell.x + v[0],
            y: cell.y + v[1],
            bulge: v[2] || 0
         }));
         writer.addPolyline(pts, true);
      }
    }
    
    // Numara veya handle yazısı
    writer.addText(`${i+1}`, cell.x - (hs*0.8), cell.y - (hs*0.8), 2.5);
  });
  
  return writer.generate();
}
