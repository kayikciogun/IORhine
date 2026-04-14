'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import * as THREE from 'three';

import { debug } from '../../Utils/debug';
// Selection context types
interface SelectionContextType {
  selectedObjectsSet: Set<THREE.Object3D>;
  excludedObjectsSet: Set<THREE.Object3D>;
  updateSelection: (newSelection: Set<THREE.Object3D>) => void;
  clearSelection: () => void;
  excludeObject: (object: THREE.Object3D) => void;
  excludeObjects: (objects: Set<THREE.Object3D>) => void;
  unexcludeObject: (object: THREE.Object3D) => void;
  clearExclusions: () => void;
  restoreSelectionsByHandle: (scene: THREE.Scene) => void;
}

// Create context
const SelectionContext = createContext<SelectionContextType | undefined>(undefined);

// Provider component
export const SelectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedObjectsSet, setSelectedObjectsSet] = useState<Set<THREE.Object3D>>(new Set());
  const [excludedObjectsSet, setExcludedObjectsSet] = useState<Set<THREE.Object3D>>(new Set());
  
  // Handle tabanlı seçimleri sakla
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set());
  const [excludedHandles, setExcludedHandles] = useState<Set<string>>(new Set());

  const updateSelection = useCallback((newSelection: Set<THREE.Object3D>) => {
    setSelectedObjectsSet(new Set(newSelection));
    
    // Handle'ları da sakla, referansı taşı
    const handles = new Set<string>();
    newSelection.forEach(obj => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) handles.add(handle);
    });
    setSelectedHandles(handles);
    
    debug.log('[SelectionStore] Selection updated, count:', newSelection.size, 'handles:', handles.size);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedObjectsSet(prevSelected => {
      if (prevSelected.size > 0) {
        debug.log('[SelectionStore] Selection cleared.');
        setSelectedHandles(new Set());
        
        // Mesafe görselleştirmesini temizle
        if (typeof window !== 'undefined' && (window as any).clearDistanceVisualization) {
          (window as any).clearDistanceVisualization();
        }
        
        return new Set();
      }
      return prevSelected;
    });
  }, []);

  const excludeObject = useCallback((object: THREE.Object3D) => {
    setExcludedObjectsSet(prevExcluded => {
      if (!prevExcluded.has(object)) {
        const newSet = new Set(prevExcluded);
        newSet.add(object);
        
        const handle = object.userData?.handle || object.uuid;
        if (handle) {
          setExcludedHandles(prev => new Set(prev).add(handle));
        }
        
        debug.log(`[SelectionStore] Object excluded (Handle: ${handle}), total excluded: ${newSet.size}`);
        
        // Remove from selection if it was selected
        setSelectedObjectsSet(prevSelected => {
          if (prevSelected.has(object)) {
            const newSelectionSet = new Set(prevSelected);
            newSelectionSet.delete(object);
            
            // Handle'dan da kaldır
            if (handle) {
              setSelectedHandles(prev => {
                const newHandles = new Set(prev);
                newHandles.delete(handle);
                return newHandles;
              });
            }
            
            debug.log(`[SelectionStore] Excluded object also removed from selection.`);
            return newSelectionSet;
          }
          return prevSelected;
        });
        
        return newSet;
      }
      return prevExcluded;
    });
  }, []);

  const excludeObjects = useCallback((objects: Set<THREE.Object3D>) => {
    setExcludedObjectsSet(prevExcluded => {
      const newSet = new Set(prevExcluded);
      const newHandles = new Set<string>();
      let addedCount = 0;
      
      objects.forEach(object => {
        if (!prevExcluded.has(object)) {
          newSet.add(object);
          addedCount++;
          
          const handle = object.userData?.handle || object.uuid;
          if (handle) {
            newHandles.add(handle);
          }
        }
      });
      
      if (addedCount > 0) {
        setExcludedHandles(prev => {
          const updated = new Set(prev);
          newHandles.forEach(h => updated.add(h));
          return updated;
        });
        
        debug.log(`[SelectionStore] ${addedCount} objects excluded in batch, total excluded: ${newSet.size}`);
        
        // Remove excluded objects from selection
        setSelectedObjectsSet(prevSelected => {
          let modified = false;
          const newSelectionSet = new Set(prevSelected);
          const handlesToRemove = new Set<string>();
          
          objects.forEach(object => {
            if (prevSelected.has(object)) {
              newSelectionSet.delete(object);
              modified = true;
              
              const handle = object.userData?.handle || object.uuid;
              if (handle) {
                handlesToRemove.add(handle);
              }
            }
          });
          
          if (modified) {
            setSelectedHandles(prev => {
              const newHandles = new Set(prev);
              handlesToRemove.forEach(h => newHandles.delete(h));
              return newHandles;
            });
            
            debug.log(`[SelectionStore] ${handlesToRemove.size} excluded objects also removed from selection.`);
          }
          
          return modified ? newSelectionSet : prevSelected;
        });
        
        return newSet;
      }
      
      return prevExcluded;
    });
  }, []);

  const unexcludeObject = useCallback((object: THREE.Object3D) => {
    setExcludedObjectsSet(prevExcluded => {
      if (prevExcluded.has(object)) {
        const newSet = new Set(prevExcluded);
        newSet.delete(object);
        
        // Handle'ı da kaldır
        const handle = object.userData?.handle || object.uuid;
        if (handle) {
          setExcludedHandles(prev => {
            const newHandles = new Set(prev);
            newHandles.delete(handle);
            return newHandles;
          });
        }
        
        debug.log(`[SelectionStore] Object unexcluded (Handle: ${handle}), total excluded: ${newSet.size}`);
        return newSet;
      }
      return prevExcluded;
    });
  }, []);

  const clearExclusions = useCallback(() => {
    setExcludedObjectsSet(prevExcluded => {
      if (prevExcluded.size > 0) {
        debug.log('[SelectionStore] Clearing all exclusions:', {
          count: prevExcluded.size,
          handles: Array.from(prevExcluded).slice(0, 10).map(o => o.userData?.handle || o.uuid),
          types: Array.from(prevExcluded).slice(0, 10).map(o => o.userData?.type)
        });
        setExcludedHandles(new Set());
        return new Set();
      }
      debug.log('[SelectionStore] No exclusions to clear');
      return prevExcluded;
    });
  }, []);

  const restoreSelectionsByHandle = useCallback((scene: THREE.Scene) => {
    const newSelectedObjects = new Set<THREE.Object3D>();
    const newExcludedObjects = new Set<THREE.Object3D>();
    const foundHandles: string[] = [];
    const processedHandles = new Set<string>();
    
    debug.log('[SelectionStore] Starting restore with handles:', {
      selectedHandles: Array.from(selectedHandles),
      excludedHandles: Array.from(excludedHandles)
    });
    
    // Scene'deki tüm nesneleri tara - her handle için sadece ilk bulunan nesneyi seç
    scene.traverse((obj) => {
      const handle = obj.userData?.handle || obj.uuid;
      if (handle) {
        foundHandles.push(handle);
        
        // Aynı handle'a sahip birden fazla nesne varsa sadece ilkini seç
        if (selectedHandles.has(handle) && !processedHandles.has(handle)) {
          newSelectedObjects.add(obj);
          processedHandles.add(handle);
          debug.log('[SelectionStore] Found selected object (first occurrence):', { 
            handle, 
            type: obj.type, 
            userData: obj.userData,
            objectId: obj.id,
            uuid: obj.uuid,
            newSelectedSize: newSelectedObjects.size
          });
        }
        
        if (excludedHandles.has(handle) && !processedHandles.has(handle)) {
          newExcludedObjects.add(obj);
          processedHandles.add(handle);
          debug.log('[SelectionStore] Found excluded object (first occurrence):', { handle, type: obj.type });
        }
      }
    });
    
    // State'leri yeni Set referansları ile güncelle ki useViewerInteractions effect'leri tetiklensin
    setSelectedObjectsSet(new Set(newSelectedObjects));
    setExcludedObjectsSet(new Set(newExcludedObjects));
    setSelectedHandles(new Set(Array.from(newSelectedObjects).map(obj => obj.userData?.handle || obj.uuid).filter(Boolean) as string[]));
    setExcludedHandles(new Set(Array.from(newExcludedObjects).map(obj => obj.userData?.handle || obj.uuid).filter(Boolean) as string[]));
    
    debug.log('[SelectionStore] Selections restored by handle:', {
      selected: newSelectedObjects.size,
      excluded: newExcludedObjects.size,
      selectedHandles: selectedHandles.size,
      excludedHandles: excludedHandles.size,
      totalFoundHandles: foundHandles.length,
      sampleFoundHandles: foundHandles.slice(0, 5)
    });
  }, [selectedHandles, excludedHandles]);

  const value: SelectionContextType = useMemo(() => ({
    selectedObjectsSet,
    excludedObjectsSet,
    updateSelection,
    clearSelection,
    excludeObject,
    excludeObjects,
    unexcludeObject,
    clearExclusions,
    restoreSelectionsByHandle,
  }), [selectedObjectsSet, excludedObjectsSet, updateSelection, clearSelection, excludeObject, excludeObjects, unexcludeObject, clearExclusions, restoreSelectionsByHandle]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
};

// Hook to use selection context
export const useSelection = (): SelectionContextType => {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
};

// Export types
export type { SelectionContextType };
