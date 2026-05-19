import type { PlacementOrder } from '@/types/pickplace';

const CSV_HEADER = 'id,target_x,target_y,target_angle,shape_id';

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function fmtNum(n: number): string {
  const x = Number(n);
  return Number.isFinite(x) ? String(x) : '0';
}

/** Yerleştirme satırlarını CSV metnine dönüştürür. */
export function placementOrdersToCsv(orders: PlacementOrder[]): string {
  const lines = [CSV_HEADER];
  for (const o of orders) {
    lines.push(
      [
        String(o.index),
        fmtNum(o.placeX),
        fmtNum(o.placeY),
        fmtNum(o.placeAngle),
        escapeCsvField(o.shapeId),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** CSV dosyasını indirir. */
export function downloadPlacementCsv(csv: string, fileName?: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName ?? `placement_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
