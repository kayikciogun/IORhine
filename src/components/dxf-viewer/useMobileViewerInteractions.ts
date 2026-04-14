import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useSelection } from './useSelection';
import type { SelectionInfo, SelectedEntityInfo } from '../../types/selection';

import { debug } from '../../Utils/debug';
import { applyVertexPickMeshAppearance } from './vertexEndpointVisual';

interface MobileViewerInteractionsConfig {
  viewerContainer: HTMLDivElement | null;
  renderer: THREE.WebGLRenderer | null;
  camera: THREE.PerspectiveCamera | null;
  scene: THREE.Scene | null;
  mainGroup: THREE.Group | null;
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null;
  onSelectionChange?: (info: SelectionInfo) => void;
}

interface TouchState {
  isTouching: boolean;
  touchCount: number;
  lastTouchTime: number;
  lastTapPosition: { x: number; y: number };
  tapThreshold: number;
  longPressThreshold: number;
  longPressTimer: NodeJS.Timeout | null;
  isLongPress: boolean;
  touchStartTime: number;
  touchStartPosition: { x: number; y: number };
  isPanning: boolean;
  isSelecting: boolean;
  lastPinchDistance: number;
  pinchCenter: { x: number; y: number };
  panVelocity: { x: number; y: number };
  lastPanTime: number;
  momentum: boolean;
  momentumDecay: number;
}

