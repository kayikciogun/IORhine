import * as THREE from 'three';
import type { PickPlaceConfig, StoneType, PlacementOrder } from '@/types/pickplace';
import { calcAngleFromSceneObject } from '@/Utils/contourAngle';
import { calcPlacementCenterFromSceneObject } from '@/lib/contourPlacement';

/** DXF sahnesinden yerleştirme satırları üretir (CSV export için). */
export function buildPlacementOrders(
  scene: THREE.Scene | THREE.Group,
  stoneTypes: StoneType[],
  cfg: PickPlaceConfig,
): PlacementOrder[] {
  const handleIndex = new Map<string, THREE.Object3D>();
  scene.traverse((o: THREE.Object3D) => {
    const h = o.userData?.handle;
    if (h) handleIndex.set(h, o);
  });

  const orders: PlacementOrder[] = [];
  let index = 0;
  const pitch = cfg.cellSize;

  for (const st of stoneTypes) {
    for (const handle of st.contourIds) {
      const obj = handleIndex.get(handle);
      if (!obj) continue;

      const { x: placeX, y: placeY } = calcPlacementCenterFromSceneObject(obj);

      const col = index % cfg.rowLength;
      const row = Math.floor(index / cfg.rowLength);
      const pickX = cfg.stripOriginX + col * pitch + cfg.cellSize / 2;
      const pickY = cfg.stripOriginY + row * pitch + cfg.cellSize / 2;

      const placeAngle = calcAngleFromSceneObject(obj);

      orders.push({
        index,
        stoneTypeId: st.id,
        shapeId: handle,
        pickX,
        pickY,
        placeX,
        placeY,
        placeAngle,
      });
      index++;
    }
  }

  return orders;
}
