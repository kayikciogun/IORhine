import type { PlacementCsvRow } from '@/types/runtime';
import type { PlacementOrder } from '@/types/pickplace';

const HEADER = 'id,target_x,target_y,target_angle,shape_id';

export function ordersToRows(orders: PlacementOrder[]): PlacementCsvRow[] {
  return orders.map((o) => ({
    id: o.index,
    target_x: o.placeX,
    target_y: o.placeY,
    target_angle: o.placeAngle,
    shape_id: o.shapeId,
  }));
}

export function parsePlacementCsv(text: string): PlacementCsvRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);

  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return {
      id: Number(cols[idx('id')] ?? 0),
      target_x: Number(cols[idx('target_x')] ?? 0),
      target_y: Number(cols[idx('target_y')] ?? 0),
      target_angle: Number(cols[idx('target_angle')] ?? 0),
      shape_id: String(cols[idx('shape_id')] ?? '').trim(),
    };
  });
}

export function rowsToCsv(rows: PlacementCsvRow[]): string {
  const lines = [HEADER];
  for (const r of rows) {
    lines.push(
      [r.id, r.target_x, r.target_y, r.target_angle, r.shape_id].join(','),
    );
  }
  return lines.join('\n');
}