export function useMobileViewerInteractions(config: MobileViewerInteractionsConfig) {
  const { selectedObjectsSet, excludedObjectsSet, updateSelection, clearSelection, excludeObject, unexcludeObject, clearExclusions } = useSelection();

  // Debug flag
  const DEBUG_MOBILE = typeof window !== 'undefined' && localStorage.getItem('DEBUG_MOBILE_VIEWER') === '1';

  // State
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo>({ count: 0 });
  const [hoveredObject, setHoveredObject] = useState<THREE.Object3D | null>(null);
  const [isExclusionMode, setIsExclusionMode] = useState(false);
  const originalMaterials = useRef(new WeakMap<THREE.Object3D, LineMaterial | THREE.Material>());
  
  // Touch state
  const [touchState, setTouchState] = useState<TouchState>({
    isTouching: false,
    touchCount: 0,
    lastTouchTime: 0,
    lastTapPosition: { x: 0, y: 0 },
    tapThreshold: 20, // Mobilde daha geniş dokunma alanı
    longPressThreshold: 600, // ms
    longPressTimer: null,
    isLongPress: false,
    touchStartTime: 0,
    touchStartPosition: { x: 0, y: 0 },
    isPanning: false,
    isSelecting: false,
    lastPinchDistance: 0,
    pinchCenter: { x: 0, y: 0 },
    panVelocity: { x: 0, y: 0 },
    lastPanTime: 0,
    momentum: false,
    momentumDecay: 0.95
  });

  // Double tap state
  const lastTapTime = useRef(0);
  const lastTappedObject = useRef<THREE.Object3D | null>(null);
  const doubleTapDelay = 350; // Mobilde biraz daha uzun süre

  // Materials - mobil için optimize edilmiş
  const materials = useMemo(() => {
    const defaultMaterial = new LineMaterial({ 
      color: 0xFFFFFF, 
      linewidth: 4, // Mobilde daha kalın çizgiler
      vertexColors: false, 
      worldUnits: false, 
      depthTest: true, 
      depthWrite: true 
    });
    const hoverMaterial = new LineMaterial({ 
      color: 0x00FF00, 
      linewidth: 6, // Hover için daha kalın
      vertexColors: false, 
      worldUnits: false, 
      depthTest: true, 
      depthWrite: true 
    });
    const selectionMaterial = new LineMaterial({ 
      color: 0x008000, 
      linewidth: 6, // Seçim için daha kalın
      vertexColors: false, 
      worldUnits: false, 
      depthTest: true, 
      depthWrite: true 
    });
    const excludedMaterial = new LineMaterial({ 
      color: 0xFF0000, 
      linewidth: 6, // Dışlama için daha kalın
      vertexColors: false, 
      worldUnits: false, 
      depthTest: true, 
      depthWrite: true 
    });
    
    // Mesh için materyaller (3D objeler için)
    const meshHoverMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x00FF00, 
      emissive: 0x004400,
      emissiveIntensity: 0.5,
      metalness: 0.3, 
      roughness: 0.7 
    });
    const meshSelectionMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x008000, 
      emissive: 0x003300,
      emissiveIntensity: 0.6,
      metalness: 0.3, 
      roughness: 0.7 
    });
    const meshExcludedMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFF0000, 
      emissive: 0x440000,
      emissiveIntensity: 0.5,
      metalness: 0.3, 
      roughness: 0.7 
    });
    
    return { defaultMaterial, hoverMaterial, selectionMaterial, excludedMaterial,
             meshHoverMaterial, meshSelectionMaterial, meshExcludedMaterial };
  }, []);

  // Update material resolution
  useEffect(() => {
    if (config.renderer) {
      const { width, height } = config.renderer.domElement;
      // Only update resolution for LineMaterial instances
      Object.values(materials).forEach(mat => {
        if (mat instanceof LineMaterial && mat.resolution) {
          mat.resolution.set(width, height);
        }
      });
    }
  }, [config.renderer, materials]);

  // Raycasting utilities
  const raycaster = useRef(new THREE.Raycaster());
  const touchCoords = useRef(new THREE.Vector2());

  // Update touch coordinates
  const updateTouchCoordinates = useCallback((touch: Touch) => {
    if (!config.viewerContainer) return;
    
    const rect = config.viewerContainer.getBoundingClientRect();
    touchCoords.current.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    touchCoords.current.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
  }, [config.viewerContainer]);

  // Get intersected objects with mobile optimization
  const getIntersectedObjects = useCallback(() => {
    if (!config.scene || !config.camera) return [] as THREE.Intersection[];
    
    raycaster.current.setFromCamera(touchCoords.current, config.camera);
    
    // Mobil için daha geniş raycaster threshold
    raycaster.current.params.Line.threshold = 0.5; // Daha geniş seçim alanı
    raycaster.current.params.Points.threshold = 0.5;

    // Görünmez uç pick mesh’leri önce (Line2’den önce)
    if (config.mainGroup) {
      const endpointTargets: THREE.Mesh[] = [];
      config.mainGroup.traverse((ch) => {
        if (ch instanceof THREE.Mesh && ch.userData?.isVertexEndpointPick && ch.visible) {
          endpointTargets.push(ch);
        }
      });
      if (endpointTargets.length > 0) {
        const epHits = raycaster.current.intersectObjects(endpointTargets, false);
        if (epHits.length > 0 && epHits[0].object.parent) {
          return [{ ...epHits[0], object: epHits[0].object.parent }] as THREE.Intersection[];
        }
      }
    }
    
    let targets: THREE.Object3D[] = [];
    if (config.mainGroup) {
      config.mainGroup.traverse((child) => {
        if (!child.visible || 
            child.userData?.isHelper ||
            child.type === 'GridHelper' ||
            child.type === 'AxesHelper') {
          return;
        }

        if (child.userData?.isVertexEndpointPick) {
          return;
        }
        
        const layer = child.userData?.layer;
        if (layer && child.userData?.layerVisible === false) {
          return;
        }
        
        targets.push(child);
      });
    }
    
    const intersects = raycaster.current.intersectObjects(targets, true);
    
    return intersects.filter(intersect => {
      return intersect.object.visible && 
             !intersect.object.userData?.isHelper &&
             intersect.object.type !== 'GridHelper' &&
             intersect.object.type !== 'AxesHelper';
    });
  }, [config.scene, config.camera, config.mainGroup]);

  // Apply material to object
  const applyMaterial = useCallback((object: Line2 | THREE.Group | THREE.Mesh, material: LineMaterial) => {
    const renderer = config.renderer;
    
    const mapLineToMeshMat = (m: LineMaterial | undefined): THREE.MeshStandardMaterial => {
      if (m === materials.hoverMaterial) return materials.meshHoverMaterial;
      if (m === materials.selectionMaterial) return materials.meshSelectionMaterial;
      if (m === materials.excludedMaterial) return materials.meshExcludedMaterial;
      return new THREE.MeshStandardMaterial({ color: 0x888888 }); // default
    };
    
    if (object instanceof Line2) {
      const isExcluded = excludedObjectsSet.has(object);
      
      if (isExcluded) {
        if (object.material !== materials.excludedMaterial) {
          object.material = materials.excludedMaterial;
          if (renderer) {
            materials.excludedMaterial.resolution.set(renderer.domElement.width, renderer.domElement.height);
          }
        }
        return;
      }
      
      if (!originalMaterials.current.has(object)) {
        const currentMat = object.material;
        if (renderer && currentMat instanceof LineMaterial) {
          currentMat.resolution.set(renderer.domElement.width, renderer.domElement.height);
        }
        originalMaterials.current.set(object, currentMat instanceof LineMaterial ? currentMat : materials.defaultMaterial);
      }
      
      if (object.material !== material && material) {
        object.material = material;
        if (renderer) {
          material.resolution.set(renderer.domElement.width, renderer.domElement.height);
        }
      }
    } else if (object instanceof THREE.Group) {
      if (object.userData?.isVertexEndpointGroup) {
        if (excludedObjectsSet.has(object)) {
          applyVertexPickMeshAppearance(object, 'excluded');
        } else if (material === materials.selectionMaterial) {
          applyVertexPickMeshAppearance(object, 'selection');
        } else if (material === materials.hoverMaterial) {
          applyVertexPickMeshAppearance(object, 'hover');
        } else {
          applyVertexPickMeshAppearance(object, 'hidden');
        }
        return;
      }

      const isExcluded = excludedObjectsSet.has(object);
      
      if (isExcluded) {
        object.children.forEach(child => {
          if (child instanceof Line2 && child.material !== materials.excludedMaterial) {
            child.material = materials.excludedMaterial;
            if (renderer) {
              materials.excludedMaterial.resolution.set(renderer.domElement.width, renderer.domElement.height);
            }
          }
        });
        return;
      }
      
      object.children.forEach(child => {
        if (child instanceof Line2) {
          if (!originalMaterials.current.has(child)) {
            const currentMat = child.material;
            if (renderer && currentMat instanceof LineMaterial) {
              currentMat.resolution.set(renderer.domElement.width, renderer.domElement.height);
            }
            originalMaterials.current.set(child, currentMat instanceof LineMaterial ? currentMat : materials.defaultMaterial);
          }
          if (child.material !== material && material) {
            child.material = material;
            if (renderer) {
              material.resolution.set(renderer.domElement.width, renderer.domElement.height);
            }
          }
        }
      });
    } else if (object instanceof THREE.Mesh) {
      // Mesh için material değiştirme (3D objeler için)
      const isExcluded = excludedObjectsSet.has(object);
      
      if (!originalMaterials.current.has(object)) {
        const currentMat = object.material as THREE.Material;
        originalMaterials.current.set(object, currentMat as LineMaterial | THREE.Material);
      }
      
      const meshMat = isExcluded ? materials.meshExcludedMaterial : mapLineToMeshMat(material);
      if (object.material !== meshMat) {
        object.material = meshMat;
      }
    }
  }, [config.renderer, excludedObjectsSet, materials]);

  // Restore original material
  const restoreMaterial = useCallback((object: Line2 | THREE.Group | THREE.Mesh | null) => {
    if (!object) return;
    
    if (object instanceof Line2) {
      const isExcluded = excludedObjectsSet.has(object);
      if (isExcluded) {
        applyMaterial(object, materials.excludedMaterial);
        return;
      }
      
      const originalMat = originalMaterials.current.get(object);
      if (originalMat && originalMat instanceof LineMaterial && object.material !== originalMat) {
        object.material = originalMat;
        if (config.renderer) {
          originalMat.resolution.set(config.renderer.domElement.width, config.renderer.domElement.height);
        }
      }
    } else if (object instanceof THREE.Group) {
      if (object.userData?.isVertexEndpointGroup) {
        if (excludedObjectsSet.has(object)) {
          applyVertexPickMeshAppearance(object, 'excluded');
        } else if (selectedObjectsSet.has(object)) {
          applyVertexPickMeshAppearance(object, 'selection');
        } else {
          applyVertexPickMeshAppearance(object, 'hidden');
        }
        return;
      }

      const isExcluded = excludedObjectsSet.has(object);
      if (isExcluded) {
        applyMaterial(object, materials.excludedMaterial);
        return;
      }
      
      object.children.forEach(child => {
        if (child instanceof Line2) {
          const originalMat = originalMaterials.current.get(child);
          if (originalMat && originalMat instanceof LineMaterial && child.material !== originalMat) {
            child.material = originalMat;
            if (config.renderer) {
              originalMat.resolution.set(config.renderer.domElement.width, config.renderer.domElement.height);
            }
          }
        }
      });
    } else if (object instanceof THREE.Mesh) {
      // Mesh için material restore (3D objeler için)
      const isExcluded = excludedObjectsSet.has(object);
      if (isExcluded) {
        object.material = materials.meshExcludedMaterial;
        return;
      }
      
      const originalMat = originalMaterials.current.get(object) as THREE.Material | undefined;
      if (originalMat && object.material !== originalMat) {
        object.material = originalMat;
      }
    }
  }, [excludedObjectsSet, selectedObjectsSet, materials, applyMaterial, config.renderer]);

  // Update selection info
  const updateSelectionInfoPanel = useCallback(() => {
    const count = selectedObjectsSet.size;
    let newSelectionInfo: SelectionInfo = { count: 0 };
    
    const extractData = (ud: any): SelectedEntityInfo['data'] => {
      const sourceData = (ud && typeof ud.data === 'object' && ud.data !== null) ? ud.data : {};
      
      return {
        length: sourceData.length,
        circumference: sourceData.circumference,
        arcLength: sourceData.arcLength,
        diameter: sourceData.diameter,
        radius: sourceData.radius,
        center: sourceData.center,
        startPoint: sourceData.startPoint,
        endPoint: sourceData.endPoint,
        startAngle: sourceData.startAngle,
        endAngle: sourceData.endAngle,
        isClockwise: sourceData.isClockwise,
        vertexCount: sourceData.vertexCount,
        isClosed: sourceData.isClosed
      };
    };
    
    if (count === 1) {
      const singleSelection = Array.from(selectedObjectsSet)[0];
      const ud = singleSelection.userData;
      const displayType = ud.type === 'CENTER_POINT' ? `${ud.subType} Center`
        : (ud.type === 'POINT' && ud.data?.isVertexPoint) ? 'VERTEX (Snap)'
          : ud.type;
      newSelectionInfo = {
        count: 1,
        details: {
          type: displayType,
          layer: ud.layer,
          handle: ud.handle,
          data: extractData(ud)
        }
      };
    } else if (count > 1) {
      const detailsArray: SelectedEntityInfo[] = [];
      selectedObjectsSet.forEach(obj => {
        const ud = obj.userData;
        const displayType = ud.type === 'CENTER_POINT' ? `${ud.subType} Center`
          : (ud.type === 'POINT' && ud.data?.isVertexPoint) ? 'VERTEX (Snap)'
            : ud.type;
        detailsArray.push({
          type: displayType,
          layer: ud.layer,
          handle: ud.handle,
          data: extractData(ud)
        });
      });
      newSelectionInfo = { count: count, detailsArray: detailsArray };
    }
    
    setSelectionInfo(newSelectionInfo);
    config.onSelectionChange?.(newSelectionInfo);
    
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] Selection info updated:', newSelectionInfo);
    }
  }, [selectedObjectsSet, config.onSelectionChange, DEBUG_MOBILE]);

  // Update selection info when selection changes
  useEffect(() => {
    updateSelectionInfoPanel();
  }, [updateSelectionInfoPanel]);

  // Handle object selection
  const handleObjectSelection = useCallback((object: THREE.Object3D) => {
    if (!object) return;
    
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] Object selected:', object.userData?.type, object.userData?.handle);
    }
    
    if (isExclusionMode) {
      if (excludedObjectsSet.has(object)) {
        unexcludeObject(object);
        restoreMaterial(object as Line2 | THREE.Group);
      } else {
        excludeObject(object);
        applyMaterial(object as Line2 | THREE.Group, materials.excludedMaterial);
      }
    } else {
      const newSelection = new Set(selectedObjectsSet);
      if (selectedObjectsSet.has(object)) {
        newSelection.delete(object);
        restoreMaterial(object as Line2 | THREE.Group);
      } else {
        newSelection.add(object);
        applyMaterial(object as Line2 | THREE.Group, materials.selectionMaterial);
      }
      updateSelection(newSelection);
    }
  }, [isExclusionMode, excludedObjectsSet, selectedObjectsSet, unexcludeObject, excludeObject, updateSelection, restoreMaterial, applyMaterial, materials, DEBUG_MOBILE]);

  // Touch event handlers
  const handleTouchStart = useCallback((event: TouchEvent) => {
    event.preventDefault();
    
    const touches = event.touches;
    const currentTime = Date.now();
    
    setTouchState(prev => ({
      ...prev,
      isTouching: true,
      touchCount: touches.length,
      touchStartTime: currentTime,
      touchStartPosition: { x: touches[0].clientX, y: touches[0].clientY },
      isPanning: false,
      isSelecting: false,
      isLongPress: false
    }));
    
    if (touches.length === 1) {
      const touch = touches[0];
      updateTouchCoordinates(touch);
      
      // Long press timer for exclusion mode
      const longPressTimer = setTimeout(() => {
        setTouchState(prev => ({ ...prev, isLongPress: true }));
        setIsExclusionMode(prev => !prev);
        
        // Haptic feedback if available
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }
        
        if (DEBUG_MOBILE) {
          debug.log('[Mobile Viewer] Long press detected, exclusion mode:', !isExclusionMode);
        }
      }, touchState.longPressThreshold);
      
      setTouchState(prev => ({ ...prev, longPressTimer }));
    }
    
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] Touch start:', touches.length, 'touches');
    }
  }, [updateTouchCoordinates, touchState.longPressThreshold, isExclusionMode, DEBUG_MOBILE]);

  const handleTouchMove = useCallback((event: TouchEvent) => {
    event.preventDefault();
    
    const touches = event.touches;
    const currentTime = Date.now();
    
    if (touches.length === 1) {
      const touch = touches[0];
      const deltaX = Math.abs(touch.clientX - touchState.touchStartPosition.x);
      const deltaY = Math.abs(touch.clientY - touchState.touchStartPosition.y);
      
      // If moved beyond threshold, it's panning not selection
      if (deltaX > touchState.tapThreshold || deltaY > touchState.tapThreshold) {
        setTouchState(prev => ({ ...prev, isPanning: true }));
        
        // Clear long press timer
        if (touchState.longPressTimer) {
          clearTimeout(touchState.longPressTimer);
          setTouchState(prev => ({ ...prev, longPressTimer: null }));
        }
      }
    }
    
    // Update touch coordinates for potential selection
    if (touches.length === 1 && !touchState.isPanning) {
      updateTouchCoordinates(touches[0]);
    }
  }, [touchState.touchStartPosition, touchState.tapThreshold, touchState.longPressTimer, touchState.isPanning, updateTouchCoordinates]);

  const handleTouchEnd = useCallback((event: TouchEvent) => {
    event.preventDefault();
    
    const currentTime = Date.now();
    const touchDuration = currentTime - touchState.touchStartTime;
    
    // Clear long press timer
    if (touchState.longPressTimer) {
      clearTimeout(touchState.longPressTimer);
      setTouchState(prev => ({ ...prev, longPressTimer: null }));
    }
    
    // Only handle selection if it was a tap (not pan or long press)
    if (!touchState.isPanning && !touchState.isLongPress && touchDuration < touchState.longPressThreshold) {
      const intersects = getIntersectedObjects();
      
      if (intersects.length > 0) {
        const selectedObject = intersects[0].object;
        
        // Double tap detection
        const timeSinceLastTap = currentTime - lastTapTime.current;
        const isSameObject = lastTappedObject.current === selectedObject;
        
        if (timeSinceLastTap < doubleTapDelay && isSameObject) {
          // Double tap - chain selection (select connected objects of same type)
          if (config.mainGroup) {
            const connectedObjects = new Set<THREE.Object3D>();
            const targetType = selectedObject.userData?.type;
            const targetLayer = selectedObject.userData?.layer;
            
            if (targetType && targetLayer) {
              // Find all objects of same type and layer
              config.mainGroup.traverse((child) => {
                if (child.userData?.type === targetType && 
                    child.userData?.layer === targetLayer &&
                    child.visible &&
                    !child.userData?.isHelper) {
                  connectedObjects.add(child);
                }
              });
              
              // Update selection with connected objects
              const newSelection = new Set(selectedObjectsSet);
              connectedObjects.forEach(obj => newSelection.add(obj));
              updateSelection(newSelection);
              
              if (DEBUG_MOBILE) {
                debug.log('[Mobile Viewer] Double tap chain selection:', {
                  type: targetType,
                  layer: targetLayer,
                  connected: connectedObjects.size
                });
              }
            }
          }
        } else {
          // Single tap - select object
          handleObjectSelection(selectedObject);
        }
        
        lastTapTime.current = currentTime;
        lastTappedObject.current = selectedObject;
      } else {
        // Tap on empty space - clear selection if not in exclusion mode
        if (!isExclusionMode) {
          clearSelection();
          selectedObjectsSet.forEach(obj => {
            restoreMaterial(obj as Line2 | THREE.Group);
          });
          
          if (DEBUG_MOBILE) {
            debug.log('[Mobile Viewer] Cleared selection');
          }
        }
      }
    }
    
    setTouchState(prev => ({
      ...prev,
      isTouching: false,
      touchCount: 0,
      isPanning: false,
      isSelecting: false,
      isLongPress: false
    }));
    
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] Touch end');
    }
  }, [touchState, getIntersectedObjects, handleObjectSelection, isExclusionMode, clearSelection, selectedObjectsSet, restoreMaterial, config.controls, config.camera, doubleTapDelay, DEBUG_MOBILE]);

  // Setup touch event listeners
  useEffect(() => {
    const container = config.viewerContainer;
    if (!container) return;
    
    // Disable default touch behaviors
    container.style.touchAction = 'none';
    
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [config.viewerContainer, handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (touchState.longPressTimer) {
        clearTimeout(touchState.longPressTimer);
      }
    };
  }, [touchState.longPressTimer]);

  // Public API
  const toggleExclusionMode = useCallback(() => {
    setIsExclusionMode(prev => !prev);
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] Exclusion mode toggled:', !isExclusionMode);
    }
  }, [isExclusionMode, DEBUG_MOBILE]);

  const clearAllSelections = useCallback(() => {
    clearSelection();
    clearExclusions();
    
    // Restore all materials
    selectedObjectsSet.forEach(obj => {
      restoreMaterial(obj as Line2 | THREE.Group);
    });
    excludedObjectsSet.forEach(obj => {
      restoreMaterial(obj as Line2 | THREE.Group);
    });
    
    if (DEBUG_MOBILE) {
      debug.log('[Mobile Viewer] All selections cleared');
    }
  }, [clearSelection, clearExclusions, selectedObjectsSet, excludedObjectsSet, restoreMaterial, DEBUG_MOBILE]);

  return {
    // State
    selectionInfo,
    hoveredObject,
    isExclusionMode,
    touchState,
    
    // Actions
    toggleExclusionMode,
    clearAllSelections,
    handleObjectSelection,
    
    // Selection sets
    selectedObjectsSet,
    excludedObjectsSet,
    
    // Materials
    materials
  };
}