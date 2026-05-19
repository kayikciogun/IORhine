/**
 * Planlama ekranındaki yapışkan levha şablonunu runtime'a aktarır.
 */

import type { PickPlaceConfig } from '@/types/pickplace';
import type { StripCell } from '@/operations/stripGenerator';
import { getDefaultRuntimeClientConfig } from '@/lib/runtimeClient';

/** SVG path verisi — production önizlemesi için */
export type GlueCellPreview = {
  targetAngle: number;
  /** SVG <path d="…"> string — hücre merkezine göre normalleştirilmiş */
  svgD: string;
  color: string;
  cellSize: number;
};

export type GlueStripSnapshot = {
  v: 3;
  cells: GlueCellPreview[];
  config: PickPlaceConfig;
  cols: number;
  rows: number;
  savedAt: number;
};

const LS_GLUE_STRIP = 'rhinecnc:v1:glueStrip';

export function glueStripGridDims(
  cellCount: number,
  rowLength: number,
): { cols: number; rows: number } {
  if (cellCount <= 0) return { cols: 1, rows: 1 };
  // rowLength = satır başına max sütun; taş sayısından fazla olamaz
  const cols = Math.min(Math.max(1, rowLength), cellCount);
  const rows = Math.max(1, Math.ceil(cellCount / cols));
  return { cols, rows };
}

function cellToSvgD(cell: StripCell): string {
  const { path, polylinePoints, isClosed } = cell;
  if (polylinePoints && polylinePoints.length >= 2) {
    const pts = polylinePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${(-p.y).toFixed(2)}`)
      .join(' ');
    return isClosed ? pts + ' Z' : pts;
  }
  if (!path || path.length === 0) return '';
  let d = '';
  path.forEach((seg, i) => {
    if (i === 0) d += `M ${seg.start.x.toFixed(2)} ${(-seg.start.y).toFixed(2)} `;
    if (seg.type === 'Line') {
      d += `L ${seg.end.x.toFixed(2)} ${(-seg.end.y).toFixed(2)} `;
    } else {
      const arc = seg as import('@/Utils/offsetUtils').ArcSegment;
      let diff = arc.endAngle - arc.startAngle;
      if (!arc.clockwise && diff < 0) diff += 2 * Math.PI;
      if (arc.clockwise && diff > 0) diff -= 2 * Math.PI;
      const large = Math.abs(diff) > Math.PI ? 1 : 0;
      const sweep = arc.clockwise ? 1 : 0;
      d += `A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 ${large} ${sweep} ${arc.end.x.toFixed(2)} ${(-arc.end.y).toFixed(2)} `;
    }
  });
  return isClosed ? d + 'Z' : d;
}

export function saveGlueStripSnapshot(cells: StripCell[], config: PickPlaceConfig): void {
  if (typeof window === 'undefined' || cells.length === 0) return;
  const { cols, rows } = glueStripGridDims(cells.length, config.rowLength);
  const payload: GlueStripSnapshot = {
    v: 3,
    cells: cells.map((c) => ({
      targetAngle: c.targetAngle,
      svgD: cellToSvgD(c),
      color: c.color,
      cellSize: config.cellSize,
    })),
    config: { ...config },
    cols,
    rows,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(LS_GLUE_STRIP, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('rhine:glue-strip-updated'));
  } catch (e) {
    console.warn('[glueStripSync] save failed', e);
  }
}

export function loadGlueStripSnapshot(): GlueStripSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_GLUE_STRIP);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<GlueStripSnapshot> & { v?: number };
    if (!data.cells?.length || !data.config) return null;
    const { cols, rows } = data.cols && data.rows
      ? { cols: data.cols, rows: data.rows }
      : glueStripGridDims(data.cells.length, data.config.rowLength);
    // Eski format (v1/v2) → svgD olmayan hücreler için boş string
    const cells: GlueCellPreview[] = data.cells.map((c) => ({
      targetAngle: (c as GlueCellPreview).targetAngle ?? 0,
      svgD: (c as GlueCellPreview).svgD ?? '',
      color: (c as GlueCellPreview).color ?? '#f59e0b',
      cellSize: (c as GlueCellPreview).cellSize ?? data.config!.cellSize,
    }));
    return { v: 3, cells, config: data.config, cols, rows, savedAt: data.savedAt ?? Date.now() };
  } catch {
    return null;
  }
}

export async function syncGlueStripToRuntime(
  snap: GlueStripSnapshot,
  z = 0.5,
): Promise<void> {
  const cols = snap.cols;
  const rows = snap.rows;
  const base = getDefaultRuntimeClientConfig().restBaseUrl;
  const res = await fetch(`${base}/api/glue_sheet/from_planning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin_x: snap.config.stripOriginX,
      origin_y: snap.config.stripOriginY,
      z,
      cell_size: snap.config.cellSize,
      cols,
      rows,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: string }).detail;
    throw new Error(detail ?? `Yapışkan levha gönderilemedi (${res.status})`);
  }
}
