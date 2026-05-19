'use client';

import React, {
  createContext, useContext, useState, useEffect, useRef,
  useCallback, useMemo, ReactNode,
} from 'react';
import type { StoneType, PickPlaceConfig } from '../types/pickplace';
import { loadPickPlaceSnapshot, savePickPlaceSnapshot } from '@/lib/appSessionStore';

interface PickPlaceContextType {
  stoneTypes: StoneType[];
  activeStoneTypeId: string | null;
  pickPlaceConfig: PickPlaceConfig;
  addStoneType: (stoneType: StoneType) => void;
  updateStoneType: (id: string, updates: Partial<StoneType>) => void;
  removeStoneType: (id: string) => void;
  setActiveStoneTypeId: (id: string | null) => void;
  updatePickPlaceConfig: (updates: Partial<PickPlaceConfig>) => void;
  assignContoursToType: (stoneTypeId: string, contourIds: string[]) => void;
  unassignContours: (contourIds: string[]) => void;
  reorderStoneTypes: (startIndex: number, endIndex: number) => void;
}

const defaultPickPlaceConfig: PickPlaceConfig = {
  stripOriginX: -100.0,
  stripOriginY: -100.0,
  cellSize: 20,
  rowLength: 100,
  cellGap: 0,
};

function toFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v.trim().replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function sanitizePickPlaceConfig(input: PickPlaceConfig): PickPlaceConfig {
  const d = defaultPickPlaceConfig;
  const o: PickPlaceConfig = { ...input };
  const oMut = o as unknown as Record<string, unknown>;
  (Object.keys(d) as (keyof PickPlaceConfig)[]).forEach((key) => {
    const defVal = d[key];
    const cur = o[key];
    if (typeof defVal === 'number') {
      oMut[key as string] = toFiniteNumber(cur, defVal);
    }
  });
  return o;
}

function sanitizeStoneType(st: StoneType): StoneType {
  return {
    ...st,
    id: typeof st.id === 'string' ? st.id : `stone_${Date.now()}`,
    name: typeof st.name === 'string' ? st.name : 'Taş',
    color: typeof st.color === 'string' ? st.color : '#888888',
    contourIds: Array.isArray(st.contourIds)
      ? st.contourIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

const PickPlaceContext = createContext<PickPlaceContextType | undefined>(undefined);

export const PickPlaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stoneTypes, setStoneTypes] = useState<StoneType[]>([]);
  const [activeStoneTypeId, setActiveStoneTypeId] = useState<string | null>(null);
  const [pickPlaceConfig, setPickPlaceConfig] = useState<PickPlaceConfig>(defaultPickPlaceConfig);
  const pickPlaceStorageReadyRef = useRef(false);

  useEffect(() => {
    const snap = loadPickPlaceSnapshot();
    if (snap) {
      setStoneTypes(
        Array.isArray(snap.stoneTypes)
          ? snap.stoneTypes.map(sanitizeStoneType)
          : [],
      );
      setActiveStoneTypeId(snap.activeStoneTypeId ?? null);
      const raw = snap.pickPlaceConfig as Partial<PickPlaceConfig>;
      const merged: PickPlaceConfig = { ...defaultPickPlaceConfig, ...raw };
      setPickPlaceConfig(sanitizePickPlaceConfig(merged));
    }
    pickPlaceStorageReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!pickPlaceStorageReadyRef.current) return;
    const t = window.setTimeout(() => {
      savePickPlaceSnapshot({ stoneTypes, pickPlaceConfig, activeStoneTypeId });
    }, 450);
    return () => window.clearTimeout(t);
  }, [stoneTypes, pickPlaceConfig, activeStoneTypeId]);

  const addStoneType = useCallback((stoneType: StoneType) => {
    setStoneTypes(prev => [...prev, stoneType]);
  }, []);

  const updateStoneType = useCallback((id: string, updates: Partial<StoneType>) => {
    setStoneTypes(prev => prev.map(st => st.id === id ? { ...st, ...updates } : st));
  }, []);

  const removeStoneType = useCallback((id: string) => {
    setStoneTypes(prev => prev.filter(st => st.id !== id));
    setActiveStoneTypeId(prev => (prev === id ? null : prev));
  }, []);

  const updatePickPlaceConfig = useCallback((updates: Partial<PickPlaceConfig>) => {
    setPickPlaceConfig(prev => sanitizePickPlaceConfig({ ...prev, ...updates }));
  }, []);

  const assignContoursToType = useCallback((stoneTypeId: string, contourIds: string[]) => {
    setStoneTypes(prev => prev.map(st => {
      if (st.id === stoneTypeId) {
        const newContours = [...new Set([...st.contourIds, ...contourIds])];
        return { ...st, contourIds: newContours };
      }
      return { ...st, contourIds: st.contourIds.filter(id => !contourIds.includes(id)) };
    }));
  }, []);

  const unassignContours = useCallback((contourIds: string[]) => {
    setStoneTypes(prev => prev.map(st => ({
      ...st,
      contourIds: st.contourIds.filter(id => !contourIds.includes(id))
    })));
  }, []);

  const reorderStoneTypes = useCallback((startIndex: number, endIndex: number) => {
    setStoneTypes(prev => {
      const result = Array.from(prev);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return result;
    });
  }, []);

  const value = useMemo<PickPlaceContextType>(() => ({
    stoneTypes,
    activeStoneTypeId,
    pickPlaceConfig,
    addStoneType,
    updateStoneType,
    removeStoneType,
    setActiveStoneTypeId,
    updatePickPlaceConfig,
    assignContoursToType,
    unassignContours,
    reorderStoneTypes,
  }), [
    stoneTypes,
    activeStoneTypeId,
    pickPlaceConfig,
    addStoneType,
    updateStoneType,
    removeStoneType,
    updatePickPlaceConfig,
    assignContoursToType,
    unassignContours,
    reorderStoneTypes,
  ]);

  return (
    <PickPlaceContext.Provider value={value}>
      {children}
    </PickPlaceContext.Provider>
  );
};

export const usePickPlace = () => {
  const context = useContext(PickPlaceContext);
  if (context === undefined) {
    throw new Error('usePickPlace must be used within a PickPlaceProvider');
  }
  return context;
};
