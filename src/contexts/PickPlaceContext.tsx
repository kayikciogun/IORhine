'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { StoneType, PickPlaceConfig, StripConfig } from '../types/pickplace';

interface PickPlaceContextType {
  stoneTypes: StoneType[];
  activeStoneTypeId: string | null;
  pickPlaceConfig: PickPlaceConfig;
  stripConfig: StripConfig;
  addStoneType: (stoneType: StoneType) => void;
  updateStoneType: (id: string, updates: Partial<StoneType>) => void;
  removeStoneType: (id: string) => void;
  setActiveStoneTypeId: (id: string | null) => void;
  updatePickPlaceConfig: (updates: Partial<PickPlaceConfig>) => void;
  updateStripConfig: (updates: Partial<StripConfig>) => void;
  assignContoursToType: (stoneTypeId: string, contourIds: string[]) => void;
  unassignContours: (contourIds: string[]) => void;
  reorderStoneTypes: (startIndex: number, endIndex: number) => void;
}

const defaultPickPlaceConfig: PickPlaceConfig = {
  stripOriginX: 28.0,
  stripOriginY: 13.0,
  rowLength: 10,
  cellSize: 20,
  safeZ: 10,
  rapidFeed: 1000,
  pickFeed: 300,
  placeFeed: 200,
  rotationAxis: 'E',
  rotationFeed: 500,
  stripAngle: 0,
  vacuumOnDwell: 1,
  vacuumOffDwell: 0.5,
  vacuumOnCode: 'M106 S255',
  vacuumOffCode: 'M107',
  probeEnabled: true,
  probeMode: 'startup',
  probePeriod: 50,
  probeOffsetX: -30.0,
  probeOffsetY: 0.0,
  probeNozzleOffsetZ: 0.0,
  stripProbeX: 0,
  stripProbeY: 0,
  fabricProbeX: 50,
  fabricProbeY: 50,
  probeFeed: 100,
  probeRetract: 5,
};

const defaultStripConfig: StripConfig = {
  cellSize: 20,
  cellGap: 0,
  contourOffset: 0.5,
  rowLength: 10,
};

const PickPlaceContext = createContext<PickPlaceContextType | undefined>(undefined);

export const PickPlaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stoneTypes, setStoneTypes] = useState<StoneType[]>([]);
  const [activeStoneTypeId, setActiveStoneTypeId] = useState<string | null>(null);
  const [pickPlaceConfig, setPickPlaceConfig] = useState<PickPlaceConfig>(defaultPickPlaceConfig);
  const [stripConfig, setStripConfig] = useState<StripConfig>(defaultStripConfig);

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
  
  const updateStripConfig = (updates: Partial<StripConfig>) => {
    setStripConfig(prev => ({ ...prev, ...updates }));
  };
  
  const assignContoursToType = (stoneTypeId: string, contourIds: string[]) => {
    setStoneTypes(prev => prev.map(st => {
      if (st.id === stoneTypeId) {
        // Add new unique contours
        const newContours = [...new Set([...st.contourIds, ...contourIds])];
        return { ...st, contourIds: newContours };
      }
      // Remove from other types if they had it
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
      stripConfig,
      addStoneType,
      updateStoneType,
      removeStoneType,
      setActiveStoneTypeId,
      updatePickPlaceConfig,
      updateStripConfig,
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
