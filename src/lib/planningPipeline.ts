/**
 * Planlama → Production tek geçiş: yapışkan şablon + CSV + runtime senkronu.
 */

import type * as THREE from 'three';
import type { PickPlaceConfig, StoneType } from '@/types/pickplace';
import { generateStripData } from '@/operations/stripGenerator';
import { buildPlacementOrders } from '@/operations/placementOrders';
import { placementOrdersToCsv } from '@/operations/csvExport';
import { ordersToRows } from '@/lib/placementCsv';
import { savePlacementSnapshot } from '@/lib/appSessionStore';
import {
  loadGlueStripSnapshot,
  saveGlueStripSnapshot,
  syncGlueStripToRuntime,
  type GlueStripSnapshot,
} from '@/lib/glueStripSync';

export type PipelineStepId =
  | 'dxf'
  | 'stones'
  | 'glue_preview'
  | 'csv'
  | 'send';

export type PipelineStep = {
  id: PipelineStepId;
  label: string;
  done: boolean;
  hint?: string;
};

export type PlanningBundle = {
  v: 1;
  fileName?: string;
  stoneCount: number;
  glueCellCount: number;
  glueCols: number;
  glueRows: number;
  csvRowCount: number;
  sentAt: number;
};

const LS_BUNDLE = 'rhinecnc:v1:planningBundle';

export function countAssignedStones(stoneTypes: StoneType[]): number {
  return stoneTypes.reduce((a, s) => a + s.contourIds.length, 0);
}

export function getPipelineSteps(
  hasDxf: boolean,
  stoneCount: number,
  gluePreviewDone: boolean,
  csvPreviewDone: boolean,
): PipelineStep[] {
  return [
    {
      id: 'dxf',
      label: 'DXF çizim yüklendi',
      done: hasDxf,
      hint: hasDxf ? undefined : 'Sol panelden .dxf seçin',
    },
    {
      id: 'stones',
      label: 'Taş tipi oluşturuldu ve kontur atandı',
      done: stoneCount > 0,
      hint: stoneCount > 0 ? `${stoneCount} kontur` : 'Taş tipi ekleyip DXF’ten atayın',
    },
    {
      id: 'glue_preview',
      label: 'Yapışkan şablonu üretildi ve önizlendi',
      done: gluePreviewDone,
      hint: gluePreviewDone ? undefined : 'Glue Levha → Üret',
    },
    {
      id: 'csv',
      label: 'Yerleştirme CSV hazır',
      done: csvPreviewDone,
      hint: csvPreviewDone ? undefined : 'Dışa aktar → Önizle (veya doğrudan gönder)',
    },
    {
      id: 'send',
      label: 'Makineye gönder → Production',
      done: false,
      hint: 'Son adım',
    },
  ];
}

export function savePlanningBundle(bundle: Omit<PlanningBundle, 'v'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PlanningBundle = { v: 1, ...bundle };
    localStorage.setItem(LS_BUNDLE, JSON.stringify(payload));
  } catch (e) {
    console.warn('[planningPipeline] bundle save failed', e);
  }
}

export function loadPlanningBundle(): PlanningBundle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_BUNDLE);
    if (!raw) return null;
    const data = JSON.parse(raw) as PlanningBundle;
    if (data.v !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export type SendToMachineInput = {
  scene: THREE.Scene | THREE.Group;
  stoneTypes: StoneType[];
  config: PickPlaceConfig;
  fileName?: string;
  /** Glue Levha’da Üret’e basıldıysa true; yoksa gönderimde otomatik üretilir */
  requireGluePreview?: boolean;
  gluePreviewDone?: boolean;
};

export type SendToMachineResult = {
  ok: true;
  bundle: PlanningBundle;
  glueSnap: GlueStripSnapshot;
  csvRowCount: number;
} | {
  ok: false;
  message: string;
};

export async function sendPlanningToMachine(
  input: SendToMachineInput,
): Promise<SendToMachineResult> {
  const stoneCount = countAssignedStones(input.stoneTypes);
  if (stoneCount === 0) {
    return { ok: false, message: 'Hiç kontur atanmamış. Taş tipi oluşturup DXF’ten atayın.' };
  }

  if (input.requireGluePreview && !input.gluePreviewDone) {
    return {
      ok: false,
      message: 'Önce Glue Levha bölümünde «Üret» ile şablonu önizleyin.',
    };
  }

  const cells = generateStripData(input.scene, input.stoneTypes, input.config);
  if (cells.length === 0) {
    return { ok: false, message: 'Yapışkan şablonu üretilemedi (kontur bulunamadı).' };
  }

  saveGlueStripSnapshot(cells, input.config);
  // saveGlueStripSnapshot SVG+cols+rows dahil her şeyi yazar; oradan oku
  const glueSnap = loadGlueStripSnapshot()!;
  const cols = glueSnap.cols;
  const gridRows = glueSnap.rows;

  const orders = buildPlacementOrders(input.scene, input.stoneTypes, input.config);
  const rows = ordersToRows(orders);
  if (!rows.length) {
    return { ok: false, message: 'Yerleştirme CSV oluşturulamadı.' };
  }

  savePlacementSnapshot({
    rows,
    csv: placementOrdersToCsv(orders),
    fileName: input.fileName,
  });

  try {
    await syncGlueStripToRuntime(glueSnap);
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Runtime’a yapışkan levha gönderilemedi.',
    };
  }

  const bundle: PlanningBundle = {
    v: 1,
    fileName: input.fileName,
    stoneCount,
    glueCellCount: cells.length,
    glueCols: cols,
    glueRows: gridRows,
    csvRowCount: rows.length,
    sentAt: Date.now(),
  };
  savePlanningBundle(bundle);

  return { ok: true, bundle, glueSnap, csvRowCount: rows.length };
}
