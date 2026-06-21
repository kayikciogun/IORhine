import type { PlacementCsvRow } from '@/types/runtime';
import type { PlacementOrder } from '@/types/pickplace';

const HEADER = 'id,target_x,target_y,target_angle,shape_id,thickness';

export function ordersToRows(orders: PlacementOrder[]): PlacementCsvRow[] {
  return orders.map((o) => ({
    id: o.index,
    target_x: o.placeX,
    target_y: o.placeY,
    target_angle: o.placeAngle,
    shape_id: o.shapeId,
    thickness: o.thickness,
  }));
}

// P3-D27: ``parsePlacementCsv`` kaldırıldı — dead code (zero call sites).
// Backend (``io-cam-runtime/app/runtime/csv_loader.py``) CSV parse'ı yapar;
// frontend sadece export (``rowsToCsv``) kullanır.

export function rowsToCsv(rows: PlacementCsvRow[]): string {
  const lines = [HEADER];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.target_x,
        r.target_y,
        r.target_angle,
        r.shape_id,
        r.thickness,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

/** RFC 4180 uyumlu CSV alan kaçışı.
 *  Virgül, çift tırnak veya satır sonu içeren alanları çift tırnak içine alır;
 *  alan içindeki çift tırnakları ``""`` olarak çiftler. Sayılar normalde
 *  virgül içermez ama ``NaN``/``Infinity`` gibi durumlar için de güvenli bir
 *  ``String(x)`` uygularız. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  // NaN/Infinity → boş string (CSV'de anlamsız olur)
  if (s === 'NaN' || s === 'Infinity' || s === '-Infinity') return '';
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
