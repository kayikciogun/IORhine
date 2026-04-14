'use client'
import React, { createContext, useContext, useState } from "react";

interface ModelTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  fileName: string; // Hangi dosya için saklı olduğunu bilmek için
}

interface DxfContextType {
  selectedDxfFile: File | null;
  setSelectedDxfFile: (file: File | null) => void;
  parsedDxf: any;
  setParsedDxf: (parsed: any) => void;
  mainGroup: any;
  setMainGroup: (group: any) => void;
  modelTransform: ModelTransform | null;
  setModelTransform: (transform: ModelTransform | null) => void;
}

const DxfContext = createContext<DxfContextType | undefined>(undefined);

export const DxfProvider = ({ children }: { children: React.ReactNode }) => {
  const [selectedDxfFile, setSelectedDxfFile] = useState<File | null>(null);
  const [parsedDxf, setParsedDxf] = useState<any>(null);
  const [mainGroup, setMainGroup] = useState<any>(null);
  const [modelTransform, setModelTransform] = useState<ModelTransform | null>(null);
  
  return (
    <DxfContext.Provider value={{ 
      selectedDxfFile, 
      setSelectedDxfFile, 
      parsedDxf, 
      setParsedDxf, 
      mainGroup, 
      setMainGroup,
      modelTransform,
      setModelTransform
    }}>
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