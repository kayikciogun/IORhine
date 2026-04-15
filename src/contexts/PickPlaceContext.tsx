'use client';

import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
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
  // İlk hücre merkezi ≈ 50,50 (cellSize/2 = 10 → origin 40,40)
  stripOriginX: -100.0,
  stripOriginY: -100.0,
  cellSize: 10,
  rowLength: 2,
  cellGap: 0,
  contourOffset: 0.5,
  defaultStonePickZMm: 5,
  defaultStonePlaceZMm: 5,
  safeZ: 10,
  rapidFeed: 10000,
  jogFeed: 30000,
  pickFeed: 3000,
  placeFeed: 2000,
  rotationAxis: 'E',
  rotationFeed: 5000,
  stripAngle: 0,
  vacuumOnDwell: 1,
  vacuumOffDwell: 0.5,
  vacuumOnCode: 'M106 S255',
  vacuumOffCode: 'M107',
  firmware: 'marlin', // Ender 3 (Marlin) için
  marlinWorkspaceOriginX: 107.5,
  marlinWorkspaceOriginY: 107.5,
  marlinDxfAtG92X: 0,
  marlinDxfAtG92Y: 0,
  marlinStripZMm: 0,
  marlinFabricZMm: 0,
};

const PickPlaceContext = createContext<PickPlaceContextType | undefined>(undefined);

export const PickPlaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  /** SSR ve ilk client çizimi aynı olmalı; localStorage sadece mount sonrası okunur (hydration hatası önlenir). */
  const [stoneTypes, setStoneTypes] = useState<StoneType[]>([]);
  const [activeStoneTypeId, setActiveStoneTypeId] = useState<string | null>(null);
  const [pickPlaceConfig, setPickPlaceConfig] = useState<PickPlaceConfig>(defaultPickPlaceConfig);
  const pickPlaceStorageReadyRef = useRef(false);

  useEffect(() => {
    const snap = loadPickPlaceSnapshot();
    if (snap) {
      setStoneTypes(Array.isArray(snap.stoneTypes) ? snap.stoneTypes : []);
      setActiveStoneTypeId(snap.activeStoneTypeId ?? null);
      // localStorage’taki JSON tam PickPlaceConfig olmayabilir; `in` ile daraltma never üretmesin diye Partial
      const raw = snap.pickPlaceConfig as Partial<PickPlaceConfig>;
      const merged: PickPlaceConfig = { ...defaultPickPlaceConfig, ...raw };
      if (!('marlinDxfAtG92X' in raw) || typeof raw.marlinDxfAtG92X !== 'number') {
        merged.marlinDxfAtG92X =
          raw.marlinWorkspaceOriginX ?? defaultPickPlaceConfig.marlinWorkspaceOriginX;
        merged.marlinDxfAtG92Y =
          raw.marlinWorkspaceOriginY ?? defaultPickPlaceConfig.marlinWorkspaceOriginY;
      }
      setPickPlaceConfig(merged);
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

  const addStoneType = (stoneType: StoneType) => setStoneTypes(prev => [...prev, stoneType]);

  const updateStoneType = (id: string, updates: Partial<StoneType>) => {
    setStoneTypes(prev => prev.map(st => st.id === id ? { ...st, ...updates } : st));
  };

  const removeStoneType = (id: string) => {
    setStoneTypes(prev => prev.filter(st => st.id !== id));
    if (activeStoneTypeId === id) setActiveStoneTypeId(null);
  };

  const updatePickPlaceConfig = (updates: Partial<PickPlaceConfig>) => {
    setPickPlaceConfig(prev => ({ ...prev, ...updates }));
  };

  const assignContoursToType = (stoneTypeId: string, contourIds: string[]) => {
    setStoneTypes(prev => prev.map(st => {
      if (st.id === stoneTypeId) {
        const newContours = [...new Set([...st.contourIds, ...contourIds])];
        return { ...st, contourIds: newContours };
      }
      return { ...st, contourIds: st.contourIds.filter(id => !contourIds.includes(id)) };
    }));
  };

  const unassignContours = (contourIds: string[]) => {
    setStoneTypes(prev => prev.map(st => ({
      ...st,
      contourIds: st.contourIds.filter(id => !contourIds.includes(id))
    })));
  };

  const reorderStoneTypes = (startIndex: number, endIndex: number) => {
    setStoneTypes(prev => {
      const result = Array.from(prev);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return result;
    });
  };

  return (
    <PickPlaceContext.Provider value={{
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
      reorderStoneTypes
    }}>
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
