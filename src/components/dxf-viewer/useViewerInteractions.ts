import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useSelection } from './useSelection';
import type { SelectionInfo, SelectedEntityInfo } from '../../types/selection';

import { debug } from '../../Utils/debug';
import { applyVertexPickMeshAppearance } from './vertexEndpointVisual';
interface ViewerInteractionsConfig {
    viewerContainer: HTMLDivElement | null;
    renderer: THREE.WebGLRenderer | null;
    camera: THREE.PerspectiveCamera | null;
    scene: THREE.Scene | null;
    mainGroup: THREE.Group | null;
    controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null;
    onSelectionChange?: (info: SelectionInfo) => void;
    isCameraMoving?: boolean; // ✅ Kamera hareket ediyor mu? (hover/seçimi devre dışı bırakmak için)
}

export function useViewerInteractions(config: ViewerInteractionsConfig) {
    const { selectedObjectsSet, excludedObjectsSet, updateSelection, clearSelection, excludeObject: excludeObj, excludeObjects, unexcludeObject, clearExclusions } = useSelection();

    // Central debug flag for interactions
    const DEBUG_DXF_I = typeof window !== 'undefined' && (localStorage.getItem('DEBUG_DXF') === '1' || localStorage.getItem('DEBUG_DXF_INTERACTIONS') === '1');

    // Debug mainGroup changes
    useEffect(() => {
        const DEBUG_DXF_I = typeof window !== 'undefined' && (localStorage.getItem('DEBUG_DXF') === '1' || localStorage.getItem('DEBUG_DXF_INTERACTIONS') === '1');
        if (DEBUG_DXF_I) debug.log('[useViewerInteractions] MainGroup updated:', config.mainGroup);
    }, [config.mainGroup, DEBUG_DXF_I]);

    // State
    const [selectionInfo, setSelectionInfo] = useState<SelectionInfo>({ count: 0 });
    const [hoveredObject, setHoveredObject] = useState<THREE.Object3D | null>(null);
    const originalMaterials = useRef(new WeakMap<THREE.Object3D, THREE.Material>());

    const [wasObjectClicked, setWasObjectClicked] = useState(false);

    // Double Click State
    const lastClickTime = useRef(0);
    const lastClickedObject = useRef<THREE.Object3D | null>(null);
    const lastRightClickTime = useRef(0);
    const lastRightClickedObject = useRef<THREE.Object3D | null>(null);
    const doubleClickDelay = 300;

    // Materials
    const materials = useMemo(() => {
        // Dairesel nokta dokusu oluştur (Points için kare yerine yuvarlak görünüm)
        const createCircleTexture = (size = 64) => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, size, size);
                ctx.beginPath();
                ctx.arc(size / 2, size / 2, (size / 2) - 1, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            }
            const texture = new THREE.Texture(canvas);
            texture.needsUpdate = true;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            return texture;
        };

        const pointSprite = createCircleTexture(64);

        const defaultMaterial = new LineMaterial({
            color: 0xFFFFFF,
            linewidth: 3,
            vertexColors: false,
            worldUnits: false,
            depthTest: true,
            depthWrite: true
        });
        const hoverMaterial = new LineMaterial({
            color: 0x00FF00,
            linewidth: 4,
            vertexColors: false,
            worldUnits: false,
            depthTest: true,
            depthWrite: true
        });
        const selectionMaterial = new LineMaterial({
            color: 0x008000,
            linewidth: 4,
            vertexColors: false,
            worldUnits: false,
            depthTest: true,
            depthWrite: true
        });
        const excludedMaterial = new LineMaterial({
            color: 0xFF0000,
            linewidth: 4,
            vertexColors: false,
            worldUnits: false,
            depthTest: true,
            depthWrite: true
        });

        // Points için karşılık gelen materyaller
        const pointDefaultMaterial = new THREE.PointsMaterial({ size: 6, sizeAttenuation: true, color: 0xFFFFFF, map: pointSprite, alphaTest: 0.5, transparent: true });
        const pointHoverMaterial = new THREE.PointsMaterial({ size: 7, sizeAttenuation: true, color: 0x00FF00, map: pointSprite, alphaTest: 0.5, transparent: true });
        const pointSelectionMaterial = new THREE.PointsMaterial({ size: 7, sizeAttenuation: true, color: 0x008000, map: pointSprite, alphaTest: 0.5, transparent: true });
        const pointExcludedMaterial = new THREE.PointsMaterial({ size: 6, sizeAttenuation: true, color: 0xFF0000, map: pointSprite, alphaTest: 0.5, transparent: true });

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

        return {
            defaultMaterial, hoverMaterial, selectionMaterial, excludedMaterial,
            pointDefaultMaterial, pointHoverMaterial, pointSelectionMaterial, pointExcludedMaterial,
            meshHoverMaterial, meshSelectionMaterial, meshExcludedMaterial
        };
    }, []);

    // Update material resolution when renderer changes
    useEffect(() => {
        if (config.renderer) {
            const { width, height } = config.renderer.domElement;
            Object.values(materials).forEach(mat => {
                if (mat instanceof LineMaterial) {
                    mat.resolution.set(width, height);
                }
            });
        }
    }, [config.renderer, materials]);

    // Normalize initial POINTS materials to circular sprite (avoid square points on first render),
    // but DO NOT replace material instances to preserve per-point size; only ensure sprite/alpha set.
    useEffect(() => {
        const mainGroup = config.mainGroup;
        if (!mainGroup) return;
        mainGroup.traverse(obj => {
            if (obj instanceof THREE.Points) {
                const pm = obj.material as THREE.PointsMaterial;
                // Ensure sprite/alpha parameters
                if (!pm.map && materials.pointDefaultMaterial.map) pm.map = materials.pointDefaultMaterial.map;
                pm.alphaTest = 0.5;
                pm.transparent = true;
                pm.sizeAttenuation = true;
                pm.needsUpdate = true;
                if (!originalMaterials.current.has(obj)) {
                    originalMaterials.current.set(obj, pm);
                }
            }
        });
    }, [config.mainGroup, materials]);

    // Helper: project world -> px
    const projectWorldToPx = useCallback((v: THREE.Vector3): { x: number, y: number } | null => {
        if (!config.camera || !config.viewerContainer) return null;
        const rect = config.viewerContainer.getBoundingClientRect();
        const p = v.clone().project(config.camera);
        const px = (p.x + 1) * 0.5 * rect.width;
        const py = (1 - (p.y + 1) * 0.5) * rect.height;
        return { x: px, y: py };
    }, [config.camera, config.viewerContainer]);

    // Helper: compute pixel-per-world at a given world position
    const getPxPerWorldAt = useCallback((worldPos: THREE.Vector3): number => {
        const a = projectWorldToPx(worldPos);
        const b = projectWorldToPx(worldPos.clone().add(new THREE.Vector3(1, 0, 0)));
        if (!a || !b) return 1;
        return Math.hypot(b.x - a.x, b.y - a.y);
    }, [projectWorldToPx]);

    // Center / vertex / serbest POINT boyutları — kamera–nokta mesafesi ve ekran ölçeğine göre
    const adjustCenterPointSizes = useCallback(() => {
        if (!config.mainGroup || !config.camera || !config.viewerContainer) return;

        const cam = config.camera;

        /**
         * sizeAttenuation=true: kameradan uzaklık ve ekranda mm→px ölçeğiyle boyutu dengele,
         * zoom in/out sonrası noktanın ekranda ~aynı “tıklanabilir” büyüklükte kalması için.
         */
        const sizeForWorldPoint = (worldPos: THREE.Vector3, minPx: number, maxPx: number) => {
            const dist = Math.max(4, cam.position.distanceTo(worldPos));
            const pxPerWorld = getPxPerWorldAt(worldPos);
            const refDist = 95;
            const distFactor = Math.sqrt(THREE.MathUtils.clamp(dist / refDist, 0.2, 6));
            const pxFactor = THREE.MathUtils.clamp(1.15 / Math.max(0.08, Math.sqrt(pxPerWorld)), 0.65, 1.45);
            const raw = 4.2 * distFactor * pxFactor;
            return THREE.MathUtils.clamp(raw, minPx, maxPx);
        };

        config.mainGroup.traverse(obj => {
            if (obj instanceof THREE.Group && obj.userData?.isVertexEndpointGroup === true) {
                const worldPos = obj.userData.pointCoordinate as THREE.Vector3 | undefined
                    ?? (obj.userData?.data?.point
                        ? new THREE.Vector3(obj.userData.data.point.x, obj.userData.data.point.y, obj.userData.data.point.z || 0)
                        : null);
                if (!worldPos) return;
                const pxPerWorld = getPxPerWorldAt(worldPos);
                const targetScreenRadiusPx = 6.5;
                const radiusWorld = THREE.MathUtils.clamp(
                    targetScreenRadiusPx / Math.max(pxPerWorld, 0.03),
                    0.12,
                    140
                );
                obj.children.forEach(ch => {
                    if (ch instanceof THREE.Mesh && ch.userData?.isVertexEndpointPick) {
                        if (Math.abs(ch.scale.x - radiusWorld) > 0.02) {
                            ch.scale.setScalar(radiusWorld);
                        }
                    }
                });
                return;
            }

            const isCenterGroup = obj.userData?.isCenterPointGroup === true;
            const isCenterPoint = obj.userData?.isCenterPoint === true;
            const isFreePointGroup = obj.userData?.isPointGroup === true && !isCenterGroup && !obj.userData?.isVertexEndpointGroup;

            if (!isCenterGroup && !isCenterPoint && !isFreePointGroup) return;

            const adjustPoints = (pts: THREE.Points) => {
                const ud: any = pts.userData || obj.userData || {};
                const dataAny: any = ud.data || {};
                const radius = (typeof dataAny.effectiveMajorRadius === 'number' ? dataAny.effectiveMajorRadius : undefined) ??
                    (typeof dataAny.radius === 'number' ? dataAny.radius : undefined) ?? 0;
                const center = ud.centerCoordinate as THREE.Vector3 | undefined;

                const pm = pts.material as THREE.PointsMaterial;

                if (isFreePointGroup) {
                    const gud: any = obj.userData || {};
                    const p = gud.pointCoordinate as THREE.Vector3 | undefined
                        ?? (gud.data?.point ? new THREE.Vector3(gud.data.point.x, gud.data.point.y, gud.data.point.z || 0) : undefined)
                        ?? (gud.data?.position ? new THREE.Vector3(gud.data.position.x, gud.data.position.y, gud.data.position.z || 0) : undefined);
                    const worldPos = p ?? new THREE.Vector3(0, 0, 0);
                    const desired = sizeForWorldPoint(worldPos, 2.5, 13);
                    if (Math.abs(pm.size - desired) > 0.35) {
                        pm.size = desired;
                        pm.needsUpdate = true;
                    }
                    return;
                }

                if (!center) {
                    const cameraDistance = cam.position.length();
                    const baseDistance = 20;
                    const zoomScale = Math.max(0.3, Math.min(2.0, baseDistance / Math.max(0.2, cameraDistance)));
                    const baseSize = 5;
                    const desired = Math.max(2, Math.min(8, baseSize * zoomScale));
                    if (Math.abs(pm.size - desired) > 0.5) {
                        pm.size = desired;
                        pm.needsUpdate = true;
                    }
                    return;
                }

                const cameraDistance = cam.position.distanceTo(center);
                const baseDistance = 20;
                const zoomScale = Math.max(0.3, Math.min(2.0, baseDistance / Math.max(0.2, cameraDistance)));

                const pxPerWorld = getPxPerWorldAt(new THREE.Vector3(center.x, center.y, center.z || 0));
                const projectedRadiusPx = Math.max(0, pxPerWorld * Math.max(0, radius));

                const maxByRadius = projectedRadiusPx * 0.2;
                const baseSize = Math.max(2, Math.min(10, maxByRadius));

                const zoomAdjustedSize = baseSize * zoomScale;
                const desired = Math.max(1.5, Math.min(8, zoomAdjustedSize));

                if (Math.abs(pm.size - desired) > 0.5) {
                    pm.size = desired;
                    pm.needsUpdate = true;
                }
            };

            if (obj instanceof THREE.Points) {
                adjustPoints(obj);
            } else if (obj instanceof THREE.Group) {
                obj.children.forEach(child => {
                    if (child instanceof THREE.Points) adjustPoints(child);
                });
            }
        });
    }, [config.mainGroup, config.camera, config.viewerContainer, getPxPerWorldAt]);

    // Apply material to object
    const applyMaterial = useCallback((object: Line2 | THREE.Group | THREE.Points | THREE.Mesh | THREE.Line, material: LineMaterial) => {
        const renderer = config.renderer;
        const mapLineToPointMat = (m: LineMaterial | undefined): THREE.PointsMaterial => {
            if (m === materials.hoverMaterial) return materials.pointHoverMaterial;
            if (m === materials.selectionMaterial) return materials.pointSelectionMaterial;
            if (m === materials.excludedMaterial) return materials.pointExcludedMaterial;
            return materials.pointDefaultMaterial;
        };

        const mapLineToMeshMat = (m: LineMaterial | undefined): THREE.MeshStandardMaterial => {
            if (m === materials.hoverMaterial) return materials.meshHoverMaterial;
            if (m === materials.selectionMaterial) return materials.meshSelectionMaterial;
            if (m === materials.excludedMaterial) return materials.meshExcludedMaterial;
            return new THREE.MeshStandardMaterial({ color: 0x888888 }); // default
        };

        // ✅ Boundary edges (THREE.Line) için renk mapping - DXF line'ları gibi
        const mapLineToBasicLineColor = (m: LineMaterial | undefined): number => {
            if (m === materials.hoverMaterial) return 0x008000; // Koyu yeşil (hover)
            if (m === materials.selectionMaterial) return 0x00ff00; // Açık yeşil (seçim)
            if (m === materials.excludedMaterial) return 0xff0000; // Kırmızı (excluded)
            return 0xffffff; // Beyaz (default)
        };

        if (object instanceof Line2) {
            const isExcluded = excludedObjectsSet.has(object);

            // ✅ ÖNCE original material'ı kaydet (excluded olsa bile!)
            if (!originalMaterials.current.has(object)) {
                const currentMat = object.material as THREE.Material;
                // Sadece excluded/selection/hover material değilse kaydet
                if (currentMat !== materials.excludedMaterial &&
                    currentMat !== materials.selectionMaterial &&
                    currentMat !== materials.hoverMaterial) {
                    if (renderer && currentMat instanceof LineMaterial) {
                        currentMat.resolution.set(renderer.domElement.width, renderer.domElement.height);
                    }
                    originalMaterials.current.set(object, currentMat);
                }
            }

            if (isExcluded) {
                if (object.material !== materials.excludedMaterial) {
                    object.material = materials.excludedMaterial;
                    if (renderer) {
                        materials.excludedMaterial.resolution.set(renderer.domElement.width, renderer.domElement.height);
                    }
                }
                return;
            }

            if (object.material !== material && material) {
                object.material = material;
                if (renderer) {
                    material.resolution.set(renderer.domElement.width, renderer.domElement.height);
                }
            }
        } else if (object instanceof THREE.Points) {
            const isExcluded = excludedObjectsSet.has(object);
            const refMat = isExcluded ? materials.pointExcludedMaterial : mapLineToPointMat(material);
            const pm = object.material as THREE.PointsMaterial;
            // Sync visual style (color/sprite) without replacing material instance → keeps size stable
            if (refMat.map && pm.map !== refMat.map) pm.map = refMat.map;
            if (!pm.transparent) pm.transparent = true;
            pm.alphaTest = 0.5;
            pm.sizeAttenuation = true;
            // Update color only
            if ((pm.color as any)?.getHex && refMat.color) {
                const targetHex = (refMat.color as any).getHex();
                if (pm.color.getHex() !== targetHex) pm.color.setHex(targetHex);
            }
            pm.needsUpdate = true;
            if (!originalMaterials.current.has(object)) {
                originalMaterials.current.set(object, pm);
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

            // ✅ ÖNCE child'ların original material'larını kaydet (excluded olsa bile!)
            object.children.forEach(child => {
                if (child instanceof Line2) {
                    if (!originalMaterials.current.has(child)) {
                        const currentMat = child.material as THREE.Material;
                        // Sadece excluded/selection/hover material değilse kaydet
                        if (currentMat !== materials.excludedMaterial &&
                            currentMat !== materials.selectionMaterial &&
                            currentMat !== materials.hoverMaterial) {
                            if (renderer && currentMat instanceof LineMaterial) {
                                currentMat.resolution.set(renderer.domElement.width, renderer.domElement.height);
                            }
                            originalMaterials.current.set(child, currentMat);
                        }
                    }
                } else if (child instanceof THREE.Points) {
                    if (!originalMaterials.current.has(child)) {
                        originalMaterials.current.set(child, child.material as THREE.Material);
                    }
                }
            });

            if (isExcluded) {
                object.children.forEach(child => {
                    if (child instanceof Line2) {
                        if (child.material !== materials.excludedMaterial) {
                            child.material = materials.excludedMaterial;
                            if (renderer) {
                                materials.excludedMaterial.resolution.set(renderer.domElement.width, renderer.domElement.height);
                            }
                        }
                    } else if (child instanceof THREE.Points) {
                        const pm = child.material as THREE.PointsMaterial;
                        const refMat = materials.pointExcludedMaterial;
                        if (refMat.map && pm.map !== refMat.map) pm.map = refMat.map;
                        pm.transparent = true;
                        pm.alphaTest = 0.5;
                        pm.sizeAttenuation = true;
                        if ((pm.color as any)?.getHex && refMat.color) {
                            const targetHex = (refMat.color as any).getHex();
                            if (pm.color.getHex() !== targetHex) pm.color.setHex(targetHex);
                        }
                        pm.needsUpdate = true;
                    }
                });
                return;
            }

            object.children.forEach(child => {
                if (child instanceof Line2) {
                    if (child.material !== material && material) {
                        child.material = material;
                        if (renderer) {
                            material.resolution.set(renderer.domElement.width, renderer.domElement.height);
                        }
                    }
                } else if (child instanceof THREE.Points) {
                    const pm = child.material as THREE.PointsMaterial;
                    const refMat = mapLineToPointMat(material);
                    if (refMat.map && pm.map !== refMat.map) pm.map = refMat.map;
                    pm.transparent = true;
                    pm.alphaTest = 0.5;
                    pm.sizeAttenuation = true;
                    if ((pm.color as any)?.getHex && refMat.color) {
                        const targetHex = (refMat.color as any).getHex();
                        if (pm.color.getHex() !== targetHex) pm.color.setHex(targetHex);
                    }
                    pm.needsUpdate = true;
                }
            });
        } else if (object instanceof THREE.Line && !(object instanceof Line2)) {
            // ✅ THREE.Line için material (boundary edges)
            const isBoundaryEdge = object.userData?.type === 'boundary_edge';

            if (isBoundaryEdge) {
                const lineMat = object.material as THREE.LineBasicMaterial;
                const isExcluded = excludedObjectsSet.has(object);

                // ✅ ÖNCE original material'i sakla (excluded olsa bile!)
                if (!originalMaterials.current.has(object)) {
                    // Sadece default renkte (beyaz) ise kaydet
                    const currentColor = lineMat.color.getHex();
                    if (currentColor === 0xffffff || currentColor === 0x008000 || currentColor === 0x00ff00) {
                        originalMaterials.current.set(object, lineMat.clone());
                    }
                }

                // Hedef rengi belirle
                const targetColor = isExcluded ? 0xff0000 : mapLineToBasicLineColor(material);

                // Rengi güncelle (sadece değiştiyse)
                if (lineMat.color.getHex() !== targetColor) {
                    lineMat.color.setHex(targetColor);
                    lineMat.needsUpdate = true;
                }
            }
        } else if (object instanceof THREE.Mesh) {
            // Mesh için material değiştirme (3D objeler için)
            const isExcluded = excludedObjectsSet.has(object);

            // ✅ ÖNCE original material'ı kaydet (excluded olsa bile!)
            if (!originalMaterials.current.has(object)) {
                const currentMat = object.material as THREE.Material;
                // Sadece excluded/selection/hover material değilse kaydet
                if (currentMat !== materials.meshExcludedMaterial &&
                    currentMat !== materials.meshSelectionMaterial &&
                    currentMat !== materials.meshHoverMaterial) {
                    originalMaterials.current.set(object, currentMat);
                }
            }

            const meshMat = isExcluded ? materials.meshExcludedMaterial : mapLineToMeshMat(material);
            if (object.material !== meshMat) {
                object.material = meshMat;
            }
        }
    }, [config.renderer, excludedObjectsSet, materials]);

    // Restore original material
    const restoreMaterial = useCallback((object: Line2 | THREE.Group | THREE.Points | THREE.Mesh | THREE.Line | null) => {
        if (!object) return;

        const objType = object.userData?.type;
        const objHandle = object.userData?.handle;

        if (object instanceof Line2) {
            const isExcluded = excludedObjectsSet.has(object);
            if (isExcluded) {
                applyMaterial(object, materials.excludedMaterial);
                return;
            }

            const originalMat = originalMaterials.current.get(object) as LineMaterial | undefined;
            
            const pickColor = object.userData.pickPlaceColor;
            const pickOpacity = object.userData.pickPlaceOpacity;
            const pickLinewidth = object.userData.pickPlaceLinewidth;
            
            if (originalMat) {
                if (pickColor !== undefined) {
                    // Özel renk istendiyse materyali clone'la
                    const isDiffColor = !object.userData._cachedPickMat || object.userData._cachedPickMat.color.getHex() !== pickColor;
                    const isDiffOpacity = object.userData._cachedPickMat && pickOpacity !== undefined && object.userData._cachedPickMat.opacity !== pickOpacity;
                    const isDiffLineWidth = object.userData._cachedPickMat && pickLinewidth !== undefined && object.userData._cachedPickMat.linewidth !== pickLinewidth;

                    if (isDiffColor || isDiffOpacity || isDiffLineWidth) {
                        const newMat = originalMat.clone();
                        newMat.color.setHex(pickColor);
                        if (pickOpacity !== undefined && pickOpacity < 1.0) {
                            newMat.transparent = true;
                            newMat.opacity = pickOpacity;
                        }
                        if (pickLinewidth !== undefined) {
                            newMat.linewidth = pickLinewidth;
                        }
                        object.userData._cachedPickMat = newMat;
                    }
                    if (object.material !== object.userData._cachedPickMat) {
                        object.material = object.userData._cachedPickMat;
                        if (config.renderer) {
                            object.userData._cachedPickMat.resolution.set(config.renderer.domElement.width, config.renderer.domElement.height);
                        }
                    }
                } else if (object.material !== originalMat) {
                    object.material = originalMat;
                    if (config.renderer) {
                        originalMat.resolution.set(config.renderer.domElement.width, config.renderer.domElement.height);
                    }
                }
            }
        } else if (object instanceof THREE.Points) {
            // Excluded ise kırmızı, değilse default renk uygula; materyali değiştirme, sadece rengi güncelle
            const isExcluded = excludedObjectsSet.has(object);
            const pm = object.material as THREE.PointsMaterial;
            const refMat = isExcluded ? materials.pointExcludedMaterial : materials.pointDefaultMaterial;
            if ((pm.color as any)?.getHex && refMat.color) {
                const targetHex = (refMat.color as any).getHex();
                const currentHex = pm.color.getHex();
                if (currentHex !== targetHex) {
                    pm.color.setHex(targetHex);
                    pm.needsUpdate = true;
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

            object.children.forEach((child, idx) => {
                if (child instanceof Line2) {
                    const originalMat = originalMaterials.current.get(child) as LineMaterial | undefined;
                    if (originalMat && child.material !== originalMat) {
                        child.material = originalMat;
                        if (config.renderer) {
                            originalMat.resolution.set(config.renderer.domElement.width, config.renderer.domElement.height);
                        }
                    }
                } else if (child instanceof THREE.Points) {
                    const pm = child.material as THREE.PointsMaterial;
                    const refMat = materials.pointDefaultMaterial;
                    if ((pm.color as any)?.getHex && refMat.color) {
                        const targetHex = (refMat.color as any).getHex();
                        const currentHex = pm.color.getHex();
                        if (currentHex !== targetHex) {
                            pm.color.setHex(targetHex);
                            pm.needsUpdate = true;
                        }
                    }
                }
            });
        } else if (object instanceof THREE.Line && !(object instanceof Line2)) {
            // ✅ THREE.Line için material restore (boundary edges)
            const isBoundaryEdge = object.userData?.type === 'boundary_edge';

            if (isBoundaryEdge) {
                const isExcluded = excludedObjectsSet.has(object);
                const lineMat = object.material as THREE.LineBasicMaterial;
                const currentColor = lineMat.color.getHex();

                if (isExcluded) {
                    // Excluded: Kırmızı
                    if (currentColor !== 0xff0000) {
                        lineMat.color.setHex(0xff0000);
                        lineMat.needsUpdate = true;
                    }
                } else {
                    // Normal: Beyaz (default)
                    if (currentColor !== 0xffffff) {
                        lineMat.color.setHex(0xffffff);
                        lineMat.needsUpdate = true;
                    }
                }
            }
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
            // Debug: userData'nın tam yapısını logla
            debug.log('[extractData] Full userData:', {
                type: ud?.type,
                layer: ud?.layer,
                handle: ud?.handle,
                hasData: !!ud?.data,
                dataKeys: ud?.data ? Object.keys(ud.data) : 'no data',
                fullUserData: ud
            });

            const sourceData = (ud && typeof ud.data === 'object' && ud.data !== null) ? ud.data : {};

            // Debug: sourceData'yı da logla
            debug.log('[extractData] sourceData extracted:', sourceData);

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
            // Center point Group'ları için özel handling
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
    }, [selectedObjectsSet, config.onSelectionChange]);

    // Update selection info when selection changes
    useEffect(() => {
        updateSelectionInfoPanel();
    }, [updateSelectionInfoPanel]);

    useEffect(() => {
        // DxfViewer.tsx'in dışarıdan trigger etmesi için hook:
        (window as any).__forceRestoreMaterial = restoreMaterial;
        return () => {
             delete (window as any).__forceRestoreMaterial;
        };
    }, [restoreMaterial]);

    // Raycasting utilities
    const raycaster = useRef(new THREE.Raycaster());
    // Varsayılan seçim eşiğini kullanıcı dostu yapmak için artır (px cinsinden)
    useEffect(() => {
        // Line ve Line2 için eşik değerleri (three raycaster NDC'den piksele çevrilen tolerans)
        // ✅ DXF Line2'ler için yüksek threshold, THREE.Line (boundary edges) için ÇOK DÜŞÜK
        raycaster.current.params.Line = { threshold: 0.5 } as any; // ✅ Çok düşük - TAM üzerine tıklaman gerekir
        (raycaster.current.params as any).Line2 = { threshold: 15 }; // DXF line'ları için yüksek
        // Points: başlangıçta küçük world-threshold; pointer hareketinde dinamik güncellenir
        raycaster.current.params.Points = { threshold: 0.5 } as any;
        debug.log('[Raycaster] Line threshold: 0.5 (boundary edges - STRICT), Line2 threshold: 15 (DXF lines)');
    }, []);
    const mouse = useRef(new THREE.Vector2());
    const endpointsCache = useRef<WeakMap<THREE.Object3D, THREE.Vector3[]>>(new WeakMap());
    const pointerMoveRAF = useRef<number | null>(null);
    const lastPointerMoveEvent = useRef<PointerEvent | null>(null);

    // Marquee selection state
    const marqueeActive = useRef(false);
    const marqueeStarted = useRef(false);
    const marqueeAdditive = useRef(false);
    const dragStartPx = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const dragCurrentPx = useRef<{ x: number, y: number }>({ x: 0, y: 0 });
    const marqueeDivRef = useRef<HTMLDivElement | null>(null);
    const DRAG_THRESHOLD_PX = 6;

    const updateMouseCoordinates = useCallback((event: PointerEvent) => {
        if (!config.viewerContainer) return;

        const rect = config.viewerContainer.getBoundingClientRect();
        mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }, [config.viewerContainer]);

    // Optimized raycast with layer filtering and bounding box pre-filtering
    const getIntersectedObjects = useCallback(() => {
        if (!config.scene || !config.camera) return [] as THREE.Intersection[];

        raycaster.current.setFromCamera(mouse.current, config.camera);
        // Dinamik Points threshold: hedef z=0 düzlemindeki world noktada ~4px yakalama
        try {
            const n = new THREE.Vector3(0, 0, 1);
            const plane = new THREE.Plane(n, 0);
            const worldPoint = new THREE.Vector3();
            const ok = raycaster.current.ray.intersectPlane(plane, worldPoint);
            if (ok) {
                const pxPerWorld = getPxPerWorldAt(worldPoint);
                const desiredPx = 4; // küçük yakalama alanı
                const worldThresh = Math.max(0.01, desiredPx / Math.max(1e-6, pxPerWorld));
                (raycaster.current.params as any).Points = { threshold: worldThresh };
            }
        } catch { }

        // Önce görünmez uç pick hacimleri (Line2’den önce; ekranda nokta yok)
        if (config.mainGroup) {
            const endpointTargets: THREE.Mesh[] = [];
            config.mainGroup.traverse((ch) => {
                if (ch instanceof THREE.Mesh && ch.userData?.isVertexEndpointPick && ch.visible) {
                    endpointTargets.push(ch);
                }
            });
            if (endpointTargets.length > 0) {
                const epHits = raycaster.current.intersectObjects(endpointTargets, false);
                if (epHits.length > 0) {
                    const parent = epHits[0].object.parent;
                    if (parent) {
                        return [{ ...epHits[0], object: parent }] as THREE.Intersection[];
                    }
                }
            }
        }

        // Get potential targets with layer and visibility filtering
        let targets: THREE.Object3D[] = [];
        if (config.mainGroup) {
            // Pre-filter by visible layers and bounding box intersection
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

                // ✅ Wireframe mode'da mesh'leri filtrele (userData.selectable = false olanları)
                if (child.userData?.selectable === false) {
                    return; // Non-selectable - raycaster'a dahil etme
                }

                // Layer-based filtering (only include visible layers)
                const layer = child.userData?.layer;
                if (layer && child.userData?.layerVisible === false) {
                    return;
                }

                // Bounding box pre-filtering for performance
                if ('geometry' in child && child.geometry) {
                    const geometry = child.geometry as THREE.BufferGeometry;
                    if (!geometry.boundingBox) {
                        geometry.computeBoundingBox();
                    }
                    const boundingBox = geometry.boundingBox;
                    if (boundingBox) {
                        // Quick frustum check - only test objects that might be in view
                        const sphere = boundingBox.getBoundingSphere(new THREE.Sphere());
                        if (sphere && config.camera) {
                            const frustum = new THREE.Frustum();
                            const matrix = new THREE.Matrix4().multiplyMatrices(
                                config.camera.projectionMatrix,
                                config.camera.matrixWorldInverse
                            );
                            frustum.setFromProjectionMatrix(matrix);

                            if (!frustum.intersectsSphere(sphere)) {
                                return;
                            }
                        }
                    }
                }

                targets.push(child);
            });

            // Note: Debug logging removed for performance
        } else if (config.scene) {
            targets = config.scene.children.filter(child =>
                child.visible &&
                !child.userData?.isHelper &&
                child.type !== 'GridHelper' &&
                child.type !== 'AxesHelper'
            );
        }

        // Limit raycast targets for performance (prioritize closest to camera)
        if (targets.length > 100) {
            // Sort by distance to camera and take closest 100
            const cameraPos = config.camera.position;
            targets.sort((a, b) => {
                const distA = a.position.distanceTo(cameraPos);
                const distB = b.position.distanceTo(cameraPos);
                return distA - distB;
            });
            targets = targets.slice(0, 100);
        }

        // 1. Normal raycast
        // ✅ recursive=true - Mesh children'ları (boundary edges) için gerekli!
        let intersects = raycaster.current.intersectObjects(targets, true);
        intersects = intersects.filter(intersect => {
            return intersect.object.visible &&
                !intersect.object.userData?.isHelper &&
                intersect.object.type !== 'GridHelper' &&
                intersect.object.type !== 'AxesHelper';
        });

        // ✅ Mesh'lere priority ver - boundary edge'lerden önce mesh'ler seçilsin
        if (intersects.length > 0) {
            // Mesh var mı? Varsa önce mesh'leri döndür
            const meshIntersects = intersects.filter(i => i.object instanceof THREE.Mesh);
            const boundaryIntersects = intersects.filter(i => i.object.userData?.type === 'boundary_edge');

            if (meshIntersects.length > 0) {
                // Mesh priority - boundary edge'leri ignore et
                return meshIntersects;
            }

            // Mesh yok, boundary edge var mı?
            if (boundaryIntersects.length > 0) {
                return boundaryIntersects;
            }

            return intersects;
        }

        // 2. Geniş eşik ile tekrar dene (yakalamayı kolaylaştır)
        const prevLine = (raycaster.current.params as any).Line?.threshold;
        const prevLine2 = (raycaster.current.params as any).Line2?.threshold;
        const prevPoints = (raycaster.current.params as any).Points?.threshold;
        (raycaster.current.params as any).Line = { threshold: 2 }; // ✅ Boundary edges için düşük (strict)
        (raycaster.current.params as any).Line2 = { threshold: 20 }; // DXF için yüksek
        // Points için genişletmeyi sınırlı tut (yakalama hala dar olsun)
        if (prevPoints !== undefined) {
            (raycaster.current.params as any).Points = { threshold: Math.min(prevPoints * 1.5, (prevPoints || 0.5) + 0.5) };
        }
        // ✅ recursive=true - Mesh children'ları için
        let wideIntersects = raycaster.current.intersectObjects(targets, true);
        wideIntersects = wideIntersects.filter(intersect => intersect.object.visible && !intersect.object.userData?.isHelper);
        // Eski değerleri geri yükle
        if (prevLine !== undefined) (raycaster.current.params as any).Line.threshold = prevLine;
        if (prevLine2 !== undefined) (raycaster.current.params as any).Line2.threshold = prevLine2;
        if (prevPoints !== undefined) (raycaster.current.params as any).Points.threshold = prevPoints;

        // ✅ Wide retry'da da mesh priority uygula
        if (wideIntersects.length > 0) {
            const meshIntersects = wideIntersects.filter(i => i.object instanceof THREE.Mesh);
            const boundaryIntersects = wideIntersects.filter(i => i.object.userData?.type === 'boundary_edge');

            if (meshIntersects.length > 0) {
                return meshIntersects as any;
            }

            if (boundaryIntersects.length > 0) {
                return boundaryIntersects as any;
            }

            return wideIntersects as any;
        }

        // 3. Piksel yakınlığına göre en yakın objeyi bul (son çare)
        if (!config.viewerContainer || !config.camera) return [] as any;
        const rect = config.viewerContainer.getBoundingClientRect();
        const pxX = (mouse.current.x + 1) * 0.5 * rect.width;
        const pxY = (1 - (mouse.current.y + 1) * 0.5) * rect.height; // ekran koordinatı

        let nearest: { obj: THREE.Object3D, distPx: number } | null = null;
        const camera = config.camera;
        const tmpV = new THREE.Vector3();
        const tmpCenter = new THREE.Vector3();
        for (const t of targets) {
            // BoundingSphere merkezi ile yaklaş
            const geom: any = (t as any).geometry;
            if (geom) {
                if (!geom.boundingSphere) {
                    try { geom.computeBoundingSphere(); } catch { }
                }
                const bs = geom.boundingSphere as THREE.Sphere | undefined;
                if (bs) {
                    tmpCenter.copy(bs.center);
                    t.localToWorld(tmpCenter);
                } else {
                    // fallback: world pozisyonu
                    tmpCenter.copy(t.position);
                    t.parent && t.parent.localToWorld(tmpCenter);
                }
            } else {
                tmpCenter.copy(t.position);
                t.parent && t.parent.localToWorld(tmpCenter);
            }
            tmpV.copy(tmpCenter).project(camera);
            const cx = (tmpV.x + 1) * 0.5 * rect.width;
            const cy = (1 - (tmpV.y + 1) * 0.5) * rect.height;
            const dx = cx - pxX;
            const dy = cy - pxY;
            const d = Math.hypot(dx, dy);
            if (!nearest || d < nearest.distPx) {
                nearest = { obj: t, distPx: d };
            }
        }
        // Sadece makul bir mesafedeyse seçilebilir say (örn. 24px)
        if (nearest && nearest.distPx <= 24) {
            return [{ object: nearest.obj }] as any;
        }

        return [] as any;
    }, [config.scene, config.camera, config.mainGroup]);

    // --- Chain selection helpers (ported) ---
    // Extract important points for connectivity checks
    const getObjectEndpoints = useCallback((obj: THREE.Object3D): THREE.Vector3[] => {
        const userData = obj.userData as any;
        const endpoints: THREE.Vector3[] = [];

        if (userData?.data) {
            // Start ve end point'leri al
            if (userData.data.startPoint) {
                endpoints.push(new THREE.Vector3(
                    userData.data.startPoint.x,
                    userData.data.startPoint.y,
                    userData.data.startPoint.z || 0
                ));
            }
            if (userData.data.endPoint) {
                endpoints.push(new THREE.Vector3(
                    userData.data.endPoint.x,
                    userData.data.endPoint.y,
                    userData.data.endPoint.z || 0
                ));
            }

            // Eğer kapalı bir şekil ise (circle gibi) center point'i ekle
            if (userData.data.center && userData.data.isClosed) {
                endpoints.push(new THREE.Vector3(
                    userData.data.center.x,
                    userData.data.center.y,
                    userData.data.center.z || 0
                ));
            }
        }

        return endpoints;
    }, []);

    // Geometric connectivity checks supporting LINE, ARC, SPLINE, CIRCLE, POLYLINE
    const areObjectsConnected = useCallback((obj1: THREE.Object3D, obj2: THREE.Object3D, tolerance: number = 0.01): boolean => {
        const userData1: any = obj1.userData;
        const userData2: any = obj2.userData;

        // Her iki objenin de userData ve data'sı var mı kontrol et
        if (!userData1?.data || !userData2?.data) {
            // debug.log(`[Connection Check] Missing userData or data for objects`);
            return false;
        }

        const data1 = userData1.data;
        const data2 = userData2.data;
        const type1 = userData1.type;
        const type2 = userData2.type;

        //  debug.log(`[Connection Check] Checking connection between ${type1} and ${type2}`);

        // Endpoint'leri al
        const endpoints1 = getObjectEndpoints(obj1);
        const endpoints2 = getObjectEndpoints(obj2);

        // debug.log(`[Connection Check] ${type1} has ${endpoints1.length} endpoints, ${type2} has ${endpoints2.length} endpoints`);

        // Temel endpoint kontrolü - Bu en güvenilir yöntem
        for (let i = 0; i < endpoints1.length; i++) {
            for (let j = 0; j < endpoints2.length; j++) {
                const point1 = endpoints1[i];
                const point2 = endpoints2[j];
                const distance = point1.distanceTo(point2);
                //debug.log(`[Connection Check] Distance between point ${i} of ${type1} (${point1.x.toFixed(3)}, ${point1.y.toFixed(3)}) and point ${j} of ${type2} (${point2.x.toFixed(3)}, ${point2.y.toFixed(3)}): ${distance.toFixed(3)}`);
                if (distance <= tolerance) {
                    //   debug.log(`[Connection Check] ✓ ${type1} and ${type2} connected via endpoints (distance: ${distance.toFixed(3)})`);
                    return true;
                }
            }
        }

        // debug.log(`[Connection Check] No endpoint connection found within tolerance ${tolerance}`);
        // Endpoint kontrolü başarısızsa gelişmiş kontrollere geç

        // Gelişmiş bağlantı kontrolleri - Arc, Line, Spline kombinasyonları

        // 1. Arc-Line bağlantısı - Gelişmiş kontrol
        if ((type1 === 'ARC' && type2 === 'LINE') || (type1 === 'LINE' && type2 === 'ARC')) {
            const arcData = type1 === 'ARC' ? data1 : data2;
            const lineData = type1 === 'LINE' ? data1 : data2;
            const arcType = type1 === 'ARC' ? type1 : type2;
            const lineType = type1 === 'LINE' ? type1 : type2;

            //  debug.log(`[Connection Check] Checking Arc-Line connection`);
            //debug.log(`[Connection Check] Arc data:`, arcData);
            //debug.log(`[Connection Check] Line data:`, lineData);

            // Önce endpoint kontrolü yap (daha güvenilir)
            if (arcData.startPoint && arcData.endPoint && lineData.startPoint && lineData.endPoint) {
                const arcStart = new THREE.Vector3(arcData.startPoint.x, arcData.startPoint.y, arcData.startPoint.z || 0);
                const arcEnd = new THREE.Vector3(arcData.endPoint.x, arcData.endPoint.y, arcData.endPoint.z || 0);
                const lineStart = new THREE.Vector3(lineData.startPoint.x, lineData.startPoint.y, lineData.startPoint.z || 0);
                const lineEnd = new THREE.Vector3(lineData.endPoint.x, lineData.endPoint.y, lineData.endPoint.z || 0);

                const connections = [
                    { dist: arcStart.distanceTo(lineStart), desc: 'arc start - line start' },
                    { dist: arcStart.distanceTo(lineEnd), desc: 'arc start - line end' },
                    { dist: arcEnd.distanceTo(lineStart), desc: 'arc end - line start' },
                    { dist: arcEnd.distanceTo(lineEnd), desc: 'arc end - line end' }
                ];

                for (const conn of connections) {
                    //  debug.log(`[Connection Check] ${conn.desc}: ${conn.dist.toFixed(3)}`);
                    if (conn.dist <= tolerance) {
                        //   debug.log(`[Connection Check] ✓ Arc and Line connected via endpoints (${conn.desc})`);
                        return true;
                    }
                }
            }

            // Radius kontrolü (ek kontrol)
            if (arcData.center && arcData.radius && lineData.startPoint && lineData.endPoint) {
                const arcCenter = new THREE.Vector3(arcData.center.x, arcData.center.y, arcData.center.z || 0);
                const lineStart = new THREE.Vector3(lineData.startPoint.x, lineData.startPoint.y, lineData.startPoint.z || 0);
                const lineEnd = new THREE.Vector3(lineData.endPoint.x, lineData.endPoint.y, lineData.endPoint.z || 0);

                // Line'ın endpoint'lerinin arc üzerinde olup olmadığını kontrol et
                const distToStart = arcCenter.distanceTo(lineStart);
                const distToEnd = arcCenter.distanceTo(lineEnd);

                //  debug.log(`[Connection Check] Arc center to line start: ${distToStart.toFixed(3)}, radius: ${arcData.radius}`);
                // debug.log(`[Connection Check] Arc center to line end: ${distToEnd.toFixed(3)}, radius: ${arcData.radius}`);

                if (Math.abs(distToStart - arcData.radius) <= tolerance ||
                    Math.abs(distToEnd - arcData.radius) <= tolerance) {
                    //   debug.log(`[Connection Check] ✓ Arc and Line connected via radius check`);
                    return true;
                }
            }
        }

        // 2. Spline-Line bağlantısı
        if ((type1 === 'SPLINE' && type2 === 'LINE') || (type1 === 'LINE' && type2 === 'SPLINE')) {
            // Spline'ın control point'leri varsa onları da kontrol et
            const splineData = type1 === 'SPLINE' ? data1 : data2;
            const lineData = type1 === 'LINE' ? data1 : data2;

            if (splineData.controlPoints && lineData.startPoint && lineData.endPoint) {
                const lineStart = new THREE.Vector3(lineData.startPoint.x, lineData.startPoint.y, lineData.startPoint.z || 0);
                const lineEnd = new THREE.Vector3(lineData.endPoint.x, lineData.endPoint.y, lineData.endPoint.z || 0);

                // Spline'ın control point'leri ile line endpoint'lerini karşılaştır
                for (const controlPoint of splineData.controlPoints) {
                    const cpVec = new THREE.Vector3(controlPoint.x, controlPoint.y, controlPoint.z || 0);
                    if (cpVec.distanceTo(lineStart) <= tolerance || cpVec.distanceTo(lineEnd) <= tolerance) {
                        //   debug.log(`[Connection Check] Spline and Line connected via control points`);
                        return true;
                    }
                }
            }
        }

        // 3. Arc-Spline bağlantısı
        if ((type1 === 'ARC' && type2 === 'SPLINE') || (type1 === 'SPLINE' && type2 === 'ARC')) {
            const arcData = type1 === 'ARC' ? data1 : data2;
            const splineData = type1 === 'SPLINE' ? data1 : data2;

            // Önce endpoint kontrolü yap
            if (arcData.startPoint && arcData.endPoint && splineData.controlPoints) {
                const arcStart = new THREE.Vector3(arcData.startPoint.x, arcData.startPoint.y, arcData.startPoint.z || 0);
                const arcEnd = new THREE.Vector3(arcData.endPoint.x, arcData.endPoint.y, arcData.endPoint.z || 0);

                // Spline'ın ilk ve son control point'leriyle arc'ın endpoint'lerini karşılaştır
                const splineStart = new THREE.Vector3(splineData.controlPoints[0].x, splineData.controlPoints[0].y, splineData.controlPoints[0].z || 0);
                const splineEnd = new THREE.Vector3(splineData.controlPoints[splineData.controlPoints.length - 1].x, splineData.controlPoints[splineData.controlPoints.length - 1].y, splineData.controlPoints[splineData.controlPoints.length - 1].z || 0);

                if (arcStart.distanceTo(splineStart) <= tolerance || arcStart.distanceTo(splineEnd) <= tolerance ||
                    arcEnd.distanceTo(splineStart) <= tolerance || arcEnd.distanceTo(splineEnd) <= tolerance) {
                    //    debug.log(`[Connection Check] Arc and Spline connected via endpoints`);
                    return true;
                }
            }

            // Radius kontrolü de yap (ek kontrol)
            if (arcData.center && arcData.radius && splineData.controlPoints) {
                const arcCenter = new THREE.Vector3(arcData.center.x, arcData.center.y, arcData.center.z || 0);

                // Spline'ın control point'lerinin arc üzerinde olup olmadığını kontrol et
                for (const controlPoint of splineData.controlPoints) {
                    const cpVec = new THREE.Vector3(controlPoint.x, controlPoint.y, controlPoint.z || 0);
                    const distToCP = arcCenter.distanceTo(cpVec);

                    if (Math.abs(distToCP - arcData.radius) <= tolerance) {
                        //    debug.log(`[Connection Check] Arc and Spline connected via radius and control points`);
                        return true;
                    }
                }
            }
        }

        // 4. Polyline ve diğer türler için vertex kontrolü
        if (data1.vertices && data2.vertices) {
            // Her iki objede de vertex varsa, vertex'leri karşılaştır
            for (const vertex1 of data1.vertices) {
                for (const vertex2 of data2.vertices) {
                    const v1 = new THREE.Vector3(vertex1.x, vertex1.y, vertex1.z || 0);
                    const v2 = new THREE.Vector3(vertex2.x, vertex2.y, vertex2.z || 0);
                    if (v1.distanceTo(v2) <= tolerance) {
                        //   debug.log(`[Connection Check] ${type1} and ${type2} connected via vertices`);
                        return true;
                    }
                }
            }
        }

        // 5. Circle-Line teğet ve kesişim kontrolü
        if ((type1 === 'CIRCLE' && type2 === 'LINE') || (type1 === 'LINE' && type2 === 'CIRCLE')) {
            const circleData = type1 === 'CIRCLE' ? data1 : data2;
            const lineData = type1 === 'LINE' ? data1 : data2;

            if (circleData.center && circleData.radius && lineData.startPoint && lineData.endPoint) {
                const circleCenter = new THREE.Vector3(circleData.center.x, circleData.center.y, circleData.center.z || 0);
                const lineStart = new THREE.Vector3(lineData.startPoint.x, lineData.startPoint.y, lineData.startPoint.z || 0);
                const lineEnd = new THREE.Vector3(lineData.endPoint.x, lineData.endPoint.y, lineData.endPoint.z || 0);

                // 1. Line'ın endpoint'lerinin circle üzerinde olup olmadığını kontrol et
                const distToStart = circleCenter.distanceTo(lineStart);
                const distToEnd = circleCenter.distanceTo(lineEnd);

                if (Math.abs(distToStart - circleData.radius) <= tolerance ||
                    Math.abs(distToEnd - circleData.radius) <= tolerance) {
                    //     debug.log(`[Connection Check] Circle and Line connected via endpoint on circle`);
                    return true;
                }

                // 2. Line'dan circle center'a olan mesafeyi hesapla (teğet kontrolü)
                const lineDir = lineEnd.clone().sub(lineStart).normalize();
                const centerToStart = lineStart.clone().sub(circleCenter);
                const projection = centerToStart.dot(lineDir);

                // Projection'ın line segment içinde olup olmadığını kontrol et
                const lineLength = lineStart.distanceTo(lineEnd);
                if (projection >= 0 && projection <= lineLength) {
                    const closestPoint = lineStart.clone().add(lineDir.multiplyScalar(projection));
                    const distToLine = circleCenter.distanceTo(closestPoint);

                    // Teğet veya kesişim kontrolü
                    if (Math.abs(distToLine - circleData.radius) <= tolerance) {
                        //      debug.log(`[Connection Check] Circle and Line connected via tangent/intersection`);
                        return true;
                    }
                }

                // 3. Gerçek kesişim kontrolü - sadece line circle'ı gerçekten kesiyorsa
                // Line'ın bir endpoint'i circle içinde, diğeri dışında olmalı veya
                // Line circle'a teğet olmalı (yukarıda kontrol edildi)
                const startInside = distToStart <= circleData.radius;
                const endInside = distToEnd <= circleData.radius;

                // Sadece line circle'ı gerçekten kesiyorsa bağlantı var
                if ((startInside && !endInside) || (!startInside && endInside)) {
                    //     debug.log(`[Connection Check] Circle and Line connected via intersection`);
                    return true;
                }

                // Her iki endpoint de circle üzerindeyse (teğet durumu)
                if (Math.abs(distToStart - circleData.radius) <= tolerance &&
                    Math.abs(distToEnd - circleData.radius) <= tolerance) {
                    //       debug.log(`[Connection Check] Circle and Line connected via both endpoints on circle`);
                    return true;
                }
            }
        }

        return false; // Hiçbir bağlantı bulunamadı
    }, [getObjectEndpoints]);

    const findConnectedObjects = useCallback((
        startObject: THREE.Object3D,
        allObjects: THREE.Object3D[],
        targetType?: string,
        targetSubType?: string,
        tolerance: number = 0.01
    ): Set<THREE.Object3D> => {
        const connected = new Set<THREE.Object3D>();
        const toCheck = [startObject];
        const checked = new Set<THREE.Object3D>();

        //   debug.log(`[Connected Search] Starting search from ${startObject.userData?.type || 'Unknown'} object`);
        //  debug.log(`[Connected Search] Target type: ${targetType || 'Any'}, SubType: ${targetSubType || 'Any'}`);
        //  debug.log(`[Connected Search] Available objects: ${allObjects.length}`);

        while (toCheck.length > 0) {
            const currentObj = toCheck.pop()!;
            if (checked.has(currentObj)) continue;

            checked.add(currentObj);
            connected.add(currentObj);

            const currentType = currentObj.userData?.type;
            //   debug.log(`[Connected Search] Checking connections for ${currentType} object (${connected.size} found so far)`);

            // Bu objeye bağlı diğer objeleri bul
            for (const otherObj of allObjects) {
                if (checked.has(otherObj) || otherObj === currentObj) continue;
                if (excludedObjectsSet.has(otherObj)) continue; // Dışlanmış objeleri atla

                const otherType = otherObj.userData?.type;

                // Tür kontrolü kaldırıldı - farklı türden objeler arasında zincir seçim yapılabilir
                // Sadece CENTER_POINT'ler için özel kontrol
                if (targetType === 'CENTER_POINT' && otherType !== 'CENTER_POINT') continue;
                if (targetType !== 'CENTER_POINT' && otherType === 'CENTER_POINT') continue;

                // Geometrik bağlantı kontrolü - Gelişmiş arc/line/spline desteği
                if (areObjectsConnected(currentObj, otherObj, tolerance)) {
                    //       debug.log(`[Connected Search] Found connection: ${currentType} ↔ ${otherType}`);
                    if (!checked.has(otherObj)) {
                        toCheck.push(otherObj);
                    }
                }
            }
        }

        //debug.log(`[Connected Search] Search completed. Found ${connected.size} connected objects`);
        return connected;
    }, [areObjectsConnected, excludedObjectsSet]);

    const selectConnected = useCallback((targetObject: THREE.Object3D, additive: boolean) => {
        debug.log(`[Select Connected] Starting chain selection for ${targetObject.userData?.type}`);
        const mainGroup = config.mainGroup;
        if (!mainGroup) {
            debug.log(`[Select Connected] No mainGroup found`);
            return;
        }

        // Candidate objects: geometry entities, exclude helpers/center points
        const geometryTypes = new Set(['LINE', 'ARC', 'SPLINE', 'CIRCLE', 'POLYLINE', 'LWPOLYLINE']);
        const candidates: THREE.Object3D[] = [];
        mainGroup.children.forEach(obj => {
            const t = (obj.userData as any)?.type;
            const isCenter = (obj.userData as any)?.isCenterPointGroup || (obj.userData as any)?.isPointGroup;
            if (!isCenter && geometryTypes.has(t)) {
                candidates.push(obj);
            }
        });

        debug.log(`[Select Connected] Found ${candidates.length} candidate objects`);
        debug.log(`[Select Connected] Target object type: ${targetObject.userData?.type}`);

        const connectedSet = findConnectedObjects(targetObject, candidates, undefined, undefined, 0.01); // Optimized tolerance for precise connection detection
        debug.log(`[Select Connected] Connected objects found: ${connectedSet.size}`);

        if (connectedSet.size === 0) {
            debug.log(`[Select Connected] No connected objects found, aborting`);
            return;
        }

        let finalSelection = additive ? new Set(selectedObjectsSet) : new Set<THREE.Object3D>();
        connectedSet.forEach(o => finalSelection.add(o));
        debug.log(`[Select Connected] Final selection size: ${finalSelection.size}`);
        updateSelection(finalSelection);
    }, [config.mainGroup, findConnectedObjects, selectedObjectsSet, updateSelection]);

    // Select all objects of the same type
    const selectAllOfType = useCallback((targetType: string, additive: boolean) => {
        debug.log(`[Select All Of Type] Selecting all ${targetType} objects`);
        const mainGroup = config.mainGroup;
        if (!mainGroup) {
            debug.log(`[Select All Of Type] No mainGroup found`);
            return;
        }

        const objectsOfType: THREE.Object3D[] = [];
        mainGroup.children.forEach(obj => {
            const objType = (obj.userData as any)?.type;
            if (objType === targetType) {
                objectsOfType.push(obj);
            }
        });

        debug.log(`[Select All Of Type] Found ${objectsOfType.length} objects of type ${targetType}`);

        if (objectsOfType.length === 0) {
            debug.log(`[Select All Of Type] No objects found, aborting`);
            return;
        }

        let finalSelection = additive ? new Set(selectedObjectsSet) : new Set<THREE.Object3D>();
        objectsOfType.forEach(obj => finalSelection.add(obj));
        debug.log(`[Select All Of Type] Final selection size: ${finalSelection.size}`);
        updateSelection(finalSelection);
    }, [config.mainGroup, selectedObjectsSet, updateSelection]);

    // Select all center points with the same parent type
    const selectSameParentPoints = useCallback((targetObject: THREE.Object3D, additive: boolean) => {
        debug.log(`[Select Same Parent Points] Selecting center points with same parent type`);
        const mainGroup = config.mainGroup;
        if (!mainGroup) {
            debug.log(`[Select Same Parent Points] No mainGroup found`);
            return;
        }

        const targetParentType = targetObject.userData?.data?.parentType;
        if (!targetParentType) {
            debug.log(`[Select Same Parent Points] Target object has no parentType, falling back to type selection`);
            selectAllOfType(targetObject.userData?.type || 'POINT', additive);
            return;
        }

        const sameParentTypePoints: THREE.Object3D[] = [];
        mainGroup.children.forEach(obj => {
            const objType = (obj.userData as any)?.type;
            const objParentType = (obj.userData as any)?.data?.parentType;

            // Aynı parent type'a sahip POINT tipindeki objeler
            if (objType === 'POINT' && objParentType === targetParentType) {
                sameParentTypePoints.push(obj);
            }
        });

        debug.log(`[Select Same Parent Points] Found ${sameParentTypePoints.length} center points with parent type: ${targetParentType}`);

        if (sameParentTypePoints.length === 0) {
            debug.log(`[Select Same Parent Points] No same parent type points found, aborting`);
            return;
        }

        let finalSelection = additive ? new Set(selectedObjectsSet) : new Set<THREE.Object3D>();
        sameParentTypePoints.forEach((obj: THREE.Object3D) => finalSelection.add(obj));
        debug.log(`[Select Same Parent Points] Final selection size: ${finalSelection.size}`);
        updateSelection(finalSelection);
    }, [config.mainGroup, selectedObjectsSet, updateSelection, selectAllOfType]);

    // Exclude all connected objects (mixed types allowed)
    const excludeConnected = useCallback((targetObject: THREE.Object3D) => {
        debug.log(`[Exclude Connected] Starting chain exclusion for ${targetObject.userData?.type}`);
        const mainGroup = config.mainGroup;
        if (!mainGroup) {
            debug.log(`[Exclude Connected] No mainGroup found`);
            return;
        }

        const geometryTypes = new Set(['LINE', 'ARC', 'SPLINE', 'CIRCLE', 'POLYLINE', 'LWPOLYLINE']);
        const candidates: THREE.Object3D[] = [];
        mainGroup.children.forEach(obj => {
            const t = (obj.userData as any)?.type;
            const isCenter = (obj.userData as any)?.isCenterPointGroup || (obj.userData as any)?.isPointGroup;
            if (!isCenter && geometryTypes.has(t)) {
                candidates.push(obj);
            }
        });

        debug.log(`[Exclude Connected] Found ${candidates.length} candidate objects`);

        const connectedSet = findConnectedObjects(targetObject, candidates, undefined, undefined, 0.01);
        debug.log(`[Exclude Connected] Connected objects found: ${connectedSet.size}`);

        if (connectedSet.size === 0) {
            // Fallback to excluding only the target
            debug.log(`[Exclude Connected] No connected objects found, excluding only target`);
            excludeObj(targetObject);
            return;
        }

        // ✅ Tüm bağlı objeleri tek seferde exclude et (batch update)
        excludeObjects(connectedSet);
        debug.log(`[Exclude Connected] Batch exclusion completed for ${connectedSet.size} objects`);
    }, [config.mainGroup, findConnectedObjects, excludeObj, excludeObjects]);

    // Select connected objects of same type (mixed types allowed for geometry)
    const selectConnectedSameType = useCallback((targetObject: THREE.Object3D) => {
        const mainGroup = config.mainGroup;
        if (!mainGroup) return;

        // Hedef objenin türünü belirle
        const targetType = targetObject.userData?.type;
        const targetSubType = targetObject.userData?.subType;

        if (!targetType) {
            debug.warn('[Double Right Click] Target object has no type, falling back to single select');
            const newSelection = new Set([targetObject]);
            updateSelection(newSelection);
            return;
        }

        debug.log(`[Double Right Click] Selecting connected objects starting from: ${targetType}${targetSubType ? ` (${targetSubType})` : ''}`);

        // TÜM objeleri dahil et (sadece aynı türdeki değil) - Arc, Line, Spline birbirine bağlanabilir
        // CENTER_POINT'ler bağlı olamaz, onları çıkar
        const allCandidateObjects: THREE.Object3D[] = [];
        const geometryTypes = ['LINE', 'ARC', 'SPLINE', 'CIRCLE', 'POLYLINE', 'LWPOLYLINE'];

        mainGroup.children.forEach(obj => {
            if (excludedObjectsSet.has(obj)) return; // Zaten exclude edilmiş objeleri atla

            const objType = obj.userData?.type;

            // Sadece geometrik objeler dahil et - CENTER_POINT'leri çıkar çünkü bağlı olamazlar
            if (geometryTypes.includes(objType)) {
                allCandidateObjects.push(obj);
            }
        });

        debug.log(`[Double Right Click] Total candidate objects for selection: ${allCandidateObjects.length}`);

        // Bağlı objeleri bul - TÜR KISITLAMASI YOK (farklı türler birbirine bağlanabilir)
        const connectedObjects = findConnectedObjects(
            targetObject,
            allCandidateObjects
            // targetType ve targetSubType parametrelerini kaldırdık
        );

        debug.log(`[Double Right Click] Found ${connectedObjects.size} connected objects to select (mixed types allowed)`);

        // Seçimi güncelle
        updateSelection(connectedObjects);
    }, [config.mainGroup, findConnectedObjects, excludedObjectsSet, updateSelection]);

    // --- End chain selection helpers ---

    // Event handlers
    const handlePointerDown = useCallback((event: PointerEvent) => {
        if (!config.viewerContainer || !config.scene || !config.camera) return;

        // ✅ Kamera hareket ederken tıklama yapma (camera controls aktif)
        if (config.isCameraMoving) {
            return;
        }

        updateMouseCoordinates(event);
        const intersects = getIntersectedObjects();

        if (event.button === 0) { // Left click
            // Başlangıç drag durumunu kaydet (marquee)
            const rect = config.viewerContainer.getBoundingClientRect();
            dragStartPx.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            dragCurrentPx.current = { ...dragStartPx.current };
            marqueeActive.current = true;
            marqueeStarted.current = false;
            marqueeAdditive.current = !!(event.ctrlKey || event.metaKey);

            if (intersects.length > 0) {
                let selectedObject = intersects[0].object as THREE.Object3D;

                // If part of a center/point group, use the parent group
                if (selectedObject.parent &&
                    (selectedObject.parent.userData?.isCenterPointGroup ||
                        selectedObject.parent.userData?.isPointGroup)) {
                    selectedObject = selectedObject.parent;
                }

                // Double-click detection: same object within delay
                const now = performance.now();
                const isSame = lastClickedObject.current === selectedObject;
                const timeDiff = now - lastClickTime.current;
                const isDouble = isSame && timeDiff <= doubleClickDelay;

                debug.log(`[Double Click Debug] Object: ${selectedObject.userData?.type}, Same: ${isSame}, TimeDiff: ${timeDiff}ms, IsDouble: ${isDouble}`);

                lastClickTime.current = now;
                lastClickedObject.current = selectedObject;

                if (isDouble) {
                    const objectType = selectedObject.userData?.type;
                    debug.log(`[Double Click] Triggered for ${objectType}`);

                    // Special handling for POINT type (center points)
                    if (objectType === 'POINT' && selectedObject.userData?.data?.isVertexPoint) {
                        setWasObjectClicked(true);
                        return;
                    }

                    if (objectType === 'POINT') {
                        const parentHandle = selectedObject.userData?.data?.parentHandle;
                        if (parentHandle) {
                            debug.log(`[Double Click] Selecting center points with same parent: ${parentHandle}`);
                            selectSameParentPoints(selectedObject, true);
                        } else {
                            debug.log(`[Double Click] Selecting all POINT objects`);
                            selectAllOfType(objectType, true);
                        }
                    } else if (objectType === 'CENTER_POINT' || objectType === 'CIRCLE') {
                        debug.log(`[Double Click] Selecting all ${objectType} objects`);
                        selectAllOfType(objectType, true);
                    } else {
                        debug.log(`[Double Click] Triggered chain selection for ${objectType}`);
                        // Additively select connected chain
                        selectConnected(selectedObject, true);
                    }
                    setWasObjectClicked(true);
                    return; // Skip normal toggle/select on double click
                }

                const newSelection = new Set(selectedObjectsSet);

                if (event.ctrlKey || event.metaKey) {
                    if (newSelection.has(selectedObject)) {
                        newSelection.delete(selectedObject);
                    } else {
                        newSelection.add(selectedObject);
                    }
                } else {
                    newSelection.clear();
                    newSelection.add(selectedObject);
                }

                updateSelection(newSelection);
                setWasObjectClicked(true);
            } else {
                setWasObjectClicked(false);
            }
        }
    }, [config.viewerContainer, config.scene, config.camera, config.isCameraMoving, selectedObjectsSet, updateSelection, clearSelection, updateMouseCoordinates, getIntersectedObjects, doubleClickDelay, selectConnected]);

    const handlePointerMove = useCallback((event: PointerEvent) => {
        if (!config.viewerContainer) return;

        // ✅ Kamera hareket ederken hover yapma ve cursor'u gizle
        if (config.isCameraMoving) {
            // Hovered object'i temizle
            if (hoveredObject) {
                restoreMaterial(hoveredObject as any);
                setHoveredObject(null);
            }
            // Cursor'u gizle
            if (config.viewerContainer) {
                config.viewerContainer.style.cursor = 'none';
            }
            return;
        } else {
            // Kamera durduğunda cursor'u göster
            if (config.viewerContainer && config.viewerContainer.style.cursor === 'none') {
                config.viewerContainer.style.cursor = 'default';
            }
        }

        // Store latest event and schedule RAF if not already scheduled
        lastPointerMoveEvent.current = event;
        if (pointerMoveRAF.current !== null) return;

        pointerMoveRAF.current = requestAnimationFrame(() => {
            const e = lastPointerMoveEvent.current as PointerEvent;
            pointerMoveRAF.current = null;
            if (!e) return;



            updateMouseCoordinates(e);
            const rect = config.viewerContainer!.getBoundingClientRect();
            const curPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            dragCurrentPx.current = curPx;

            // Marquee overlay yönetimi
            if (marqueeActive.current) {
                const dx = Math.abs(dragCurrentPx.current.x - dragStartPx.current.x);
                const dy = Math.abs(dragCurrentPx.current.y - dragStartPx.current.y);
                const movedEnough = dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX;

                if (movedEnough && !marqueeStarted.current) {
                    // Overlay oluştur
                    const div = document.createElement('div');
                    div.style.position = 'absolute';
                    div.style.pointerEvents = 'none';
                    div.style.border = '1px dashed rgba(74, 222, 128, 0.9)'; // green-400
                    div.style.background = 'rgba(74, 222, 128, 0.12)';
                    div.style.zIndex = '9999';
                    marqueeDivRef.current = div;
                    config.viewerContainer!.appendChild(div);
                    marqueeStarted.current = true;
                }

                if (marqueeStarted.current && marqueeDivRef.current) {
                    const x1 = Math.min(dragStartPx.current.x, dragCurrentPx.current.x);
                    const y1 = Math.min(dragStartPx.current.y, dragCurrentPx.current.y);
                    const x2 = Math.max(dragStartPx.current.x, dragCurrentPx.current.x);
                    const y2 = Math.max(dragStartPx.current.y, dragCurrentPx.current.y);
                    marqueeDivRef.current.style.left = `${x1}px`;
                    marqueeDivRef.current.style.top = `${y1}px`;
                    marqueeDivRef.current.style.width = `${x2 - x1}px`;
                    marqueeDivRef.current.style.height = `${y2 - y1}px`;
                }

                // Marquee aktifken hover işlemlerini atla
                return;
            }
            const intersects = getIntersectedObjects();
            // Pointer hareketinde center point boyutlarını güncelle (ekran ölçeğine göre)
            adjustCenterPointSizes();

            if (intersects.length > 0) {
                let newHovered = intersects[0].object;

                // Check if the hovered object is part of a group (center point or point group)
                if (newHovered.parent &&
                    (newHovered.parent.userData?.isCenterPointGroup ||
                        newHovered.parent.userData?.isPointGroup)) {
                    newHovered = newHovered.parent;
                }

                if (newHovered !== hoveredObject) {
                    if (hoveredObject && !selectedObjectsSet.has(hoveredObject) && !excludedObjectsSet.has(hoveredObject)) {
                        restoreMaterial(hoveredObject as any);
                    }
                    setHoveredObject(newHovered);
                    if (!selectedObjectsSet.has(newHovered) && !excludedObjectsSet.has(newHovered)) {
                        applyMaterial(newHovered as any, materials.hoverMaterial);
                    }
                }
                if (config.viewerContainer) {
                    config.viewerContainer.style.cursor = newHovered.userData?.isVertexEndpointGroup ? 'crosshair' : 'default';
                }
            } else {
                if (hoveredObject && !selectedObjectsSet.has(hoveredObject) && !excludedObjectsSet.has(hoveredObject)) {
                    restoreMaterial(hoveredObject as any);
                }
                setHoveredObject(null);
                if (config.viewerContainer) {
                    config.viewerContainer.style.cursor = 'default';
                }
            }
        });
    }, [config.viewerContainer, config.isCameraMoving, hoveredObject, selectedObjectsSet, excludedObjectsSet, updateMouseCoordinates, getIntersectedObjects, restoreMaterial, applyMaterial, materials.hoverMaterial, adjustCenterPointSizes]);

    const handlePointerUp = useCallback((event: PointerEvent) => {
        if (!config.viewerContainer || !config.camera || !config.mainGroup) return;

        // Marquee finalize
        if (marqueeActive.current) {
            const wasDrag = marqueeStarted.current;

            // Overlay temizle
            if (marqueeDivRef.current) {
                try { config.viewerContainer.removeChild(marqueeDivRef.current); } catch { }
                marqueeDivRef.current = null;
            }

            marqueeActive.current = false;
            marqueeStarted.current = false;

            if (!wasDrag) {
                return; // Drag yoksa normal click akışı geçerlidir
            }

            const rect = config.viewerContainer.getBoundingClientRect();
            const x1 = Math.min(dragStartPx.current.x, dragCurrentPx.current.x);
            const y1 = Math.min(dragStartPx.current.y, dragCurrentPx.current.y);
            const x2 = Math.max(dragStartPx.current.x, dragCurrentPx.current.x);
            const y2 = Math.max(dragStartPx.current.y, dragCurrentPx.current.y);

            const pxContains = (px: { x: number, y: number }) => (px.x >= x1 && px.x <= x2 && px.y >= y1 && px.y <= y2);

            const projectToPx = (v: THREE.Vector3): { x: number, y: number } => {
                const p = v.clone().project(config.camera!);
                const px = (p.x + 1) * 0.5 * rect.width;
                const py = (1 - (p.y + 1) * 0.5) * rect.height;
                return { x: px, y: py };
            };

            const mainGroup = config.mainGroup;
            const geometryTypes = new Set(['LINE', 'ARC', 'SPLINE', 'CIRCLE', 'POLYLINE', 'LWPOLYLINE']);
            const candidates: THREE.Object3D[] = [];
            mainGroup.children.forEach(obj => {
                const t = (obj.userData as any)?.type;
                const ud: any = obj.userData || {};
                const isCenter = ud.isCenterPointGroup || (ud.isPointGroup && !ud.isVertexEndpointGroup);
                const isVertexSnap = ud.isVertexEndpointGroup && ud.data?.isVertexPoint;
                if (!isCenter && (geometryTypes.has(t) || isVertexSnap)) {
                    candidates.push(obj);
                }
            });

            // Mesh objelerini de candidate'lere ekle
            mainGroup.traverse((obj) => {
                if (obj instanceof THREE.Mesh && !candidates.includes(obj)) {
                    const isCenter = (obj.userData as any)?.isCenterPointGroup || (obj.userData as any)?.isPointGroup;
                    if (!isCenter) {
                        candidates.push(obj);
                    }
                }
            });

            const getTestPoints = (obj: THREE.Object3D): THREE.Vector3[] => {
                const pts: THREE.Vector3[] = [];

                // Mesh ise bounding box köşelerini test et
                if (obj instanceof THREE.Mesh && obj.geometry) {
                    obj.geometry.computeBoundingBox();
                    const bbox = obj.geometry.boundingBox;
                    if (bbox) {
                        // Bounding box'ın 8 köşesini test et
                        const corners = [
                            new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
                            new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
                            new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
                            new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
                            new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
                            new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
                            new THREE.Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
                            new THREE.Vector3(bbox.max.x, bbox.max.y, bbox.max.z),
                        ];
                        // World space'e dönüştür
                        corners.forEach(corner => {
                            pts.push(corner.applyMatrix4(obj.matrixWorld));
                        });
                        return pts;
                    }
                }

                // DXF geometrileri için orijinal kod
                const ud: any = obj.userData || {};
                const d: any = ud.data || {};
                if (d.startPoint && d.endPoint) {
                    pts.push(new THREE.Vector3(d.startPoint.x, d.startPoint.y, d.startPoint.z || 0));
                    pts.push(new THREE.Vector3(d.endPoint.x, d.endPoint.y, d.endPoint.z || 0));
                } else if (d.points && Array.isArray(d.points) && d.points.length > 0) {
                    // spline örneklenmiş noktalarından uçları kullan
                    const first = d.points[0];
                    const last = d.points[d.points.length - 1];
                    pts.push(new THREE.Vector3(first.x, first.y, first.z || 0));
                    pts.push(new THREE.Vector3(last.x, last.y, last.z || 0));
                } else if (d.center) {
                    pts.push(new THREE.Vector3(d.center.x, d.center.y, d.center.z || 0));
                } else if (d.isVertexPoint && d.point) {
                    const p = d.point;
                    pts.push(new THREE.Vector3(p.x, p.y, p.z || 0));
                }
                return pts;
            };

            const newlySelected = new Set<THREE.Object3D>();
            candidates.forEach(obj => {
                if (excludedObjectsSet.has(obj)) return;
                const pts = getTestPoints(obj);
                if (pts.length === 0) return;
                for (const w of pts) {
                    const px = projectToPx(w);
                    if (pxContains(px)) {
                        newlySelected.add(obj);
                        break;
                    }
                }
            });

            if (newlySelected.size > 0) {
                let finalSelection = marqueeAdditive.current ? new Set(selectedObjectsSet) : new Set<THREE.Object3D>();
                newlySelected.forEach(o => finalSelection.add(o));
                updateSelection(finalSelection);
            }
        }
    }, [config.viewerContainer, config.camera, config.mainGroup, excludedObjectsSet, selectedObjectsSet, updateSelection]);

    const handleContextMenu = useCallback((event: MouseEvent) => {
        event.preventDefault();

        // ✅ Kamera hareket ederken right-click yapma
        if (config.isCameraMoving) {
            return;
        }

        updateMouseCoordinates(event as any);
        const intersects = getIntersectedObjects();

        if (intersects.length > 0) {
            let targetObject = intersects[0].object as THREE.Object3D;

            // Check if the target object is part of a group (center point or point group)
            if (targetObject.parent &&
                (targetObject.parent.userData?.isCenterPointGroup ||
                    targetObject.parent.userData?.isPointGroup)) {
                targetObject = targetObject.parent;
            }

            // Double right-click detection
            const now = performance.now();
            const isSame = lastRightClickedObject.current === targetObject;
            const isDouble = isSame && (now - lastRightClickTime.current) <= doubleClickDelay;
            lastRightClickTime.current = now;
            lastRightClickedObject.current = targetObject;

            if (isDouble) {
                // Double right-click: Exclude all connected objects (mixed types)
                excludeConnected(targetObject);
                return;
            }

            // Single right-click: exclude only target
            excludeObj(targetObject);
        }
    }, [config.isCameraMoving, updateMouseCoordinates, getIntersectedObjects, excludeObj, excludeConnected, selectConnectedSameType, doubleClickDelay]);

    const handleKeyDown = useCallback((event: KeyboardEvent) => {
        switch (event.key.toLowerCase()) {
            case 'escape':
                // Sadece seçimleri temizle; modal kapanışını üst seviye engelliyor
                clearSelection();
                break;
            case 'a':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    if (config.scene) {
                        const allObjects = new Set<THREE.Object3D>();
                        config.scene.traverse((object) => {
                            if (object.visible &&
                                !object.userData?.isHelper &&
                                object.type !== 'GridHelper' &&
                                object.type !== 'AxesHelper' &&
                                (object as any).geometry) {
                                allObjects.add(object);
                            }
                        });
                        updateSelection(allObjects);
                    }
                }
                break;
            default:
                break;
        }
    }, [config.scene, updateSelection, clearSelection]);

    // Setup event listeners
    useEffect(() => {
        if (!config.viewerContainer) return;

        const container = config.viewerContainer;

        const onWheelResizePoints = () => adjustCenterPointSizes();
        container.addEventListener('pointerdown', handlePointerDown);
        container.addEventListener('pointermove', handlePointerMove);
        container.addEventListener('wheel', onWheelResizePoints, { passive: true });
        container.addEventListener('contextmenu', handleContextMenu);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            // Cancel any scheduled RAF to avoid running after unmount
            if (pointerMoveRAF.current !== null) {
                cancelAnimationFrame(pointerMoveRAF.current);
                pointerMoveRAF.current = null;
            }
            if (marqueeDivRef.current && container.contains(marqueeDivRef.current)) {
                try { container.removeChild(marqueeDivRef.current); } catch { }
                marqueeDivRef.current = null;
            }

            container.removeEventListener('pointerdown', handlePointerDown);
            container.removeEventListener('pointermove', handlePointerMove);
            container.removeEventListener('wheel', onWheelResizePoints);
            container.removeEventListener('contextmenu', handleContextMenu);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [config.viewerContainer, handlePointerDown, handlePointerMove, handleContextMenu, handlePointerUp, handleKeyDown, adjustCenterPointSizes]);

    useEffect(() => {
        if (!config.mainGroup) return;
        adjustCenterPointSizes();
    }, [config.mainGroup, adjustCenterPointSizes]);

    // Track previous selection and exclusion for material restoration
    const previousSelectedObjects = useRef<Set<THREE.Object3D>>(new Set());
    const previousExcludedObjects = useRef<Set<THREE.Object3D>>(new Set());

    // Apply selection materials and restore previous ones
    useEffect(() => {
        // ✅ Önceki selected set'i effect'in başında kaydet
        const prevSelected = previousSelectedObjects.current;
        // ✅ Yeni selected set'i hemen güncelle (RAF öncesi) - böylece hızlı seçim değişikliklerinde kayıp olmuyor
        previousSelectedObjects.current = new Set(selectedObjectsSet);

        // Mesh'ler için bir frame bekle (render cycle'ın tamamlanması için)
        const rafId = requestAnimationFrame(() => {
            // Restore materials for previously selected objects that are no longer selected
            prevSelected.forEach(obj => {
                if (!selectedObjectsSet.has(obj)) {
                    restoreMaterial(obj as any);
                }
            });

            // Apply selection material to currently selected objects
            selectedObjectsSet.forEach(obj => {
                applyMaterial(obj as any, materials.selectionMaterial);
                ;
            });

            // Hovered obje varsa, yeni seçim durumuna göre materyalini senkronize et
            if (hoveredObject) {
                if (selectedObjectsSet.has(hoveredObject)) {
                    applyMaterial(hoveredObject as any, materials.selectionMaterial);
                } else if (excludedObjectsSet.has(hoveredObject)) {
                    applyMaterial(hoveredObject as any, materials.excludedMaterial);
                } else {
                    applyMaterial(hoveredObject as any, materials.hoverMaterial);
                }
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [selectedObjectsSet, applyMaterial, restoreMaterial, materials.selectionMaterial, config.mainGroup, hoveredObject, excludedObjectsSet]);

    // Apply exclusion materials and restore previous ones
    useEffect(() => {
        // ✅ Önceki excluded set'i effect'in başında kaydet
        const prevExcluded = previousExcludedObjects.current;
        // ✅ Yeni excluded set'i hemen güncelle (RAF öncesi) - böylece hızlı clearExclusions çağrılarında kayıp olmuyor
        previousExcludedObjects.current = new Set(excludedObjectsSet);

        // Mesh'ler için bir frame bekle (render cycle'ın tamamlanması için)
        const rafId = requestAnimationFrame(() => {
            // Restore materials for previously excluded objects that are no longer excluded
            let restoredCount = 0;
            prevExcluded.forEach(obj => {
                if (!excludedObjectsSet.has(obj)) {
                    restoreMaterial(obj as any);
                    restoredCount++;
                }
            });

            // Apply exclusion material to currently excluded objects
            let appliedCount = 0;
            excludedObjectsSet.forEach(obj => {
                applyMaterial(obj as any, materials.excludedMaterial);
                appliedCount++;
            });

            // Hovered obje varsa, yeni exclusion durumuna göre materyalini senkronize et
            if (hoveredObject) {
                if (excludedObjectsSet.has(hoveredObject)) {
                    applyMaterial(hoveredObject as any, materials.excludedMaterial);
                } else if (selectedObjectsSet.has(hoveredObject)) {
                    applyMaterial(hoveredObject as any, materials.selectionMaterial);
                } else {
                    applyMaterial(hoveredObject as any, materials.hoverMaterial);
                }
            }
        });

        return () => cancelAnimationFrame(rafId);
    }, [excludedObjectsSet, applyMaterial, restoreMaterial, materials.excludedMaterial, config.mainGroup, hoveredObject, selectedObjectsSet]);

    return {
        selectionInfo,
        selectedObjectsSet,
        excludedObjectsSet,
        materials,
        clearSelection,
        clearExclusions,
        updateSelection,
        selectConnectedSameType
    };
}