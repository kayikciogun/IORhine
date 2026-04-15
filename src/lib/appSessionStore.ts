/**
 * Tarayıcıda oturum kalıcılığı (sayfa yenilemesinde devam).
 * - Pick & Place: localStorage (JSON, küçük)
 * - DXF ham metin: IndexedDB (büyük dosyalar için)
 * - modelTransform: localStorage (küçük)
 */

import type { PickPlaceConfig, StoneType } from '@/types/pickplace';

/** DxfContext.ModelTransform ile aynı şekil (döngüsel import önlemek için burada) */
export type PersistedModelTransform = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fileName: string;
};

export const APP_SESSION_VERSION = 1 as const;

const LS_PICKPLACE = 'rhinecnc:v1:pickplace';
const LS_DXF_META = 'rhinecnc:v1:dxfMeta';

const IDB_NAME = 'rhinecnc-session';
const IDB_VERSION = 1;
const IDB_STORE = 'blobs';
const IDB_DXF_KEY = 'dxf-current';

/** Taş tipleri: name, color, contourIds (DXF atamaları ve renkleri burada). */
export type PickPlaceSnapshot = {
  v: typeof APP_SESSION_VERSION;
  stoneTypes: StoneType[];
  pickPlaceConfig: PickPlaceConfig;
  activeStoneTypeId: string | null;
};

export type DxfBlobRecord = {
  content: string;
  fileName: string;
  savedAt: number;
};

export type DxfMetaRecord = {
  modelTransform: PersistedModelTransform | null;
};

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
  });
}

export function loadPickPlaceSnapshot(): PickPlaceSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_PICKPLACE);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PickPlaceSnapshot>;
    if (data.v !== APP_SESSION_VERSION) return null;
    return data as PickPlaceSnapshot;
  } catch {
    return null;
  }
}

export function savePickPlaceSnapshot(snapshot: Omit<PickPlaceSnapshot, 'v'>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PickPlaceSnapshot = {
      v: APP_SESSION_VERSION,
      stoneTypes: snapshot.stoneTypes,
      pickPlaceConfig: snapshot.pickPlaceConfig,
      activeStoneTypeId: snapshot.activeStoneTypeId,
    };
    localStorage.setItem(LS_PICKPLACE, JSON.stringify(payload));
  } catch (e) {
    console.warn('[appSessionStore] pickplace save failed', e);
  }
}

export function loadDxfMeta(): DxfMetaRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_DXF_META);
    if (!raw) return null;
    return JSON.parse(raw) as DxfMetaRecord;
  } catch {
    return null;
  }
}

export function saveDxfMeta(meta: DxfMetaRecord): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_DXF_META, JSON.stringify(meta));
  } catch (e) {
    console.warn('[appSessionStore] dxf meta save failed', e);
  }
}

export async function saveDxfBlob(record: DxfBlobRecord): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.objectStore(IDB_STORE).put(record, IDB_DXF_KEY);
  });
  db.close();
}

export async function loadDxfBlob(): Promise<DxfBlobRecord | null> {
  try {
    const db = await openIdb();
    const row = await new Promise<DxfBlobRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
      const rq = tx.objectStore(IDB_STORE).get(IDB_DXF_KEY);
      rq.onsuccess = () => resolve(rq.result as DxfBlobRecord | undefined);
    });
    db.close();
    if (!row?.content || !row.fileName) return null;
    return row;
  } catch (e) {
    console.warn('[appSessionStore] dxf load failed', e);
    return null;
  }
}

export async function clearDxfBlob(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
      tx.objectStore(IDB_STORE).delete(IDB_DXF_KEY);
    });
    db.close();
  } catch (e) {
    console.warn('[appSessionStore] dxf clear failed', e);
  }
}

/** Pick & Place + DXF meta + IndexedDB DXF — tam temizlik */
export function clearAppSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LS_PICKPLACE);
    localStorage.removeItem(LS_DXF_META);
  } catch {
    /* ignore */
  }
  void clearDxfBlob();
}
