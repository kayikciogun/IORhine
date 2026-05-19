import type * as THREE from 'three';
import type { PickPlaceConfig, StoneType } from '@/types/pickplace';
import type { PlacementCsvRow } from '@/types/runtime';
import { buildPlacementOrders } from '@/operations/placementOrders';
import { placementOrdersToCsv } from '@/operations/csvExport';
import { ordersToRows } from '@/lib/placementCsv';
import { savePlacementSnapshot } from '@/lib/appSessionStore';

/** DXF sahnesinden CSV satırları üretir ve oturuma yazar (Production geçişi için). */
export function syncPlacementSnapshotFromScene(
  scene: THREE.Scene | THREE.Group | null,
  stoneTypes: StoneType[],
  cfg: PickPlaceConfig,
  fileName?: string,
): PlacementCsvRow[] {
  if (!scene) return [];
  const orders = buildPlacementOrders(scene, stoneTypes, cfg);
  const rows = ordersToRows(orders);
  if (!rows.length) return [];
  savePlacementSnapshot({
    rows,
    csv: placementOrdersToCsv(orders),
    fileName,
  });
  return rows;
}
