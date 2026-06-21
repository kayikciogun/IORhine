'use client'
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import type * as THREE from 'three';
import { loadDxfBlob, saveDxfMeta, loadDxfMeta, clearDxfBlob } from '@/lib/appSessionStore';

interface ModelTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fileName: string;
}

interface DxfContextType {
  /** IndexedDB oturum kontrolü bitti (true) — sayfa ilk çizimde yanlış boş ekran göstermemek için */
  dxfSessionHydrated: boolean;
  selectedDxfFile: File | null;
  setSelectedDxfFile: (file: File | null) => void;
  // P3-E34: ``any`` → proper types. ``parsedDxf`` ezdxf parse çıktısı
  // (dynamic structure); ``DxfDocument`` tipi yok, ``unknown`` + cast daha güvenli.
  parsedDxf: unknown;
  setParsedDxf: (parsed: unknown) => void;
  mainGroup: THREE.Object3D | null;
  setMainGroup: (group: THREE.Object3D | null) => void;
  modelTransform: ModelTransform | null;
  setModelTransform: (transform: ModelTransform | null) => void;
  // Scene erişimi (window.dxfScene yerine)
  dxfScene: THREE.Scene | null;
  setDxfScene: (scene: THREE.Scene | null) => void;
  /** DXF'i ve IndexedDB oturumunu kaldır; taş ayarları (PickPlace) kalır. Yükleme ekranına döner. */
  clearDxfSession: () => void;
}

const DxfContext = createContext<DxfContextType | undefined>(undefined);

export const DxfProvider = ({ children }: { children: React.ReactNode }) => {
  const [dxfSessionHydrated, setDxfSessionHydrated] = useState(false);
  const [selectedDxfFile, setSelectedDxfFile] = useState<File | null>(null);
  const [parsedDxf, setParsedDxf] = useState<unknown>(null);
  const [mainGroup, setMainGroup] = useState<THREE.Object3D | null>(null);
  const [modelTransform, setModelTransform] = useState<ModelTransform | null>(null);
  const [dxfScene, setDxfScene] = useState<THREE.Scene | null>(null);

  useEffect(() => {
    const meta = loadDxfMeta();
    if (meta?.modelTransform) setModelTransform(meta.modelTransform);
  }, []);

  const clearDxfSession = useCallback(() => {
    setSelectedDxfFile(null);
    setParsedDxf(null);
    setMainGroup(null);
    setDxfScene(null);
    setModelTransform(null);
    try {
      saveDxfMeta({ modelTransform: null });
    } catch { /* ignore */ }
    void clearDxfBlob();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rec = await loadDxfBlob();
        if (!cancelled && rec?.content) {
          setSelectedDxfFile(prev => {
            if (prev != null) return prev;
            return new File([rec.content], rec.fileName, { type: 'application/octet-stream' });
          });
        }
      } catch (e) {
        console.warn('[DxfProvider] IndexedDB DXF yüklenemedi', e);
      } finally {
        if (!cancelled) setDxfSessionHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveDxfMeta({ modelTransform });
    }, 400);
    return () => window.clearTimeout(t);
  }, [modelTransform]);

  const value = useMemo(() => ({
    dxfSessionHydrated,
    selectedDxfFile,
    setSelectedDxfFile,
    parsedDxf,
    setParsedDxf,
    mainGroup,
    setMainGroup,
    modelTransform,
    setModelTransform,
    dxfScene,
    setDxfScene,
    clearDxfSession,
  }), [dxfSessionHydrated, selectedDxfFile, parsedDxf, mainGroup, modelTransform, dxfScene, clearDxfSession]);

  return (
    <DxfContext.Provider value={value}>
      {children}
    </DxfContext.Provider>
  );
};

export const useDxf = () => {
  const context = useContext(DxfContext);
  if (!context) {
    throw new Error("useDxf must be used within a DxfProvider");
  }
  return context;
};

export type { ModelTransform };