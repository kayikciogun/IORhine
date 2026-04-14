'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { DxfParser } from 'dxf-parser';
import { buildSceneFromParsedData, DxfStats, calculateBoundingBox } from './dxfSceneBuilder';
import { useDxf } from "@/contexts/DxfContext";
import { usePickPlace } from "@/contexts/PickPlaceContext";
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Alert, AlertDescription } from '../ui/alert';
// Card components removed - using overlay design instead
import { Upload, X, Send, Loader2, MessageSquarePlus, Box, File, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Network } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import { useSelection } from './useSelection';
import { useViewerInteractions } from './useViewerInteractions';
import GeometryInfoCard from './GeometryInfoCard';
import { getGeometryInfo, getSelectionSummary, GeometryInfo } from './geometryProperties';
import { debug } from '@/Utils/debug';
const DEBUG_VIEWER = typeof window !== 'undefined' && (localStorage.getItem('DEBUG_DXF') === '1' || localStorage.getItem('DEBUG_DXF_VIEWER') === '1');

// Chat Input Overlay Component
interface ChatInputOverlayProps {
  isLoading?: boolean;
  isAuth?: boolean;
  onSendMessage?: (content: string) => void;
  onNewChat?: () => void;
}

const ChatInputOverlay: React.FC<ChatInputOverlayProps> = ({
  isLoading = false,
  isAuth = true,
  onSendMessage,
  onNewChat
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading && isAuth && onSendMessage) {
      onSendMessage(input.trim());
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const handleNewChat = () => {
    if (onNewChat) {
      onNewChat();
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="relative w-full">
      <div className="bg-white/5 backdrop-blur-sm rounded-lg xs:rounded-xl sm:rounded-2xl border border-white/10 p-1 focus-within:border-white/20 transition-all duration-300 w-full">
        <div className="flex items-end gap-2 p-2 xs:p-2 sm:p-2 w-full">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isAuth ? "Describe your CNC operation..." : "You must be logged in to start a new chat."}
            disabled={isLoading || !isAuth}
            className="flex-1 min-h-[40px] xs:min-h-[65px] sm:min-h-[60px] max-h-[80px] xs:max-h-[100px] sm:max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/50 w-full"
            style={{
              height: 'auto',
              fontSize: '16px',
              WebkitAppearance: 'none',
              WebkitBorderRadius: '0',
              touchAction: 'manipulation'
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading || !isAuth}
            className={cn(
              "h-8 w-8 xs:h-10 xs:w-10 sm:h-12 sm:w-12 rounded-md xs:rounded-lg sm:rounded-xl transition-all duration-300 flex-shrink-0",
              input.trim() && !isLoading && isAuth
                ? "gradient-primary hover-lift hover-glow text-primary-foreground shadow-lg"
                : "glass border-white/20"
            )}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 xs:h-4 xs:w-4 sm:h-5 sm:w-5 animate-spin" />
            ) : (
              <Send className="h-3 w-3 xs:h-4 xs:w-4 sm:h-5 sm:w-5" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
};

interface DxfViewerProps {
  className?: string;
  hideControls?: boolean;
  onClose?: () => void;
  onFileLoad?: (stats: DxfStats) => void;
  onError?: (error: string) => void;
  initialFile?: File | null;
  isLoading?: boolean;
  isAuth?: boolean;
  onSendMessage?: (content: string) => void;
  onNewChat?: () => void;
  isPickPlaceMode?: boolean;
  activeStoneTypeId?: string | null;
}

interface ViewerState {
  isLoading: boolean;
  error: string | null;
  stats: DxfStats | null;
  selectedEntities: string[];
  showGrid: boolean;
  showAxes: boolean;
  loaded3DObject: boolean;
  objectType: 'dxf' | '3d' | null;
  showRotatePanel: boolean;
}

// Camera controls interface removed - not needed anymore

const DxfViewerContent: React.FC<DxfViewerProps> = ({ className, hideControls = false, onClose, onFileLoad, onError, initialFile, isLoading = false, isAuth = true, onSendMessage, onNewChat, isPickPlaceMode = false, activeStoneTypeId = null }) => {
  const { selectedDxfFile, setSelectedDxfFile, setParsedDxf, setMainGroup, mainGroup, modelTransform, setModelTransform } = useDxf();
  const { stoneTypes } = usePickPlace();
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<any>(null);
  const animationIdRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFrameLoggedRef = useRef<boolean>(false);
  const resizeLogRef = useRef<number>(0);
  const cameraAnimationRef = useRef<number | null>(null);

  // Yumuşak kamera animasyonu fonksiyonu
  const animateCameraToPosition = useCallback((
    targetPosition: THREE.Vector3,
    targetLookAt: THREE.Vector3,
    duration: number = 1000 // Daha hızlı animasyon
  ) => {
    if (!cameraRef.current || !controlsRef.current) return;

    const camera = cameraRef.current;
    const controls = controlsRef.current;

    const startPosition = camera.position.clone();
    const startLookAt = controls.target.clone();
    const startTime = Date.now();

    // Önceki animasyonu iptal et
    if (cameraAnimationRef.current) {
      cancelAnimationFrame(cameraAnimationRef.current);
    }

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function (ease-out) - daha yumuşak
      const easeOut = 1 - Math.pow(1 - progress, 2);

      // Pozisyon interpolasyonu
      const currentPosition = startPosition.clone().lerp(targetPosition, easeOut);
      const currentLookAt = startLookAt.clone().lerp(targetLookAt, easeOut);

      camera.position.copy(currentPosition);
      controls.target.copy(currentLookAt);
      controls.update();

      if (progress < 1) {
        cameraAnimationRef.current = requestAnimationFrame(animate);
      } else {
        cameraAnimationRef.current = null;
        debug.log('[Camera Animation] Animation completed');
      }
    };

    // Animasyonu geciktir - performans optimizasyonu
    setTimeout(() => {
      cameraAnimationRef.current = requestAnimationFrame(animate);
    }, 100);

    debug.log('[Camera Animation] Started animation to:', {
      targetPosition: targetPosition.clone(),
      targetLookAt: targetLookAt.clone(),
      duration: duration
    });
  }, []);

  const [viewerState, setViewerState] = useState<ViewerState>({
    isLoading: false,
    error: null,
    stats: null,
    selectedEntities: [],
    showGrid: true,
    showAxes: true,
    loaded3DObject: false,
    objectType: null,
    showRotatePanel: false
  });

  // ✅ Kamera hareketi durumu - hover/seçimi devre dışı bırakmak için
  const [isCameraMoving, setIsCameraMoving] = useState(false);

  // ✅ Boundary edges görünürlük durumu - default: kapalı
  const [showBoundaryEdges, setShowBoundaryEdges] = useState(false);

  // Main group state for interactions
  // Remove this line:
  // const [mainGroup, setMainGroup] = useState<THREE.Group | null>(null);

  // Geometry info card state
  const [geometryInfo, setGeometryInfo] = useState<GeometryInfo | null>(null);
  const [showGeometryInfo, setShowGeometryInfo] = useState(false);

  // Selection context for restoring selections
  const { restoreSelectionsByHandle } = useSelection();

  // Initialize viewer interactions - memoize config to prevent unnecessary re-renders
  const viewerConfig = useMemo(() => ({
    viewerContainer: mountRef.current,
    scene: sceneRef.current,
    camera: cameraRef.current,
    renderer: rendererRef.current,
    mainGroup: mainGroup,
    controls: controlsRef.current,
    isCameraMoving: isCameraMoving // ✅ Kamera hareketi durumu
  }), [mainGroup, isCameraMoving]);

  const {
    selectedObjectsSet,
    excludedObjectsSet,
    selectionInfo,
    clearSelection,
    clearExclusions
  } = useViewerInteractions(viewerConfig);

  // ✅ Boundary edges visibility control + Mesh seçilebilirliğini kapat
  useEffect(() => {
    if (!mainGroup) return;

    let boundaryGroupCount = 0;
    let meshCount = 0;

    // Tüm boundary edge group'larını ve mesh'leri bul
    mainGroup.traverse((obj: THREE.Object3D) => {
      if (obj.userData?.type === 'boundary_group') {
        // Boundary edges: showBoundaryEdges ile aç/kapa
        obj.visible = showBoundaryEdges;
        boundaryGroupCount++;
      } else if (obj instanceof THREE.Mesh && obj.userData?.selectable !== undefined) {
        // ✅ Mesh'ler: visible = false YAPMA (child'ları da gizler!)
        // Bunun yerine: Edge'ler açıkken transparent + NON-SELECTABLE yap
        const material = obj.material as THREE.MeshStandardMaterial;

        if (showBoundaryEdges) {
          // Wireframe mode: Mesh'i invisible + selectable = false
          material.opacity = 0;
          material.transparent = true;
          material.depthWrite = false; // Z-buffer'a yazma (edge'ler için)
          obj.userData.selectable = false; // ✅ Seçilemez yap!
          // Raycasting'i tamamen devre dışı bırak
          obj.layers.disable(0); // Default layer'dan çıkar
        } else {
          // Solid mode: Mesh'i normal göster + selectable = true
          material.opacity = 1.0;
          material.transparent = false;
          material.depthWrite = true;
          obj.userData.selectable = true; // ✅ Seçilebilir yap!
          obj.layers.enable(0); // Default layer'a geri ekle
        }
        material.needsUpdate = true;
        meshCount++;
      }
    });

    debug.log(`[3D Viewer] Boundary edges: ${showBoundaryEdges ? 'VISIBLE' : 'HIDDEN'} (${boundaryGroupCount} groups)`);
    debug.log(`[3D Viewer] Meshes: ${showBoundaryEdges ? 'TRANSPARENT & NON-SELECTABLE' : 'SOLID & SELECTABLE'} (${meshCount} meshes) - Wireframe mode: ${showBoundaryEdges}`);
  }, [showBoundaryEdges, mainGroup]);

  // Update geometry info when selection changes
  useEffect(() => {
    if (selectedObjectsSet.size === 0) {
      setGeometryInfo(null);
      setShowGeometryInfo(false);
    } else if (selectedObjectsSet.size === 1) {
      // Single selection - show detailed info
      const selectedObject = Array.from(selectedObjectsSet)[0];
      const info = getGeometryInfo(selectedObject);
      setGeometryInfo(info);
      setShowGeometryInfo(!!info);
    } else {
      // Multiple selection - show summary
      const summary = getSelectionSummary(selectedObjectsSet);
      setGeometryInfo(summary);
      setShowGeometryInfo(true);
    }
  }, [selectedObjectsSet]);

  // Pick & Place Mode: Taş tipi renklerini kontürlere uygula
  useEffect(() => {
    if (!isPickPlaceMode || !mainGroup) return;

    // Her objenin üzerinden geçip stoneTypes'a göre renk ayarla
    mainGroup.traverse((obj: THREE.Object3D) => {
      // Sadece görsel objeler (Mesh, Line, vs)
      const type = obj.userData?.type;
      const isGeometry = type === 'LINE' || type === 'ARC' || type === 'CIRCLE' || type === 'LWPOLYLINE' || type === 'POLYLINE' || type === 'SPLINE' || type === 'ELLIPSE' || type === 'boundary_edge';
      
      if (obj.userData && isGeometry) {
        const handle = obj.userData.handle || obj.uuid;
        if (!handle) return;
        
        // Bu handle herhangi bir stoneType'a atanmış mı bul
        const assignedStone = stoneTypes.find(st => st.contourIds.includes(handle));
        
        const material = (obj as any).material;
        if (!material) return;

        // Objeyin orjinal DXF rengini ilk kez kaydediyoruz
        if (obj.userData.pickPlaceBaseColor === undefined) {
          obj.userData.pickPlaceBaseColor = material.color ? material.color.getHex() : 0xffffff;
        }

        const targetColorHex = assignedStone ? new THREE.Color(assignedStone.color).getHex() : obj.userData.pickPlaceBaseColor;
        
        const isDimmed = activeStoneTypeId && (!assignedStone || assignedStone.id !== activeStoneTypeId);
        const isHighlighted = activeStoneTypeId && assignedStone && assignedStone.id === activeStoneTypeId;

        // Object.userData'ye özel rengi kaydet. useViewerInteractions.ts bu alanı okuyup uygulayacak
        obj.userData.pickPlaceColor = targetColorHex;
        obj.userData.pickPlaceOpacity = isDimmed ? 0.2 : 1.0;
        obj.userData.pickPlaceLinewidth = isHighlighted ? 6 : 3;
        
        if (!selectedObjectsSet.has(obj)) {
          // Tetik mekanizması için geçici bir hack, etkisini useViewerInteractions yönetmeli
          // Ama objemizin "seçili olmayan durumuna" dönmesi için bir refresh trick:
          if ((window as any).__forceRestoreMaterial && typeof (window as any).__forceRestoreMaterial === 'function') {
            (window as any).__forceRestoreMaterial(obj);
          }
        }
      }
    });
  }, [stoneTypes, isPickPlaceMode, mainGroup, selectedObjectsSet, activeStoneTypeId]);

  // Handle geometry info card close
  const handleGeometryInfoClose = useCallback(() => {
    setShowGeometryInfo(false);
    setGeometryInfo(null);
  }, []);

  // Camera controls state removed - not needed anymore

  // Handle resize with ResizeObserver for better container resize detection
  const handleResize = useCallback(() => {
    if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const camera = cameraRef.current;
    const renderer = rendererRef.current;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Update LineMaterial resolution for all Line2 objects with improved targeting
    const pr = window.devicePixelRatio || 1;
    const resW = Math.max(1, Math.floor(width * pr));
    const resH = Math.max(1, Math.floor(height * pr));
    let matsUpdated = 0;

    if (sceneRef.current) {
      sceneRef.current.traverse((obj) => {
        if (obj.type === 'Line2' && (obj as any).material && typeof (obj as any).material.resolution !== 'undefined') {
          (obj as any).material.resolution.set(resW, resH);
          matsUpdated++;
        }
      });
    }

  }, []);

  // Initialize Three.js scene
  const initThreeJS = useCallback(() => {
    if (!mountRef.current) {
      return;
    }

    // WebGL context kaybını önle - mevcut canvas'ı kontrol et
    const existingCanvas = mountRef.current.querySelector('canvas');
    if (existingCanvas) {
      existingCanvas.remove();
    }

    const width = mountRef.current.clientWidth || 800;
    const height = mountRef.current.clientHeight || 600;


    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000); // Black background
    sceneRef.current = scene;

    // Scene'i global olarak erişilebilir hale getir
    if (typeof window !== 'undefined') {
      (window as any).dxfScene = scene;
    }

    // Camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100000);
    camera.position.set(100, 100, 100);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    rendererRef.current = renderer;

    // WebGL context loss debug
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });

    // Lighting - 4 directional lights from all sides
    const ambientLight = new THREE.AmbientLight(0x404040, 1.2);
    scene.add(ambientLight);

    // Front light (positive Z)
    const frontLight = new THREE.DirectionalLight(0xffffff, 0.8);
    frontLight.position.set(0, 100, 100);
    frontLight.castShadow = true;
    scene.add(frontLight);

    // Back light (negative Z)
    const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
    backLight.position.set(0, 100, -100);
    backLight.castShadow = true;
    scene.add(backLight);

    // Left light (negative X)
    const leftLight = new THREE.DirectionalLight(0xffffff, 0.8);
    leftLight.position.set(-100, 100, 0);
    leftLight.castShadow = true;
    scene.add(leftLight);

    // Right light (positive X)
    const rightLight = new THREE.DirectionalLight(0xffffff, 0.8);
    rightLight.position.set(100, 100, 0);
    rightLight.castShadow = true;
    scene.add(rightLight);

    // Top light (positive Y)
    const topLight = new THREE.DirectionalLight(0xffffff, 0.8);
    topLight.position.set(0, 200, 0);
    topLight.castShadow = true;
    scene.add(topLight);

    // Bottom light pointing to origin (negative Y)
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.8);
    bottomLight.position.set(0, -100, 0);
    bottomLight.target.position.set(0, 0, 0); // Point to origin
    bottomLight.castShadow = true;
    scene.add(bottomLight);
    scene.add(bottomLight.target);

    // Hemisphere light for natural sky effect
    const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x362D1D, 0.1);
    scene.add(hemisphereLight);

    // Mount canvas to DOM
    try {
      mountRef.current.appendChild(renderer.domElement);

      // Debug canvas properties
      debug.log('[DXF Viewer] Canvas debug info:', {
        canvasWidth: renderer.domElement.width,
        canvasHeight: renderer.domElement.height,
        canvasStyle: {
          display: renderer.domElement.style.display,
          width: renderer.domElement.style.width,
          height: renderer.domElement.style.height,
          position: renderer.domElement.style.position,
          zIndex: renderer.domElement.style.zIndex,
          visibility: renderer.domElement.style.visibility,
          opacity: renderer.domElement.style.opacity,
          transform: renderer.domElement.style.transform
        },
        containerBCR: mountRef.current.getBoundingClientRect(),
        canvasBCR: renderer.domElement.getBoundingClientRect(),
        canvasComputedStyle: window.getComputedStyle(renderer.domElement),
        containerComputedStyle: window.getComputedStyle(mountRef.current)
      });

      // Force canvas to be visible
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.top = '0';
      renderer.domElement.style.left = '0';
      renderer.domElement.style.zIndex = '1';
      renderer.domElement.style.pointerEvents = 'auto';

    } catch (error) {
      console.error('[DXF Viewer] Failed to mount canvas:', error);
    }

    // Controls (OrbitControls)
    import('three/examples/jsm/controls/OrbitControls.js').then(({ OrbitControls }) => {
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1; // Daha yavaş hareket için artırıldı
      controls.rotateSpeed = 0.3; // Rotasyon hızını yavaşlat
      controls.zoomSpeed = 0.5; // Zoom hızını yavaşlat
      controls.panSpeed = 0.4; // Pan hızını yavaşlat
      // Keep camera angle fixed and disable panning for 2D drawings
      controls.enableRotate = false;
      controls.enableZoom = false;
      controls.enablePan = false;
      // Set mouse buttons: right click for rotation, middle click for pan
      controls.mouseButtons = {
        LEFT: null,    // Disable left click
        MIDDLE: THREE.MOUSE.PAN,  // Middle click for pan
        RIGHT: THREE.MOUSE.ROTATE // Right click for rotation
      };
      // Disable built-in zoomToCursor; we'll handle precise, non-rotating zoom ourselves
      (controls as any).zoomToCursor = false;

      // ✅ Kamera hareketi event listeners - hover/seçimi devre dışı bırakmak için
      controls.addEventListener('start', () => {
        setIsCameraMoving(true);
        if (renderer.domElement) {
          renderer.domElement.style.cursor = 'grabbing'; // Cursor: grabbing
        }

      });

      controls.addEventListener('end', () => {
        setIsCameraMoving(false);
        if (renderer.domElement) {
          renderer.domElement.style.cursor = 'default'; // Cursor: default
        }

      });

      controlsRef.current = controls;
    });

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      if (controlsRef.current) {
        controlsRef.current.update();
      }

      renderer.render(scene, camera);

      // Log on first frame only - optimize for performance
      if (!firstFrameLoggedRef.current) {
        firstFrameLoggedRef.current = true;
        // Debug logları sadece development modunda çalıştır
        if (process.env.NODE_ENV === 'development') {
          const size = renderer.getSize(new THREE.Vector2());
        }
      }
    };

    // İlk yüklemede animasyonu geciktir - performans optimizasyonu
    setTimeout(() => {
      animate();
    }, 50);


    // Initial render
    renderer.render(scene, camera);

    // Wheel zoom-to-cursor helper for PerspectiveCamera
    const onWheel = (e: WheelEvent) => {
      if (!controlsRef.current || !renderer?.domElement) return;
      const controls = controlsRef.current;

      // We will handle zoom ourselves to avoid any rotation.
      // Prevent default so browser/page doesn't scroll and to avoid duplicate handlers doing work.
      e.preventDefault();

      // Compute NDC from mouse
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1)
      );

      // Ray from camera through cursor
      const raycaster0 = new THREE.Raycaster();
      raycaster0.setFromCamera(ndc, camera);

      // Define a plane perpendicular to the camera view passing through controls.target
      const viewDir = new THREE.Vector3();
      camera.getWorldDirection(viewDir);
      const targetPlane0 = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, controls.target.clone());

      const hit0 = new THREE.Vector3();
      const hasHit0 = raycaster0.ray.intersectPlane(targetPlane0, hit0);

      // Zoom factor (dolly scale). Tune the sensitivity by adjusting 0.1 multiplier or base 0.95
      const scale = Math.pow(0.95, e.deltaY * 0.1);

      // Current offset from target to camera
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);

      // Clamp using controls min/max distance if available
      const currentDist = offset.length();
      const minDist = (controls as any).minDistance ?? 0;
      const maxDist = (controls as any).maxDistance ?? Infinity;
      const targetDist = THREE.MathUtils.clamp(currentDist * scale, minDist > 0 ? minDist : 0.0001, isFinite(maxDist) ? maxDist : Infinity);

      // New camera position along the current view vector (no rotation)
      const newOffset = offset.normalize().multiplyScalar(targetDist);
      const newCamPos = new THREE.Vector3().addVectors(controls.target, newOffset);

      // Move camera to the new position first
      camera.position.copy(newCamPos);
      camera.updateMatrixWorld(true);

      // Recalculate the intersection on the same (updated) view-aligned plane
      const raycaster1 = new THREE.Raycaster();
      raycaster1.setFromCamera(ndc, camera);
      const targetPlane1 = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, controls.target.clone());
      const hit1 = new THREE.Vector3();
      const hasHit1 = raycaster1.ray.intersectPlane(targetPlane1, hit1);

      // To keep the point under cursor stable without rotating the camera,
      // translate BOTH camera and target by the lateral difference hit0 - hit1 (programmatic pan).
      if (hasHit0 && hasHit1) {
        const lateral = hit0.sub(hit1);
        camera.position.add(lateral);
        controls.target.add(lateral);
      }

      controls.update();
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // Use ResizeObserver for better container resize detection
    let resizeObserver: ResizeObserver | null = null;

    if (mountRef.current) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          // Debounce resize calls
          handleResize();
        }
      });
      resizeObserver.observe(mountRef.current);
    }

    // Fallback to window resize for cases where container size depends on window
    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', handleResize);
    };
  }, [handleResize]);

  // Cleanup Three.js
  const cleanupThreeJS = useCallback(() => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
    }

    if (rendererRef.current && mountRef.current) {
      mountRef.current.removeChild(rendererRef.current.domElement);
      rendererRef.current.dispose();
    }

    if (sceneRef.current) {
      sceneRef.current.clear();
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // 3D MODEL ROTATION CONTROL
  // ═══════════════════════════════════════════════════════════════

  /**
   * 3D modeli belirtilen eksende 90 derece döndürür ve en alt noktayı Z=0'a getirir
   */
  const rotate3DModel = useCallback((axis: 'x+' | 'x-' | 'y+' | 'y-') => {
    if (!mainGroup || viewerState.objectType !== '3d') {
      debug.log('[Rotate] Cannot rotate: no 3D object loaded');
      return;
    }

    debug.log(`[Rotate] Rotating model 90° on axis: ${axis}`);

    // 90 derece = PI/2 radyan
    const angle = Math.PI / 2;

    // Eksene göre rotasyonu uygula (ters yön)
    switch (axis) {
      case 'x+':
        mainGroup.rotateX(-angle);
        break;
      case 'x-':
        mainGroup.rotateX(angle);
        break;
      case 'y+':
        mainGroup.rotateY(-angle);
        break;
      case 'y-':
        mainGroup.rotateY(angle);
        break;
    }

    // Rotasyondan sonra matrixWorld'ü güncelle (STL export için kritik!)
    mainGroup.updateMatrixWorld(true);

    // Rotasyondan sonra bounding box'ı hesapla
    const box = new THREE.Box3().setFromObject(mainGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    debug.log('[Rotate] Bounding box after rotation:', {
      min: box.min.clone(),
      max: box.max.clone(),
      size: size.clone(),
      center: center.clone()
    });

    // En alt noktayı Z=0'a getir (CNC standart: Z=0 alt yüzey)
    const offsetZ = -box.min.z;
    mainGroup.position.z += offsetZ;

    // X ve Y'yi merkeze al
    mainGroup.position.x -= center.x;
    mainGroup.position.y -= center.y;

    // Position değiştikten sonra tekrar matrixWorld güncelle
    mainGroup.updateMatrixWorld(true);

    debug.log('[Rotate] Model repositioned to Z=0 (bottom):', {
      newPosition: mainGroup.position.clone(),
      offsetApplied: { x: -center.x, y: -center.y, z: offsetZ }
    });

    // Kamerayı yeni pozisyona ayarla
    const newBox = new THREE.Box3().setFromObject(mainGroup);
    const newSize = newBox.getSize(new THREE.Vector3());
    const newCenter = newBox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(newSize.x, newSize.y, newSize.z);

    if (cameraRef.current) {
      const fov = cameraRef.current.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ = Math.max(cameraZ * 1.5, 200);

      const targetPosition = new THREE.Vector3(newCenter.x, newCenter.y, newCenter.z + cameraZ);
      const targetLookAt = newCenter.clone();

      animateCameraToPosition(targetPosition, targetLookAt, 500);
    }

    // Render güncelle
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }

    // Model transformasyonunu context'e kaydet
    if (selectedDxfFile) {
      setModelTransform({
        position: {
          x: mainGroup.position.x,
          y: mainGroup.position.y,
          z: mainGroup.position.z
        },
        rotation: {
          x: mainGroup.rotation.x,
          y: mainGroup.rotation.y,
          z: mainGroup.rotation.z
        },
        fileName: selectedDxfFile.name
      });
      debug.log('[Rotate] Model transform saved to context:', {
        position: mainGroup.position.clone(),
        rotation: mainGroup.rotation.clone()
      });
    }

    debug.log('[Rotate] Rotation completed successfully');
  }, [mainGroup, viewerState.objectType, animateCameraToPosition, selectedDxfFile, setModelTransform]);

  // ═══════════════════════════════════════════════════════════════
  // MESH PARTITIONING FOR SELECTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Mesh'i spatial grid ile parçalara ayırır
   * Her parça ayrı seçilebilir olur (2D DXF gibi)
   */
  const partitionMeshBySpatialGrid = useCallback((
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    gridSize: number = 2,  // ✅ 4'ten 2'ye düşürdük (8 parça yerine sadece çok büyük mesh'ler için)
    preserveNormals?: THREE.BufferAttribute  // ✅ Yeni parametre - partition'dan önce hesaplanmış normal'ları koru
  ): THREE.Mesh[] => {

    // Bounding box hesapla
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    const size = bbox.getSize(new THREE.Vector3());

    // ✅ Sadece çok küçük mesh'leri bölme (örn. vida, somun gibi)
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (maxDimension < 30) {  // 30mm'den küçük mesh'leri bölme
      debug.log(`[MeshPartition] Mesh very small (${maxDimension.toFixed(1)}mm), keeping as single piece`);
      const singleMesh = new THREE.Mesh(geometry, material);
      return [singleMesh];
    }

    // ✅ Triangle sayısına göre partition karar ver
    const totalTriangles = geometry.attributes.position.count / 3;
    if (totalTriangles < 100) {  // Çok basit geometri
      debug.log(`[MeshPartition] Simple geometry (${totalTriangles} triangles), keeping as single piece`);
      const singleMesh = new THREE.Mesh(geometry, material);
      return [singleMesh];
    }

    const cellWidth = size.x / gridSize;
    const cellHeight = size.y / gridSize;
    const cellDepth = size.z / gridSize;

    debug.log(`[MeshPartition] Partitioning ${gridSize}x${gridSize}x${gridSize} grid, cell size: ${cellWidth.toFixed(2)}x${cellHeight.toFixed(2)}x${cellDepth.toFixed(2)}`);

    // Her grid cell için triangle listesi
    const cells: Map<string, number[]> = new Map();

    const position = geometry.attributes.position;
    const triangleCount = position.count / 3;

    // Her triangle'ı grid cell'e ata
    for (let i = 0; i < triangleCount; i++) {
      const i0 = i * 3;
      const i1 = i * 3 + 1;
      const i2 = i * 3 + 2;

      // Triangle merkezini hesapla
      const centerX = (position.getX(i0) + position.getX(i1) + position.getX(i2)) / 3;
      const centerY = (position.getY(i0) + position.getY(i1) + position.getY(i2)) / 3;
      const centerZ = (position.getZ(i0) + position.getZ(i1) + position.getZ(i2)) / 3;

      // Grid cell index hesapla
      const cellX = Math.floor((centerX - bbox.min.x) / cellWidth);
      const cellY = Math.floor((centerY - bbox.min.y) / cellHeight);
      const cellZ = Math.floor((centerZ - bbox.min.z) / cellDepth);

      // Clamp to grid bounds
      const clampedX = Math.max(0, Math.min(gridSize - 1, cellX));
      const clampedY = Math.max(0, Math.min(gridSize - 1, cellY));
      const clampedZ = Math.max(0, Math.min(gridSize - 1, cellZ));

      const cellKey = `${clampedX}_${clampedY}_${clampedZ}`;

      if (!cells.has(cellKey)) {
        cells.set(cellKey, []);
      }
      cells.get(cellKey)!.push(i);
    }

    debug.log(`[MeshPartition] Triangles distributed across ${cells.size} non-empty cells`);

    // Her cell için ayrı mesh oluştur
    const meshParts: THREE.Mesh[] = [];

    cells.forEach((triangleIndices, cellKey) => {
      if (triangleIndices.length === 0) return;

      // Yeni geometry oluştur
      const partGeometry = new THREE.BufferGeometry();
      const vertexCount = triangleIndices.length * 3;
      const positions = new Float32Array(vertexCount * 3);
      const normals = new Float32Array(vertexCount * 3);  // ✅ Her zaman normals array oluştur

      let vertexIndex = 0;
      for (const triIndex of triangleIndices) {
        for (let v = 0; v < 3; v++) {
          const srcIndex = triIndex * 3 + v;

          // Copy position
          positions[vertexIndex * 3] = position.getX(srcIndex);
          positions[vertexIndex * 3 + 1] = position.getY(srcIndex);
          positions[vertexIndex * 3 + 2] = position.getZ(srcIndex);

          // ✅ Copy PRESERVED normals (partition'dan önce hesaplanmış)
          if (preserveNormals) {
            normals[vertexIndex * 3] = preserveNormals.getX(srcIndex);
            normals[vertexIndex * 3 + 1] = preserveNormals.getY(srcIndex);
            normals[vertexIndex * 3 + 2] = preserveNormals.getZ(srcIndex);
          } else if (geometry.attributes.normal) {
            // Fallback: Original geometry'den kopyala
            const normalAttr = geometry.attributes.normal;
            normals[vertexIndex * 3] = normalAttr.getX(srcIndex);
            normals[vertexIndex * 3 + 1] = normalAttr.getY(srcIndex);
            normals[vertexIndex * 3 + 2] = normalAttr.getZ(srcIndex);
          }

          vertexIndex++;
        }
      }

      partGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // ✅ Normal'ları AYNEN KULLAN (yeniden hesaplama!)
      if (preserveNormals || geometry.attributes.normal) {
        partGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      } else {
        // Son çare: Yeniden hesapla (ama bu smooth olmaz!)
        partGeometry.computeVertexNormals();
      }

      // Material clone (her parça ayrı material alacak - selection için)
      const partMaterial = material.clone();

      // ✅ SMOOTH SHADING'İ GARANTİ ALTINA AL
      if (partMaterial instanceof THREE.MeshStandardMaterial) {
        partMaterial.flatShading = false;  // Smooth shading zorunlu
        partMaterial.roughness = 0.5;      // Yumuşak yüzey için optimize et
        partMaterial.metalness = 0.2;      // Hafif metalik görünüm
        partMaterial.needsUpdate = true;
      }

      const partMesh = new THREE.Mesh(partGeometry, partMaterial);

      meshParts.push(partMesh);
    });

    debug.log(`[MeshPartition] Created ${meshParts.length} mesh parts`);
    return meshParts;
  }, []);

  // Load 3D object file
  const load3DObject = useCallback(async (file: File) => {
    setViewerState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      debug.log('[3D Viewer] Loading 3D object:', { name: file.name, size: file.size, type: file.type });

      // Clear existing scene content
      if (sceneRef.current) {
        const objectsToRemove = sceneRef.current.children.filter(
          child => !(child instanceof THREE.GridHelper) &&
            !(child instanceof THREE.AxesHelper) &&
            !(child instanceof THREE.AmbientLight) &&
            !(child instanceof THREE.DirectionalLight)
        );
        objectsToRemove.forEach(obj => sceneRef.current!.remove(obj));
        debug.log('[3D Viewer] Cleared scene objects', { removed: objectsToRemove.length });
      }

      const fileExtension = file.name.toLowerCase().split('.').pop();
      let object: THREE.Object3D | null = null;

      // Load based on file extension
      switch (fileExtension) {
        case 'gltf':
        case 'glb': {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          const loader = new GLTFLoader();
          const arrayBuffer = await file.arrayBuffer();

          debug.log('[3D Viewer] GLTF/GLB file processing:', {
            name: file.name,
            size: arrayBuffer.byteLength,
            extension: fileExtension
          });

          try {
            const gltf = await loader.parseAsync(arrayBuffer, '');
            object = gltf.scene;

            // Enable smooth shading for GLTF objects
            object.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                if (child.geometry) {
                  child.geometry.computeVertexNormals();
                }
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                      if (mat instanceof THREE.MeshStandardMaterial) {
                        mat.flatShading = false;
                        mat.roughness = Math.min(mat.roughness || 0.5, 0.8);
                        mat.metalness = Math.min(mat.metalness || 0.5, 0.9);
                      }
                    });
                  } else if (child.material instanceof THREE.MeshStandardMaterial) {
                    child.material.flatShading = false;
                    child.material.roughness = Math.min(child.material.roughness || 0.5, 0.8);
                    child.material.metalness = Math.min(child.material.metalness || 0.5, 0.9);
                  }
                }
              }
            });

            debug.log('[3D Viewer] GLTF/GLB loaded successfully:', {
              scenes: gltf.scenes?.length || 0,
              animations: gltf.animations?.length || 0,
              cameras: gltf.cameras?.length || 0
            });
          } catch (gltfError) {
            debug.error('[3D Viewer] GLTF/GLB parsing error:', gltfError);
            throw new Error(`Error loading GLTF/GLB file: ${gltfError instanceof Error ? gltfError.message : 'Unknown GLTF error'}`);
          }
          break;
        }
        case 'obj': {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
          const loader = new OBJLoader();

          debug.log('[3D Viewer] OBJ file processing:', {
            name: file.name,
            size: file.size
          });

          try {
            const text = await file.text();
            object = loader.parse(text);

            // Enable smooth shading for OBJ objects
            object.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                if (child.geometry) {
                  child.geometry.computeVertexNormals();
                }
                if (child.material) {
                  if (Array.isArray(child.material)) {
                    child.material.forEach(mat => {
                      if (mat instanceof THREE.MeshStandardMaterial) {
                        mat.flatShading = false;
                        mat.roughness = 0.3;
                        mat.metalness = 0.1;
                      }
                    });
                  } else if (child.material instanceof THREE.MeshStandardMaterial) {
                    child.material.flatShading = false;
                    child.material.roughness = 0.3;
                    child.material.metalness = 0.1;
                  }
                }
              }
            });

            debug.log('[3D Viewer] OBJ loaded successfully:', {
              children: object.children.length
            });
          } catch (objError) {
            debug.error('[3D Viewer] OBJ parsing error:', objError);
            throw new Error(`Error loading OBJ file: ${objError instanceof Error ? objError.message : 'Unknown OBJ error'}`);
          }
          break;
        }
        case 'fbx': {
          const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
          const loader = new FBXLoader();
          const arrayBuffer = await file.arrayBuffer();
          object = loader.parse(arrayBuffer, '');
          break;
        }
        case '3ds': {
          const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js');
          const loader = new TDSLoader();
          const arrayBuffer = await file.arrayBuffer();
          object = loader.parse(arrayBuffer, '');
          break;
        }
        case 'dae': {
          const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
          const loader = new ColladaLoader();
          const text = await file.text();
          const collada = loader.parse(text, '');
          object = collada.scene;
          break;
        }
        default:
          throw new Error(`Unsupported 3D file format: ${fileExtension}`);
      }

      if (!object) {
        throw new Error('Failed to load 3D object');
      }

      // ✅ Apply smooth shading AND userData to all 3D objects
      const applySmoothShading = (obj: THREE.Object3D, fileName: string) => {
        let meshCount = 0;
        // Dosya adı ve index'e dayalı deterministik handle için dosya adını hazırla
        const fileBaseName = fileName.replace(/\.[^/.]+$/, ""); // Uzantıyı kaldır

        obj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.geometry) {
              child.geometry.computeVertexNormals();
            }
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(mat => {
                  if (mat instanceof THREE.MeshStandardMaterial) {
                    mat.flatShading = false;
                    mat.roughness = Math.min(mat.roughness || 0.5, 0.8);
                    mat.metalness = Math.min(mat.metalness || 0.5, 0.9);
                  }
                });
              } else if (child.material instanceof THREE.MeshStandardMaterial) {
                child.material.flatShading = false;
                child.material.roughness = Math.min(child.material.roughness || 0.5, 0.8);
                child.material.metalness = Math.min(child.material.metalness || 0.5, 0.9);
              }
            }

            // ✅ userData ekle (selection için kritik!)
            // Deterministik handle kullan: aynı dosya her yüklendiğinde aynı handle'ları alsın
            if (!child.userData || !child.userData.selectable) {
              child.userData = {
                type: 'mesh',
                handle: `mesh_${fileBaseName}_${meshCount}`,
                fileName: fileName,
                selectable: true,
                objectType: fileExtension,
                index: meshCount
              };
              meshCount++;
              debug.log(`[3D Viewer] Added userData to mesh ${meshCount}:`, child.userData.handle);
            }
          }
        });
        debug.log(`[3D Viewer] Processed ${meshCount} meshes, all marked as selectable`);
      };

      // Apply smooth shading and userData to the loaded object
      applySmoothShading(object, file.name);

      // Add to scene
      if (sceneRef.current) {
        // Calculate bounding box BEFORE adding to scene
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // CNC Coordinate System Fix:
        // 1. Move mesh center to X=0, Y=0
        // 2. Move mesh BOTTOM to Z=0 (CNC standard: Z=0 is bottom surface, Z+ is up)
        const cncOffset = new THREE.Vector3(-center.x, -center.y, -box.min.z);
        object.position.copy(cncOffset);

        debug.log('[3D Viewer] CNC Coordinate System Fix (Bottom to Z=0):', {
          originalBbox: { min: box.min, max: box.max, center, size },
          cncOffset: cncOffset,
          newPosition: object.position.clone(),
          note: 'Mesh bottom moved to Z=0, Z+ is up direction'
        });

        // Recalculate bounding box after repositioning
        const newBox = new THREE.Box3().setFromObject(object);
        const newSize = newBox.getSize(new THREE.Vector3());
        const newCenter = newBox.getCenter(new THREE.Vector3());
        const maxDim = Math.max(newSize.x, newSize.y, newSize.z);

        debug.log('[3D Viewer] After CNC fix (Bottom to Z=0):', {
          newBbox: { min: newBox.min, max: newBox.max, center: newCenter, size: newSize },
          note: `Mesh now spans Z: ${newBox.min.z.toFixed(3)} to ${newBox.max.z.toFixed(3)} (${newSize.z.toFixed(3)}mm height)`
        });

        sceneRef.current.add(object);
        setMainGroup(object);

        // Restore model transformation if saved (rotation & position)
        let finalCenter = newCenter;
        let finalMaxDim = maxDim;

        if (modelTransform && modelTransform.fileName === file.name) {
          debug.log('[3D Viewer] Restoring saved model transformation:', modelTransform);

          // Rotation'ı uygula
          object.rotation.set(
            modelTransform.rotation.x,
            modelTransform.rotation.y,
            modelTransform.rotation.z
          );

          // Position'ı uygula
          object.position.set(
            modelTransform.position.x,
            modelTransform.position.y,
            modelTransform.position.z
          );

          // Yeni bounding box'ı hesapla
          const restoredBox = new THREE.Box3().setFromObject(object);
          finalCenter = restoredBox.getCenter(new THREE.Vector3());
          const restoredSize = restoredBox.getSize(new THREE.Vector3());
          finalMaxDim = Math.max(restoredSize.x, restoredSize.y, restoredSize.z);

          debug.log('[3D Viewer] Model transformation restored:', {
            position: object.position.clone(),
            rotation: object.rotation.clone(),
            newCenter: finalCenter.clone()
          });
        }

        // Restore selections by handle after loading 3D object with a delay
        // to ensure all materials and effects are properly initialized
        // Mesh'ler ve material'lerin tam olarak hazır olması için biraz daha fazla bekliyoruz
        setTimeout(() => {
          restoreSelectionsByHandle(sceneRef.current!);
          debug.log('[3D Viewer] Selections restored after 3D object load');
        }, 250);

        // Position camera
        const fov = cameraRef.current!.fov * (Math.PI / 180);
        let cameraZ = Math.abs(finalMaxDim / 2 / Math.tan(fov / 2));
        cameraZ = Math.max(cameraZ * 1.5, 200);

        setTimeout(() => {
          const targetPosition = new THREE.Vector3(finalCenter.x, finalCenter.y, finalCenter.z + cameraZ);
          const targetLookAt = finalCenter.clone();

          // Kamera projeksiyon ayarlarını hemen yap
          cameraRef.current!.near = Math.max(0.1, cameraZ * 0.01);
          cameraRef.current!.far = Math.max(10000, cameraZ * 10);
          cameraRef.current!.updateProjectionMatrix();

          // Yumuşak animasyonla kamera pozisyonunu ayarla
          animateCameraToPosition(targetPosition, targetLookAt, 800);

          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
          }
        }, 100);

        debug.log('[3D Viewer] 3D object loaded successfully:', {
          type: fileExtension,
          children: object.children.length,
          originalBbox: { min: box.min, max: box.max, size, center },
          cncFixedBbox: { min: newBox.min, max: newBox.max, size: newSize, center: newCenter }
        });
      }

      setViewerState(prev => ({
        ...prev,
        isLoading: false,
        loaded3DObject: true,
        objectType: '3d',
        error: null
      }));

      // context'teki selectedDxfFile'ı günceleyerek header bar ile senkronize et
      if (selectedDxfFile !== file) {
        setSelectedDxfFile?.(file);
      }

      // Enable 3D controls for 3D objects
      if (controlsRef.current) {
        controlsRef.current.enableRotate = true;
        controlsRef.current.enableZoom = true;
        controlsRef.current.enablePan = true;
        // Set mouse buttons for 3D: right click for rotation, middle click for pan
        controlsRef.current.mouseButtons = {
          LEFT: null,    // Disable left click
          MIDDLE: THREE.MOUSE.PAN,  // Middle click for pan
          RIGHT: THREE.MOUSE.ROTATE // Right click for rotation
        };
        debug.log('[3D Viewer] 3D controls enabled for 3D object with right-click rotation');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setViewerState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      clearSelection();
      clearExclusions();
      setParsedDxf(null);
      setMainGroup(null);
      onError?.(errorMessage);
      console.error('[3D Viewer] load3DObject error', error);
    }
  }, [onError, clearSelection, clearExclusions, setParsedDxf, setMainGroup, modelTransform, restoreSelectionsByHandle, animateCameraToPosition]);

  // Load DXF/DWG file
  const loadFile = useCallback(async (file: File) => {
    setViewerState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      let dxfContent: string;
      // Check if it's a DWG file and convert if needed
      if (file.name.toLowerCase().endsWith('.dwg')) {

        // Dynamically import DWG converter to avoid SSR issues
        const { convertDwgToDxf, isDwgFile } = await import('./dwgToDxfConverter');

        const arrayBuffer = await file.arrayBuffer();

        // Validate it's actually a DWG file
        if (!isDwgFile(arrayBuffer)) {
          throw new Error('File does not appear to be a valid DWG file');
        }
        // Convert DWG to DXF
        dxfContent = await convertDwgToDxf(arrayBuffer, file.name);
      } else {
        // Read DXF directly
        dxfContent = await file.text();
      }

      // Parse DXF with error handling
      const parser = new DxfParser();
      let parsedDxf;
      try {
        parsedDxf = parser.parseSync(dxfContent);
        setParsedDxf(parsedDxf); // DXF verisini context'e kaydet
        // context'teki selectedDxfFile'ı günceleyerek header bar ile senkronize et
        if (selectedDxfFile !== file) {
          setSelectedDxfFile?.(file);
        }
      } catch (parseError) {
        throw new Error(`DXF file is invalid or corrupted. Please load a valid DXF file. Error: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
      }
      const layerCount =
        (parsedDxf as any)?.tables?.layers?.layers?.length ??
        (parsedDxf as any)?.tables?.layer?.layers?.length ??
        (parsedDxf as any)?.tables?.LAYER?.layers?.length ??
        0;

      // Clear existing scene content
      if (sceneRef.current) {
        const objectsToRemove = sceneRef.current.children.filter(
          child => !(child instanceof THREE.GridHelper) &&
            !(child instanceof THREE.AxesHelper) &&
            !(child instanceof THREE.AmbientLight) &&
            !(child instanceof THREE.DirectionalLight)
        );
        objectsToRemove.forEach(obj => sceneRef.current!.remove(obj));
      }

      // Create default material for Line2 objects
      const { LineMaterial } = await import('three/examples/jsm/lines/LineMaterial.js');
      const mountEl = mountRef.current;
      const mWidth = mountEl?.clientWidth ?? window.innerWidth;
      const mHeight = mountEl?.clientHeight ?? window.innerHeight;
      const pr = window.devicePixelRatio || 1;
      const defaultMaterial = new LineMaterial({
        color: 0xffffff,
        linewidth: 2,
        resolution: new THREE.Vector2(mWidth * pr, mHeight * pr)
      });

      // Build scene from parsed data
      const group = buildSceneFromParsedData(parsedDxf, defaultMaterial);
      const stats = group.userData.stats as DxfStats;

      // Calculate bounds from parsed DXF (more reliable for Line2)
      const bounds = calculateBoundingBox(parsedDxf);
      const centerFromBounds = new THREE.Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
      const centeringOffset: THREE.Vector3 = (group.userData.centeringOffset as THREE.Vector3) || new THREE.Vector3();
      const fitCenter = centerFromBounds.add(centeringOffset.clone());
      const fitSize = new THREE.Vector3().subVectors(bounds.max, bounds.min);
      // Reset camera functionality removed
      (group.userData as any).fitCenter = fitCenter.clone();
      (group.userData as any).fitSize = fitSize.clone();

      if (sceneRef.current) {
        (window as any).dxfScene = sceneRef.current; // StripPreview için
        sceneRef.current.add(group);
        setMainGroup(group); // Set mainGroup state for interactions

        // Restore selections by handle after loading new content with a delay
        // to ensure all materials and effects are properly initialized
        setTimeout(() => {
          restoreSelectionsByHandle(sceneRef.current!);
        }, 100);

        // Ensure Line2 objects render consistently
        let line2Count = 0;
        let materialsWithResolution = 0;
        let geomSummaries: any[] = [];
        group.traverse((obj: any) => {
          if (obj?.isLine2) {
            line2Count++;
            obj.frustumCulled = false;
            const attrs = (obj.geometry && obj.geometry.attributes) ? Object.keys(obj.geometry.attributes) : [];
            geomSummaries.push({ attrs, type: obj.geometry?.type, count: (obj.geometry as any)?.instanceCount });
          }
          const mat = obj?.material;
          if (mat && mat.resolution && typeof mat.resolution.set === 'function') {
            mat.resolution.set(mWidth * pr, mHeight * pr);
            materialsWithResolution++;
          }
        });

        // Compute actual Box3 from objects
        const box = new THREE.Box3().setFromObject(group);
        const boxSize = box.getSize(new THREE.Vector3());
        const boxCenter = box.getCenter(new THREE.Vector3());

        // Fit camera to content with better positioning
        const size = fitSize;
        const center = fitCenter;
        const maxDim = Math.max(size.x, size.y, size.z || 0.001);
        const fov = cameraRef.current!.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ = Math.max(cameraZ * 1.5, 200); // padding + minimum distance

        // Use setTimeout to ensure proper camera positioning with smooth animation
        setTimeout(() => {
          const targetPosition = new THREE.Vector3(center.x, center.y, center.z + cameraZ);
          const targetLookAt = center.clone();

          // Kamera projeksiyon ayarlarını hemen yap
          cameraRef.current!.near = Math.max(0.1, cameraZ * 0.01);
          cameraRef.current!.far = Math.max(10000, cameraZ * 10);
          cameraRef.current!.updateProjectionMatrix();

          // Yumuşak animasyonla kamera pozisyonunu ayarla
          animateCameraToPosition(targetPosition, targetLookAt, 800);

          // Force a render update
          if (rendererRef.current && sceneRef.current && cameraRef.current) {
            rendererRef.current.render(sceneRef.current, cameraRef.current);
            const info = rendererRef.current.info;
          }
        }, 100);
      }

      setViewerState(prev => ({
        ...prev,
        isLoading: false,
        stats,
        objectType: 'dxf',
        error: null
      }));

      // Disable 3D controls for 2D drawings
      if (controlsRef.current) {
        controlsRef.current.enableRotate = false;
        controlsRef.current.enableZoom = false;
        controlsRef.current.enablePan = false;
      }

      onFileLoad?.(stats);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setViewerState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      clearSelection();
      clearExclusions();
      setParsedDxf(null);
      setMainGroup(null);
      onError?.(errorMessage);
      console.error('[DXF Viewer] loadFile error', error);
    }
  }, [onFileLoad, onError, clearSelection, clearExclusions, setParsedDxf, setMainGroup]);

  // Handle file input change
  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const fileExtension = file.name.toLowerCase().split('.').pop();
      const is3DFormat = ['gltf', 'glb', 'obj', 'stl', 'ply', 'fbx', '3ds', 'dae', 'step', 'stp', 'iges', 'igs'].includes(fileExtension || '');

      debug.log('[File Handler] File detected:', {
        name: file.name,
        extension: fileExtension,
        is3DFormat,
        size: file.size,
        type: file.type
      });

      if (is3DFormat) {
        load3DObject(file);
      } else {
        loadFile(file);
      }
    }
  }, [loadFile, load3DObject]);

  // Handle initial file loading - use ref to prevent re-loading same file
  const loadedFileRef = useRef<File | null>(null);

  useEffect(() => {
    // Öncelik prop ile gelen initialFile'da, yoksa context'teki selectedDxfFile
    const fileToLoad = initialFile || selectedDxfFile;

    // Eğer mainGroup zaten varsa ve dosya aynı ise re-load yapmaya gerek yok
    // Sadece scene'e eklenmesi yeterli (initialization effect'inde yapılıyor)
    if (fileToLoad && fileToLoad !== loadedFileRef.current) {
      // Eğer zaten mainGroup varsa ve bu dosyanın adı ile eşleşiyorsa yükleme yapma
      // Not: mainGroup.userData.fileName kontrolü yapılabilir ama her formatta yok

      // Eğer mainGroup varsa ve re-load yapmak istemiyorsak burayı geçebiliriz
      // Ancak kullanıcı yeni bir dosya seçmiş de olabilir, bu yüzden loadedFileRef takibi önemli

      loadedFileRef.current = fileToLoad;

      const fileExtension = fileToLoad.name.toLowerCase().split('.').pop();
      const is3DFormat = ['gltf', 'glb', 'obj', 'stl', 'ply', 'fbx', '3ds', 'dae', 'step', 'stp', 'iges', 'igs'].includes(fileExtension || '');

      if (is3DFormat) {
        load3DObject(fileToLoad);
      } else {
        loadFile(fileToLoad);
      }
    }
  }, [selectedDxfFile, initialFile, loadFile, load3DObject]);

  // Update controls based on object type
  useEffect(() => {
    if (controlsRef.current) {
      if (viewerState.objectType === '3d') {
        controlsRef.current.enableRotate = true;
        controlsRef.current.enableZoom = true;
        controlsRef.current.enablePan = true;
        // Set mouse buttons for 3D: right click for rotation, middle click for pan
        controlsRef.current.mouseButtons = {
          LEFT: null,    // Disable left click
          MIDDLE: THREE.MOUSE.PAN,  // Middle click for pan
          RIGHT: THREE.MOUSE.ROTATE // Right click for rotation
        };
        debug.log('[Viewer] 3D controls activated with right-click rotation');
      } else if (viewerState.objectType === 'dxf') {
        controlsRef.current.enableRotate = false;
        controlsRef.current.enableZoom = false;
        controlsRef.current.enablePan = false;
        debug.log('[Viewer] 2D controls activated');
      }
    }
  }, [viewerState.objectType]);

  // Reset camera function removed - not needed anymore



  // Initialize on mount
  useEffect(() => {
    initThreeJS();

    // Eğer context'te zaten bir mainGroup varsa, onu scene'e geri ekle (persistence)
    if (mainGroup && sceneRef.current) {
      debug.log('[DXF Viewer] Restoring existing mainGroup from context to new scene');
      sceneRef.current.add(mainGroup);

      // loadedFileRef'i de selectedDxfFile ile senkronize et ki tekrar yüklemesin
      if (selectedDxfFile) {
        loadedFileRef.current = selectedDxfFile;

        // Viewer state'i de mevcut duruma göre güncelle
        setViewerState(prev => ({
          ...prev,
          loaded3DObject: !!mainGroup.userData?.selectable,
          objectType: mainGroup.userData?.selectable ? '3d' : 'dxf',
          isLoading: false
        }));
      }
    }

    // Add initial grid and axes after a short delay to ensure scene is ready
    setTimeout(() => {
      if (sceneRef.current) {
        if (viewerState.showGrid) {
          const gridHelper = new THREE.GridHelper(10000, 100, 0x444444, 0x222222);
          // Rotate grid to match DXF coordinate system (XZ plane)
          gridHelper.rotateX(Math.PI / 2);
          sceneRef.current.add(gridHelper);
        }

        if (viewerState.showAxes) {
          const axesHelper = new THREE.AxesHelper(100);
          // Rotate axes to match DXF coordinate system (XZ plane)
          axesHelper.rotateX(Math.PI / 2);
          sceneRef.current.add(axesHelper);
        }

        // Force a render after adding helpers
        if (rendererRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      }
    }, 100);

    return () => {
      cleanupThreeJS();
    };
  }, []);

  // Controls update effect removed - not needed anymore

  return (
    <div className={`dxf-viewer relative w-full h-full min-h-[600px] ${className || ''}`}>
      {/* Three.js Viewer Container - Full Screen */}
      <div
        ref={mountRef}
        className="absolute inset-0 w-full h-full bg-[#111827]"
        style={{ minHeight: '600px' }}
      />

      {/* Top Right Controls - Close & Rotate */}
      {onClose && (
        <div className="absolute top-4 right-4 z-20 flex gap-2">
          {/* Boundary Edges Toggle Button (Wireframe Mode) - İlk sırada */}
          {viewerState.objectType === '3d' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowBoundaryEdges(prev => !prev)}
              aria-label={showBoundaryEdges ? "Solid mode (mesh)" : "Wireframe mode (edges)"}
              title={showBoundaryEdges ? "Mesh görünümüne geç" : "Kenar çizgilerine geç (iskelet)"}
              className={cn(
                "glass hover-lift hover-glow transition-all duration-300 rounded-md xs:rounded-lg sm:rounded-xl h-8 w-8 xs:h-10 xs:w-10 border border-white/20 hover:border-white/40 backdrop-blur-md",
                showBoundaryEdges
                  ? "text-green-400 hover:text-green-300 hover:bg-green-500/10 border-green-400/40"
                  : "text-white/80 hover:text-cyan-400 hover:bg-cyan-500/10"
              )}
            >
              <Network className="h-4 w-4 xs:h-5 xs:w-5" />
            </Button>
          )}

          {/* Rotate Button - İkinci sırada */}
          {viewerState.objectType === '3d' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewerState(prev => ({ ...prev, showRotatePanel: !prev.showRotatePanel }))}
              aria-label="3D modeli döndür"
              className="glass hover-lift hover-glow transition-all duration-300 rounded-md xs:rounded-lg sm:rounded-xl h-8 w-8 xs:h-10 xs:w-10 border border-white/20 hover:border-white/40 backdrop-blur-md text-white/80 hover:text-blue-400 hover:bg-blue-500/10"
            >
              <RotateCcw className="h-4 w-4 xs:h-5 xs:w-5" />
            </Button>
          )}

          {/* Close Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close DXF viewer"
            className="glass hover-lift hover-glow transition-all duration-300 rounded-md xs:rounded-lg sm:rounded-xl h-8 w-8 xs:h-10 xs:w-10 border border-white/20 hover:border-white/40 backdrop-blur-md text-white/80 hover:text-red-400 hover:bg-red-500/10"
          >
            <X className="h-4 w-4 xs:h-5 xs:w-5" />
          </Button>
        </div>
      )}

      {/* Overlay Controls - Top Left */}
      {!hideControls && (
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
          {/* File Upload - Modern Drag & Drop - Show only when nothing is loaded */}
          {!viewerState.stats && !viewerState.loaded3DObject && (
            <div className="glass backdrop-blur-md rounded-xl p-4 border border-white/20 hover:border-white/40 transition-all duration-300">
              <Label
                htmlFor="file-upload"
                className="flex flex-col items-center gap-3 cursor-pointer group"
              >
                <div className="p-3 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 group-hover:from-blue-500/30 group-hover:to-purple-500/30 transition-all duration-300">
                  <Upload className="w-4 h-4 text-blue-400 group-hover:text-blue-300 transition-colors duration-300" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium text-foreground group-hover:text-blue-300 transition-colors duration-300">
                    {viewerState.isLoading ? 'Processing...' : 'Upload DXF/DWG/3D'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    DXF, DWG, STEP, IGES, GLTF, OBJ, STL, PLY, FBX, 3DS, DAE
                  </div>
                </div>
              </Label>
              <Input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept=".dxf,.dwg,.step,.stp,.iges,.igs,.gltf,.glb,.obj,.stl,.ply,.fbx,.3ds,.dae"
                onChange={handleFileChange}
                className="hidden"
                disabled={viewerState.isLoading}
              />
            </div>
          )}

          {/* Selection Info */}
          {(viewerState.stats || viewerState.loaded3DObject) && (
            <div className="glass backdrop-blur-md rounded-lg p-3 border border-white/20">
              <div className="text-sm text-muted-foreground space-y-1">
                <div className="flex items-center gap-2 mb-2">
                  {viewerState.objectType === '3d' ? (
                    <File className="w-4 h-4 text-green-400" />
                  ) : (
                    <Box className="w-4 h-4 text-blue-400" />
                  )}
                  <span className="text-foreground font-medium">
                    {viewerState.objectType === '3d' ? '3D Object' : 'DXF Drawing'}
                  </span>
                </div>
                <div>Selected: <span className="text-foreground">{selectedObjectsSet.size}</span></div>
                <div>Excluded: <span className="text-foreground">{excludedObjectsSet.size}</span></div>
                {selectedObjectsSet.size > 0 && (
                  <Button
                    onClick={clearSelection}
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-6 px-2 text-xs glass hover-lift hover-glow transition-all duration-300 border border-white/20"
                  >
                    Clear Selection
                  </Button>
                )}
                {excludedObjectsSet.size > 0 && (
                  <Button
                    onClick={clearExclusions}
                    size="sm"
                    variant="ghost"
                    className="mt-1 h-6 px-2 text-xs glass hover-lift hover-glow transition-all duration-300 border border-white/20"
                  >
                    Clear Exclusions
                  </Button>
                )}
              </div>
            </div>
          )}

        </div>
      )}


      {/* Chat Input - Bottom Center Overlay */}
      {(viewerState.stats || viewerState.loaded3DObject) && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-2xl px-4">
          <ChatInputOverlay
            isLoading={isLoading}
            isAuth={isAuth}
            onSendMessage={onSendMessage}
            onNewChat={onNewChat}
          />
        </div>
      )}

      {/* Error display - Bottom Center */}
      {viewerState.error && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-10 max-w-md">
          <Alert variant="destructive" className="bg-red-900/90 backdrop-blur-sm border-red-700">
            <AlertDescription className="text-red-100">{viewerState.error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Rotation Control Panel - Top Right (below buttons) */}
      {viewerState.showRotatePanel && viewerState.objectType === '3d' && (
        <div className="absolute top-16 right-4 z-20">
          <div className="glass backdrop-blur-md rounded-xl p-4 border border-white/20 hover:border-white/40 transition-all duration-300 w-48">
            <div className="text-sm font-medium text-white/90 mb-3 text-center">
              Döndür (90°)
            </div>

            {/* Rotation Controls - Arrow Layout */}
            <div className="flex flex-col items-center gap-2">
              {/* X+ (Up Arrow) - Model önü yukarı kalkar */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => rotate3DModel('x+')}
                className="glass hover-lift hover-glow transition-all duration-300 rounded-lg h-10 w-10 border border-white/20 hover:border-blue-400 backdrop-blur-md text-white/80 hover:text-blue-400 hover:bg-blue-500/10"
                title="Model önünü yukarı kaldır"
              >
                <ArrowUp className="h-5 w-5" />
              </Button>

              {/* Y- (Left Arrow) and Y+ (Right Arrow) */}
              <div className="flex gap-2 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => rotate3DModel('y-')}
                  className="glass hover-lift hover-glow transition-all duration-300 rounded-lg h-10 w-10 border border-white/20 hover:border-blue-400 backdrop-blur-md text-white/80 hover:text-blue-400 hover:bg-blue-500/10"
                  title="Sola yuvarla"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>

                {/* Center indicator */}
                <div className="w-10 h-10 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-blue-400/50"></div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => rotate3DModel('y+')}
                  className="glass hover-lift hover-glow transition-all duration-300 rounded-lg h-10 w-10 border border-white/20 hover:border-blue-400 backdrop-blur-md text-white/80 hover:text-blue-400 hover:bg-blue-500/10"
                  title="Sağa yuvarla"
                >
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </div>

              {/* X- (Down Arrow) - Model önü aşağı iner */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => rotate3DModel('x-')}
                className="glass hover-lift hover-glow transition-all duration-300 rounded-lg h-10 w-10 border border-white/20 hover:border-blue-400 backdrop-blur-md text-white/80 hover:text-blue-400 hover:bg-blue-500/10"
                title="Move model front down"
              >
                <ArrowDown className="h-5 w-5" />
              </Button>
            </div>

            <div className="text-xs text-white/50 mt-3 text-center">
              Model tabanı her zaman Z=0'da
            </div>
          </div>
        </div>
      )}

      {/* Geometry Info Card - Left Side */}
      <GeometryInfoCard
        geometryInfo={geometryInfo}
        isVisible={showGeometryInfo}
        onClose={handleGeometryInfoClose}
      />
    </div>
  );
};

const DxfViewer: React.FC<DxfViewerProps> = (props) => {
  return <DxfViewerContent {...props} />;
};

export default DxfViewer;
export type { DxfViewerProps, DxfStats };

