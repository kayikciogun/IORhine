import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { NURBSCurve } from 'three/examples/jsm/curves/NURBSCurve.js';

import { debug } from '../../Utils/debug';
// TypeScript için arayüzler

/**
 * DxfScene.js'deki _GenerateArcVertices algoritmasına dayalı elips/yay noktası üretici.
 * @param center Elipsin merkezi
 * @param majorRadius Major (büyük) yarıçap
 * @param minorRadius Minor (küçük) yarıçap
 * @param startAngle Başlangıç açısı (radyan)
 * @param endAngle Bitiş açısı (radyan)
 * @param rotation Ana eksen açısı (radyan)
 * @param minSegments Minimum segment sayısı (default: 24)
 * @param maxSegments Maksimum segment sayısı (default: 128)
 */
function generateEllipseVertices(
    center: THREE.Vector3,
    majorRadius: number,
    minorRadius: number,
    startAngle: number,
    endAngle: number,
    rotation: number,
    minSegments = 24,
    maxSegments = 128
): THREE.Vector3[] {
    // Açısal aralığa göre segment sayısı belirle
    const sweep = endAngle - startAngle;
    let segments = Math.max(minSegments, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
    segments = Math.min(segments, maxSegments);

    const points: THREE.Vector3[] = [];
    const cosRot = Math.cos(rotation);
    const sinRot = Math.sin(rotation);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const angle = startAngle + t * sweep;
        // Elipsin parametrik denklemi + ana eksen rotasyonu
        const x = majorRadius * Math.cos(angle);
        const y = minorRadius * Math.sin(angle);
        // Rotasyon matrisi uygula
        const xr = x * cosRot - y * sinRot;
        const yr = x * sinRot + y * cosRot;
        points.push(new THREE.Vector3(center.x + xr, center.y + yr, center.z));
    }
    return points;
}

interface EntityData {
    type: string;
    layer: string;
    handle: string;
    data: {
        [key: string]: any;
    };
}

interface DxfStats {
    totalEntitiesProcessed: number;
    linesAdded: number;
    circlesAdded: number;
    arcsAdded: number;
    insertsProcessed: number;
    polylinesAdded: number;
    splinesAdded: number;
    ellipsesAdded?: number; // Elips sayacı için opsiyonel alan eklendi
    centerPointsAdded?: number; // Merkez noktaları için yeni sayaç
    pointsAdded?: number; // POINT entity'leri için yeni sayaç
    vertexEndpointsAdded?: number; // Birleştirilmiş çizgi/yay uç snap noktaları
}

/**
 * Parsed DXF verisinden bounding box hesaplar (INSERT dönüşümleri dahil)
 */
const calculateBoundingBox = (parsedData: any): { min: THREE.Vector3, max: THREE.Vector3 } => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let hasValidPoints = false;

    const updateBounds = (x: number, y: number, z: number = 0) => {
        if (isFinite(x) && isFinite(y) && isFinite(z)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, z);
            maxZ = Math.max(maxZ, z);
            hasValidPoints = true;
        }
    };

    // Centering offset kullanılmaz; sadece INSERT dönüşümleri uygulanır
    const simpleTransform = (
        point: { x: number, y: number, z?: number },
        insertPoint = { x: 0, y: 0, z: 0 },
        scale = { x: 1, y: 1, z: 1 },
        rotationRad = 0
    ): THREE.Vector3 => {
        const vec = new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
        vec.multiply(new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1));
        vec.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotationRad);
        vec.add(new THREE.Vector3(insertPoint.x || 0, insertPoint.y || 0, insertPoint.z || 0));
        return vec;
    };

    const processEntityBounds = (
        entity: any,
        insertPoint = { x: 0, y: 0, z: 0 },
        scale = { x: 1, y: 1, z: 1 },
        rotationRad = 0
    ) => {
        try {
            switch (entity.type) {
                case 'LINE': {
                    if (entity.vertices && entity.vertices.length >= 2) {
                        entity.vertices.forEach((vertex: any) => {
                            const t = simpleTransform({ x: vertex.x || 0, y: vertex.y || 0, z: vertex.z || 0 }, insertPoint, scale, rotationRad);
                            updateBounds(t.x, t.y, t.z || 0);
                        });
                    }
                    break;
                }
                case 'CIRCLE': {
                    if (entity.center && typeof entity.radius === 'number') {
                        const c = simpleTransform(entity.center, insertPoint, scale, rotationRad);
                        const scaledRadius = entity.radius * Math.abs((scale.x || 1) + (scale.y || 1)) / 2;
                        updateBounds(c.x - scaledRadius, c.y - scaledRadius, c.z || 0);
                        updateBounds(c.x + scaledRadius, c.y + scaledRadius, c.z || 0);
                    }
                    break;
                }
                case 'ARC': {
                    if (entity.center && typeof entity.radius === 'number') {
                        // Kısmi yaylar için örnekleme ile bounding hesapla
                        const samples = 24;
                        // DXF’ten gelen açıların radyan olduğu varsayımıyla çalış
                        let start = entity.startAngle ?? 0;
                        let end = entity.endAngle ?? Math.PI * 2;
                        if (end <= start) end += Math.PI * 2;
                        for (let i = 0; i <= samples; i++) {
                            const t = i / samples;
                            const ang = start + (end - start) * t;
                            const local = {
                                x: entity.center.x + entity.radius * Math.cos(ang),
                                y: entity.center.y + entity.radius * Math.sin(ang),
                                z: entity.center.z || 0
                            };
                            const p = simpleTransform(local, insertPoint, scale, rotationRad);
                            updateBounds(p.x, p.y, p.z || 0);
                        }
                    }
                    break;
                }
                case 'LWPOLYLINE':
                case 'POLYLINE': {
                    if (entity.vertices && entity.vertices.length) {
                        entity.vertices.forEach((vertex: any) => {
                            const t = simpleTransform({ x: vertex.x || 0, y: vertex.y || 0, z: vertex.z || entity.elevation || 0 }, insertPoint, scale, rotationRad);
                            updateBounds(t.x, t.y, t.z || 0);
                        });
                    }
                    break;
                }
                case 'SPLINE': {
                    if (entity.controlPoints && entity.controlPoints.length) {
                        entity.controlPoints.forEach((point: any) => {
                            const t = simpleTransform({ x: point.x || 0, y: point.y || 0, z: point.z || 0 }, insertPoint, scale, rotationRad);
                            updateBounds(t.x, t.y, t.z || 0);
                        });
                    }
                    break;
                }
                case 'ELLIPSE': {
                    if (entity.center && entity.majorAxisEndPoint) {
                        const c = simpleTransform(entity.center, insertPoint, scale, rotationRad);
                        const majVec = new THREE.Vector3(
                            entity.majorAxisEndPoint.x,
                            entity.majorAxisEndPoint.y,
                            entity.majorAxisEndPoint.z || 0
                        );
                        const majorRadius = majVec.length() * Math.abs((scale.x || 1) + (scale.y || 1)) / 2;
                        const minorRadius = majorRadius * (entity.axisRatio || 1);
                        const maxR = Math.max(majorRadius, minorRadius);
                        updateBounds(c.x - maxR, c.y - maxR, c.z || 0);
                        updateBounds(c.x + maxR, c.y + maxR, c.z || 0);
                    }
                    break;
                }
                case 'INSERT': {
                    const blockName = entity.name;
                    if (blockName && parsedData.blocks && parsedData.blocks[blockName]) {
                        const block = parsedData.blocks[blockName];
                        const insertPos = entity.position || { x: 0, y: 0, z: 0 };
                        const insertScale = entity.scale || entity.scaleFactors || { x: 1, y: 1, z: 1 };
                        const insertRotation = (entity.rotation || 0) * Math.PI / 180;

                        const combinedInsertPoint = simpleTransform(insertPos, insertPoint, scale, rotationRad);
                        const combinedScale = {
                            x: (scale.x || 1) * (insertScale.x || 1),
                            y: (scale.y || 1) * (insertScale.y || 1),
                            z: (scale.z || 1) * (insertScale.z || 1)
                        };
                        const combinedRotation = rotationRad + insertRotation;

                        if (block.entities) {
                            block.entities.forEach((be: any) => processEntityBounds(be, combinedInsertPoint, combinedScale, combinedRotation));
                        }
                    } else if (entity.position) {
                        const t = simpleTransform(entity.position, insertPoint, scale, rotationRad);
                        updateBounds(t.x, t.y, t.z || 0);
                    }
                    break;
                }
                case 'TEXT':
                case 'MTEXT': {
                    const point = entity.startPoint || entity.position;
                    if (point) {
                        const t = simpleTransform(point, insertPoint, scale, rotationRad);
                        updateBounds(t.x, t.y, t.z || 0);
                    }
                    break;
                }
                case 'POINT': {
                    // Genelde tekil noktaları merkez hesabına katmamak daha doğru olur; atla
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            debug.warn('Error processing entity for bounds:', entity, error);
        }
    };

    if (parsedData.entities && Array.isArray(parsedData.entities)) {
        parsedData.entities.forEach((e: any) => processEntityBounds(e));
    }

    if (!hasValidPoints) {
        return {
            min: new THREE.Vector3(-100, -100, -100),
            max: new THREE.Vector3(100, 100, 100)
        };
    }

    return {
        min: new THREE.Vector3(minX, minY, minZ),
        max: new THREE.Vector3(maxX, maxY, maxZ)
    };
};

/**
 * En büyük dairenin merkezini bulur ve ortalama offset hesaplar
 */
const calculateLargestCircleCenteringOffset = (parsedData: any): THREE.Vector3 | null => {
    let largestRadius = 0;
    let largestCircleCenter: THREE.Vector3 | null = null;

    const processEntities = (entities: any[]) => {
        entities.forEach(entity => {
            if (entity.type === 'CIRCLE' && entity.radius > largestRadius) {
                largestRadius = entity.radius;
                largestCircleCenter = new THREE.Vector3(entity.center.x, entity.center.y, entity.center.z || 0);
            }
        });
    };

    if (parsedData.entities) {
        processEntities(parsedData.entities);
    }

    if (parsedData.blocks) {
        Object.values(parsedData.blocks).forEach((block: any) => {
            if (block.entities) {
                processEntities(block.entities);
            }
        });
    }

    return largestCircleCenter;
};

/**
 * Bounding box merkezini hesaplar
 */
const calculateCenteringOffset = (parsedData: any): THREE.Vector3 => {
    // Önce robust bir merkez dene (outlier noktalarını hariç tutar)
    const robustOffset = calculateRobustCenteringOffset(parsedData);
    if (robustOffset) {
       // debug.log(`[DXF Centering] Robust centering kullanılıyor`);
        return robustOffset;
    }

  //  debug.log(`[DXF Centering] Robust yöntem başarısız, Bounding box kullanılarak ortalanıyor`);
    const bounds = calculateBoundingBox(parsedData);
    const center = new THREE.Vector3();
    center.addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
     
    return center.negate(); // Return negative to move center to origin
};

/**
 * Noktayı transform eder (INSERT için)
 */
const transformPoint = (point: { x: number, y: number, z?: number }, insertPoint: { x: number, y: number, z?: number }, scale: { x: number, y: number, z?: number }, rotationRad: number, zOffset: number = 0, centeringOffset?: THREE.Vector3): THREE.Vector3 => {
    const vec = new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);

    // Centering offset'i ÖNCE uygula (diğer transformasyonlardan önce)
    if (centeringOffset) {
        vec.add(centeringOffset);
    }

    // Sonra scale, rotation ve insert point uygula
    vec.multiply(new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1));
    vec.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotationRad);
    vec.add(new THREE.Vector3(insertPoint.x || 0, insertPoint.y || 0, insertPoint.z || 0));
    vec.z += zOffset;

    return vec;
}

const getOptimalSegmentCount = (points: THREE.Vector3[], minSegments = 12, maxSegments = 100) => {
    const length = points.length;
    return Math.max(minSegments, Math.min(maxSegments, Math.floor(length / 2)));
};

// LWPOLYLINE bulge desteği için yardımcı: iki nokta ve bulge değerinden yay örnek noktaları üretir (DXF: bulge = tan(theta/4))
const sampleBulgeArcPoints2D = (
    p0: { x: number, y: number },
    p1: { x: number, y: number },
    bulge: number,
    minSegments = 12,
    maxSegments = 64
): { x: number, y: number }[] => {
    const points: { x: number, y: number }[] = [];
    if (!isFinite(bulge) || Math.abs(bulge) < 1e-12) {
        // Düz kenar
        points.push({ x: p0.x, y: p0.y });
        points.push({ x: p1.x, y: p1.y });
        return points;
    }

    const theta = 4 * Math.atan(bulge); // dahili açı (işaret yönü belirler)
    const vx = p1.x - p0.x;
    const vy = p1.y - p0.y;
    const c = Math.hypot(vx, vy);
    if (c < 1e-12) {
        points.push({ x: p0.x, y: p0.y });
        return points;
    }
    const chordUnitX = vx / c;
    const chordUnitY = vy / c;
    // Sol normal (CCW); v = (vx,vy) için n = (-vy, vx)/|v|
    const nx = -vy / c;
    const ny = vx / c;

    const R = c / (2 * Math.sin(Math.abs(theta) / 2));
    const d = R * Math.cos(Math.abs(theta) / 2); // orta noktadan merkeze mesafe
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dirSign = Math.sign(bulge) || 1; // +: CCW (sola), -: CW (sağa)
    const cx = mx + nx * d * dirSign;
    const cy = my + ny * d * dirSign;

    const startAng = Math.atan2(p0.y - cy, p0.x - cx);
    const sweep = theta; // işaretli
    const total = Math.max(minSegments, Math.min(maxSegments, Math.ceil(Math.abs(sweep) / (Math.PI / 36))));

    for (let i = 0; i <= total; i++) {
        const t = i / total;
        const ang = startAng + t * sweep;
        points.push({ x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) });
    }
    return points;
};

const createLine2Object = (points: THREE.Vector3[], entityData: EntityData, material: LineMaterial): Line2 | null => {
    if (points.length < 2) return null;
    
    const geometry = new LineGeometry();
    geometry.setPositions(points.flatMap(p => [p.x, p.y, p.z]));
    
    const line = new Line2(geometry, material);
    line.userData = entityData;
    return line;
}

const createCenterPointObject = (centerPoint: THREE.Vector3, entityData: EntityData, material: LineMaterial): THREE.Group | null => {
    const group = new THREE.Group();
    
    // THREE.Points ile tek noktayı görselleştir
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([centerPoint.x, centerPoint.y, centerPoint.z]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = (material as any).color?.clone?.() || new THREE.Color(0xffffff);
    // Boyutu, sahip olduğu radius'a göre orantıla (px). sqrt ile büyümeyi yumuşat.
    const dataAny: any = entityData.data || {};
    const baseRadius = (typeof dataAny.effectiveMajorRadius === 'number' ? dataAny.effectiveMajorRadius : undefined) ??
                       (typeof dataAny.radius === 'number' ? dataAny.radius : undefined) ?? 0;
    const computedSizePx = Math.max(4, Math.min(14, 2 + Math.sqrt(Math.abs(baseRadius || 0))));
    const pointsMaterial = new THREE.PointsMaterial({ size: computedSizePx, sizeAttenuation: true, color });
    const points = new THREE.Points(geometry, pointsMaterial);
    points.userData = { ...entityData, isCenterPoint: true, centerCoordinate: centerPoint, pointSizePx: computedSizePx };

    group.add(points);
    group.userData = { ...entityData, isCenterPointGroup: true, centerCoordinate: centerPoint, pointSizePx: computedSizePx };
    return group;
}

const createPointObject = (point: THREE.Vector3, entityData: EntityData, material: LineMaterial): THREE.Group | null => {
    const group = new THREE.Group();
    
    // THREE.Points ile tek noktayı görselleştir
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([point.x, point.y, point.z]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = (material as any).color?.clone?.() || new THREE.Color(0xffffff);
    // Serbest POINT (merkez değil) için sabit ama makul bir boyut
    const pointsMaterial = new THREE.PointsMaterial({ size: 6, sizeAttenuation: true, color });
    const points = new THREE.Points(geometry, pointsMaterial);
    points.userData = { ...entityData, isPoint: true, pointCoordinate: point };

    group.add(points);
    group.userData = { ...entityData, isPointGroup: true, pointCoordinate: point };
    return group;
}

/** Çizgi/yay uçları: görünmez küre (sadece raycast), aynı konumda tek hit hacmi */
const VERTEX_MERGE_MM = 0.05;

type VertexContributor = { parentHandle: string; parentType: string; end: 'start' | 'end' };

const snapCoord = (v: number) => Math.round(v / VERTEX_MERGE_MM) * VERTEX_MERGE_MM;

const vertexMergeKey = (x: number, y: number, z: number) =>
    `${snapCoord(x).toFixed(4)},${snapCoord(y).toFixed(4)},${snapCoord(z).toFixed(4)}`;

const createVertexEndpointPickGroup = (
    position: THREE.Vector3,
    handle: string,
    layer: string,
    contributors: VertexContributor[]
): THREE.Group | null => {
    const x = position.x;
    const y = position.y;
    const z = position.z;
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const sphereGeom = new THREE.SphereGeometry(1, 12, 12);
    const pickMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(sphereGeom, pickMat);
    mesh.frustumCulled = false;
    mesh.scale.setScalar(0.35);

    const pointPayload = { x, y, z };
    const entityData: EntityData = {
        type: 'POINT',
        layer,
        handle,
        data: {
            ...pointPayload,
            point: pointPayload,
            isVertexPoint: true,
            vertexContributors: contributors
        }
    };
    mesh.userData = { ...entityData, isVertexEndpointPick: true };
    group.add(mesh);
    group.userData = {
        ...entityData,
        isPointGroup: true,
        isVertexEndpointGroup: true,
        pointCoordinate: position.clone()
    };
    return group;
};

/**
 * LINE / ARC / SPLINE / açık ELLIPSE uçlarını toplar, VERTEX_MERGE_MM içinde birleştirir,
 * görünmez pick mesh ile sahneye ekler (ekranda nokta yok; seçim/hover nesnesi olarak kalır).
 */
const addMergedVertexEndpoints = (mainGroup: THREE.Group, _defaultMaterial: LineMaterial, stats: DxfStats) => {
    type Acc = { pos: THREE.Vector3; contributors: VertexContributor[]; layer: string };
    const buckets = new Map<string, Acc>();

    const pushEndpoint = (x: number, y: number, z: number, parentHandle: string, parentType: string, end: 'start' | 'end', layer: string) => {
        const key = vertexMergeKey(x, y, z);
        const ex = snapCoord(x);
        const ey = snapCoord(y);
        const ez = snapCoord(z);
        const c: VertexContributor = { parentHandle, parentType, end };
        const existing = buckets.get(key);
        if (existing) {
            existing.contributors.push(c);
            return;
        }
        buckets.set(key, {
            pos: new THREE.Vector3(ex, ey, ez),
            contributors: [c],
            layer
        });
    };

    mainGroup.children.forEach((child) => {
        const ud: any = child.userData;
        if (!ud || ud.isCenterPointGroup || ud.isVertexEndpointGroup) return;
        const t = ud.type as string;
        const d = ud.data;
        const h = ud.handle as string;
        const layer = (ud.layer as string) || '0';
        if (!d || !h) return;

        if (t === 'LINE' || t === 'ARC' || t === 'SPLINE') {
            if (d.startPoint && d.endPoint) {
                pushEndpoint(d.startPoint.x, d.startPoint.y, d.startPoint.z || 0, h, t, 'start', layer);
                pushEndpoint(d.endPoint.x, d.endPoint.y, d.endPoint.z || 0, h, t, 'end', layer);
            }
            return;
        }

        if (t === 'ELLIPSE' && d.points && Array.isArray(d.points) && d.points.length >= 2 && !d.isClosed) {
            const p0 = d.points[0];
            const p1 = d.points[d.points.length - 1];
            pushEndpoint(p0.x, p0.y, p0.z || 0, h, t, 'start', layer);
            pushEndpoint(p1.x, p1.y, p1.z || 0, h, t, 'end', layer);
        }
    });

    let added = 0;
    buckets.forEach((acc, key) => {
        const safeKey = key.replace(/[^0-9.,-]/g, '_');
        const handle = `vertex_${safeKey}`;
        const g = createVertexEndpointPickGroup(acc.pos, handle, acc.layer, acc.contributors);
        if (g) {
            mainGroup.add(g);
            added++;
        }
    });

    stats.vertexEndpointsAdded = added;
};

const processEntity = (
    entity: any,
    parsedData: any, // Need full parsed data to look up blocks
    groupToAdd: THREE.Group, // Group to add created objects to
    defaultMaterial: LineMaterial, // Material to use
    existingCenterPoints: Map<string, { type: string, handle: string }>, // Center point duplicate tracking - zorunlu
    currentInsertPoint = { x: 0, y: 0, z: 0 },
    currentScale = { x: 1, y: 1, z: 1 },
    currentRotationRad = 0,
    depth = 0,
    stats: DxfStats, // Pass stats object for tracking
    centeringOffset?: THREE.Vector3 // Add centering offset parameter
) => {
    if (depth > 10) {
        debug.warn('Maximum recursion depth reached for INSERT entities');
        return;
    }

    try {
        const entityData: EntityData = {
            type: entity.type,
            layer: entity.layer || '0',
            handle: entity.handle || `${entity.type}_${Math.random().toString(36).substr(2, 9)}`,
            data: entity
        };

        switch (entity.type) {
            case 'LINE': {
                if (!entity.vertices || entity.vertices.length < 2) break;
                
                const startPoint = transformPoint(entity.vertices[0], currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                const endPoint = transformPoint(entity.vertices[1], currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                
                // LINE için startPoint ve endPoint ekle
                const lineData = {
                    ...entityData.data,
                    startPoint: { x: startPoint.x, y: startPoint.y, z: startPoint.z },
                    endPoint: { x: endPoint.x, y: endPoint.y, z: endPoint.z }
                };
                
                const lineEntityData = {
                    ...entityData,
                    data: lineData
                };
                
                const lineObject = createLine2Object([startPoint, endPoint], lineEntityData, defaultMaterial);
                if (lineObject) {
                    groupToAdd.add(lineObject);
                    stats.linesAdded++;
                }
                break;
            }

            case 'CIRCLE': {
                if (!entity.center || !entity.radius) break;
                
                // Merkez noktasını ve örnekleme tabanlı doğru dönüşümü uygula (non-uniform scale desteği)
                const transformedCenter = transformPoint(entity.center, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                const segments = 96; // bir miktar arttırılmış örnekleme
                const points: THREE.Vector3[] = [];
                
                for (let i = 0; i <= segments; i++) {
                    const angle = (i / segments) * Math.PI * 2;
                    const localPoint = {
                        x: entity.center.x + entity.radius * Math.cos(angle),
                        y: entity.center.y + entity.radius * Math.sin(angle),
                        z: entity.center.z || 0
                    };
                    const p = transformPoint(localPoint, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                    points.push(p);
                }
                
                // Kullanışlı meta veriler: efektif yarıçaplar (non-uniform scale sonrası)
                const sx = Math.abs(currentScale.x || 1);
                const sy = Math.abs(currentScale.y || 1);
                const effectiveMajorRadius = entity.radius * Math.max(sx, sy);
                const effectiveMinorRadius = entity.radius * Math.min(sx, sy);
                
                const circleData = {
                    ...entityData.data,
                    center: { x: transformedCenter.x, y: transformedCenter.y, z: transformedCenter.z },
                    radius: entity.radius, // orijinal DXF yarıçapı
                    effectiveMajorRadius,
                    effectiveMinorRadius,
                    isClosed: true,
                    points: points.map(p => ({ x: p.x, y: p.y, z: p.z }))
                };
                
                const circleEntityData = {
                    ...entityData,
                    data: circleData
                };
                
                const circleObject = createLine2Object(points, circleEntityData, defaultMaterial);
                if (circleObject) {
                    groupToAdd.add(circleObject);
                    stats.circlesAdded++;
                }
                
                // Merkez noktası ekle (sadece bir kez) - POINT olarak
                const centerKey = `${transformedCenter.x.toFixed(3)},${transformedCenter.y.toFixed(3)},${transformedCenter.z.toFixed(3)}`;
                if (!existingCenterPoints.has(centerKey)) {
                    const centerPointEntityData: EntityData = {
                        type: 'POINT',
                        layer: entityData.layer,
                        handle: `${entityData.handle}_center`,
                        data: {
                            point: { x: transformedCenter.x, y: transformedCenter.y, z: transformedCenter.z },
                            parentType: 'CIRCLE',
                            parentHandle: entityData.handle
                        }
                    };
                    const centerPointObject = createCenterPointObject(transformedCenter, centerPointEntityData, defaultMaterial);
                    if (centerPointObject) {
                        groupToAdd.add(centerPointObject);
                        existingCenterPoints.set(centerKey, { type: 'POINT', handle: centerPointEntityData.handle });
                        if (stats.centerPointsAdded !== undefined) {
                            stats.centerPointsAdded++;
                        }
                    }
                }
                break;
            }

            case 'ARC': {
                if (!entity.center || !entity.radius || entity.startAngle === undefined || entity.endAngle === undefined) {
                    debug.warn(`Skipping ARC (Handle: ${entityData.handle}) with missing parameters.`);
                    break;
                }
                
                debug.log(`[Debug] ARC ${entityData.handle}: center=(${entity.center.x?.toFixed(2)}, ${entity.center.y?.toFixed(2)}), radius=${entity.radius?.toFixed(2)}, start=${entity.startAngle?.toFixed(2)}, end=${entity.endAngle?.toFixed(2)}`);
                
                try {
                    const startAngleRad = entity.startAngle;
                    const endAngleRad = entity.endAngle;
                    const ccw = entity.counterClockwise !== undefined ? entity.counterClockwise : true;

                    // Normalized sweep
                    let sweep = ccw ? (endAngleRad - startAngleRad) : (startAngleRad - endAngleRad);
                    if (sweep <= 0) sweep += Math.PI * 2;
                    if (!ccw) sweep = -sweep;

                    // Örnekleme yoğunluğu
                    const segments = Math.max(16, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
                    const points: THREE.Vector3[] = [];

                    for (let i = 0; i <= segments; i++) {
                        const t = i / segments;
                        const ang = ccw ? (startAngleRad + t * Math.abs(sweep)) : (startAngleRad - t * Math.abs(sweep));
                        const localPoint = {
                            x: entity.center.x + entity.radius * Math.cos(ang),
                            y: entity.center.y + entity.radius * Math.sin(ang),
                            z: entity.center.z || 0
                        };
                        const p = transformPoint(localPoint, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                        points.push(p);
                    }

                    if (points.length >= 2) {
                        // Meta veriler
                        const transformedCenter = transformPoint(entity.center, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                        const transformedStart = transformPoint({ x: entity.center.x + entity.radius * Math.cos(startAngleRad), y: entity.center.y + entity.radius * Math.sin(startAngleRad), z: entity.center.z || 0 }, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                        const transformedEnd = transformPoint({ x: entity.center.x + entity.radius * Math.cos(endAngleRad), y: entity.center.y + entity.radius * Math.sin(endAngleRad), z: entity.center.z || 0 }, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);

                        // GeometryProcessor uyumluluğu için radius alanını doldur (yaklaşık):
                        // Non-uniform scale varsa tekil bir yarıçap fiziksel olarak yoktur; bu nedenle
                        // merkezden start ve end'e mesafenin ortalamasını kullanıyoruz.
                        const approxRadius = 0.5 * (transformedCenter.distanceTo(new THREE.Vector3(transformedStart.x, transformedStart.y, transformedStart.z)) +
                                                    transformedCenter.distanceTo(new THREE.Vector3(transformedEnd.x, transformedEnd.y, transformedEnd.z)));

                        // Yaklaşık yay uzunluğu (örnekleme polilinesi üzerinden)
                        let approxLen = 0;
                        for (let i = 0; i < points.length - 1; i++) approxLen += points[i].distanceTo(points[i + 1]);

                        const arcObject = createLine2Object(points, {
                            type: 'ARC',
                            layer: entityData.layer,
                            handle: entityData.handle,
                            data: {
                                center: { x: transformedCenter.x, y: transformedCenter.y, z: transformedCenter.z },
                                radius: approxRadius,
                                startAngle: startAngleRad,
                                endAngle: endAngleRad,
                                isClockwise: !ccw,
                                sweepAngleRad: sweep,
                                startPoint: { x: transformedStart.x, y: transformedStart.y, z: transformedStart.z },
                                endPoint: { x: transformedEnd.x, y: transformedEnd.y, z: transformedEnd.z },
                                arcLength: approxLen,
                                points: points.map(p => ({ x: p.x, y: p.y, z: p.z }))
                            }
                        }, defaultMaterial);

                        if (arcObject) {
                            groupToAdd.add(arcObject);
                            stats.arcsAdded++;

                            const centerKey = `${transformedCenter.x.toFixed(6)},${transformedCenter.y.toFixed(6)}`;
                            if (!existingCenterPoints.has(centerKey)) {
                                const centerPointEntityData: EntityData = {
                                    type: 'POINT',
                                    layer: entityData.layer,
                                    handle: `${entityData.handle}_center`,
                                    data: {
                                        point: { x: transformedCenter.x, y: transformedCenter.y, z: transformedCenter.z },
                                        parentType: 'ARC',
                                        parentHandle: entityData.handle,
                                        radius: entity.radius,
                                        arcLength: approxLen,
                                        center: { x: entity.center.x, y: entity.center.y, z: entity.center.z || 0 },
                                        startAngle: startAngleRad,
                                        endAngle: endAngleRad,
                                        isClockwise: !ccw
                                    }
                                };
                                const centerPoint = createCenterPointObject(transformedCenter, centerPointEntityData, defaultMaterial);
                                if (centerPoint) {
                                    groupToAdd.add(centerPoint);
                                    if (!stats.centerPointsAdded) stats.centerPointsAdded = 0;
                                    stats.centerPointsAdded++;
                                    existingCenterPoints.set(centerKey, { type: 'POINT', handle: centerPointEntityData.handle });
                                }
                            }
                        }
                    } else {
                        debug.warn(`ARC (Handle: ${entityData.handle}) resulted in insufficient sampled points.`);
                    }
                } catch (arcError) {
                    console.error(`Error processing ARC (Handle: ${entityData.handle}):`, arcError);
                }
                break;
            }

            case 'LWPOLYLINE':
            case 'POLYLINE': {
                if (!entity.vertices || entity.vertices.length < 2) break;

                const verts = entity.vertices;
                const isLw = entity.type === 'LWPOLYLINE';
                const isClosed = !!(entity.closed === true || entity.shape === true || (entity.flags & 1));

                const addSegmentAsLine2 = (pts: THREE.Vector3[], idxLabel: string, extraData?: any) => {
                    if (pts.length < 2) return;
                    const segEntity: EntityData = {
                        type: 'LINE',
                        layer: entityData.layer,
                        handle: `${entityData.handle}_${idxLabel}`,
                        data: {
                            startPoint: { x: pts[0].x, y: pts[0].y, z: pts[0].z },
                            endPoint: { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, z: pts[pts.length - 1].z },
                            length: pts[0].distanceTo(pts[pts.length - 1]),
                            ...(extraData || {})
                        }
                    };
                    const obj = createLine2Object(pts, segEntity, defaultMaterial);
                    if (obj) {
                        groupToAdd.add(obj);
                        stats.linesAdded++;
                    }
                };

                const segCount = verts.length - 1 + (isClosed ? 1 : 0);
                for (let i = 0; i < segCount; i++) {
                    const a = verts[i % verts.length];
                    const b = verts[(i + 1) % verts.length];
                    const bulge = isLw ? (a.bulge || 0) : 0;

                    if (isFinite(bulge) && Math.abs(bulge) > 1e-12) {
                        // Bulge'lı yay: yerel 2B örnekle, sonra her noktayı tam dönüştür
                        const arc2D = sampleBulgeArcPoints2D({ x: a.x, y: a.y }, { x: b.x, y: b.y }, bulge);
                        const points3D: THREE.Vector3[] = arc2D.map(p => transformPoint({ x: p.x, y: p.y, z: (a.z || entity.elevation || 0) }, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset));
                        addSegmentAsLine2(points3D, `seg_${i}`, { isBulge: true, bulge });
                    } else {
                        // Düz segment
                        const p0 = transformPoint({ x: a.x, y: a.y, z: (a.z || entity.elevation || 0) }, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                        const p1 = transformPoint({ x: b.x, y: b.y, z: (b.z || entity.elevation || 0) }, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                        addSegmentAsLine2([p0, p1], `seg_${i}`, { isBulge: false });
                    }
                }

                stats.polylinesAdded++;
                break;
            }

            case 'SPLINE': {
                if (!entity.controlPoints || entity.controlPoints.length < 2) break;
                
                // Kontrol noktalarını transform et
                const controlPoints: THREE.Vector3[] = [];
                entity.controlPoints.forEach((point: any) => {
                    const transformedPoint = transformPoint(point, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                    controlPoints.push(transformedPoint);
                });

                // Debug: SPLINE detaylı log
                try {
                    console.groupCollapsed(`[DXF Scene][SPLINE] oluşturuluyor | handle=${entityData.handle} | layer=${entityData.layer}`);
                    debug.log(`Ham entity ipuçları:`, {
                        hasDegree: entity.degree !== undefined,
                        degree: entity.degree,
                        knotsLen: Array.isArray(entity.knots) ? entity.knots.length : undefined,
                        weightsLen: Array.isArray(entity.weights) ? entity.weights.length : undefined,
                        flags: entity.flags,
                        rawControlPointsLen: Array.isArray(entity.controlPoints) ? entity.controlPoints.length : undefined,
                    });
                    debug.log(`Transform edilmiş kontrol noktaları (${controlPoints.length}):`, controlPoints.slice(0, 10).map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) })));
                } catch (e) { /* no-op */ }
                
                // Gerçek spline eğrisi oluştur (öncelik NURBS, yoksa Catmull-Rom)
                let splinePoints: THREE.Vector3[] = [];
                const hasNurbsInputs = Number.isFinite(entity.degree) && Array.isArray(entity.knots) && Array.isArray(entity.controlPoints);

                if (hasNurbsInputs && controlPoints.length >= 2) {
                    try {
                        const weightsArray: number[] | undefined = Array.isArray(entity.weights) && entity.weights.length === entity.controlPoints.length
                            ? entity.weights
                            : undefined;
                        const controlPointsV4 = controlPoints.map((p, idx) => new THREE.Vector4(p.x, p.y, p.z, weightsArray ? (weightsArray[idx] ?? 1) : 1));
                        const degree: number = entity.degree;
                        const knots: number[] = entity.knots;

                        // NURBS eğrisini oluştur
                        const nurbsCurve = new NURBSCurve(degree, knots, controlPointsV4);

                        // Örnekleme yoğunluğu: eğri uzunluğu bazlı
                        const approximateSegments = Math.max(32, Math.min(512, Math.ceil((nurbsCurve.getLength?.() ?? 200) / 2)));
                        const pts = nurbsCurve.getPoints(approximateSegments);
                        splinePoints = pts.map(p => new THREE.Vector3(p.x, p.y, p.z));

                        try { debug.log(`[DXF Scene][SPLINE] NURBS kullanıldı. degree=${degree}, cp=${controlPoints.length}, knots=${knots.length}, segments=${approximateSegments}`); } catch {}
                    } catch (nurbsErr) {
                        try { debug.warn(`[DXF Scene][SPLINE] NURBS oluşturulamadı, Catmull-Rom'a düşülüyor.`, nurbsErr); } catch {}
                    }
                }

                if (splinePoints.length === 0) {
                    if (controlPoints.length === 2) {
                        // Sadece 2 nokta varsa düz çizgi
                        try { debug.log(`[DXF Scene][SPLINE] 2 kontrol noktası -> düz çizgi olarak çizilecek.`); } catch {}
                        splinePoints = controlPoints;
                    } else if (controlPoints.length >= 3) {
                        // 3 veya daha fazla nokta için Catmull-Rom spline kullan
                        const curve = new THREE.CatmullRomCurve3(controlPoints, false, 'centripetal');
                        
                        // Spline uzunluğuna göre segment sayısını belirle
                        const curveLength = curve.getLength();
                        const segments = Math.max(24, Math.min(256, Math.ceil(curveLength / 2)));
                        try { debug.log(`[DXF Scene][SPLINE] Catmull-Rom ayarları:`, { curveLength: +curveLength.toFixed(3), segments }); } catch {}
                        
                        splinePoints = curve.getPoints(segments);
                    }
                }
                
                if (splinePoints.length >= 2) {
                    // SPLINE için startPoint ve endPoint ekle
                    const splineData = {
                        ...entityData.data,
                        controlPoints: controlPoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
                        // Viewer’da çizilen eğriye ait örneklenmiş noktalar: geometryProcessor bu alanı öncelikli kullanır (Format 1 - points)
                        points: splinePoints.map(p => ({ x: p.x, y: p.y, z: p.z })),
                        startPoint: { x: splinePoints[0].x, y: splinePoints[0].y, z: splinePoints[0].z },
                        endPoint: { x: splinePoints[splinePoints.length - 1].x, y: splinePoints[splinePoints.length - 1].y, z: splinePoints[splinePoints.length - 1].z }
                    };
                    
                    const splineEntityData = {
                        ...entityData,
                        data: splineData
                    };

                    try {
                        const firstFew = splinePoints.slice(0, 5).map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) }));
                        const lastFew = splinePoints.slice(Math.max(0, splinePoints.length - 5)).map(p => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) }));
                        debug.log(`[DXF Scene][SPLINE] örneklenmiş nokta sayısı: ${splinePoints.length}`);
                        debug.log(`[DXF Scene][SPLINE] ilk/son noktalar:`, { firstFew, lastFew });
                    } catch {}
                    
                    const splineObject = createLine2Object(splinePoints, splineEntityData, defaultMaterial);
                    if (splineObject) {
                        groupToAdd.add(splineObject);
                        stats.splinesAdded++;
                        try { debug.log(`[DXF Scene][SPLINE] Line2 object eklendi. userData:`, splineObject.userData); } catch {}
                    }
                }
                try { debug.groupEnd(); } catch {}
                break;
            }

            case 'ELLIPSE': {
                if (!entity.center || !entity.majorAxisEndPoint) break;
                
                const transformedCenter = transformPoint(entity.center, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                
                // Major axis vector
                const majorAxisVector = {
                    x: entity.majorAxisEndPoint.x * (currentScale.x || 1),
                    y: entity.majorAxisEndPoint.y * (currentScale.y || 1),
                    z: entity.majorAxisEndPoint.z || 0
                };
                
                // Rotasyon uygula
                const cos = Math.cos(currentRotationRad);
                const sin = Math.sin(currentRotationRad);
                const rotatedMajorX = majorAxisVector.x * cos - majorAxisVector.y * sin;
                const rotatedMajorY = majorAxisVector.x * sin + majorAxisVector.y * cos;
                
                const majorRadius = Math.sqrt(rotatedMajorX * rotatedMajorX + rotatedMajorY * rotatedMajorY);
                const minorRadius = majorRadius * (entity.axisRatio || 1);
                const rotation = Math.atan2(rotatedMajorY, rotatedMajorX);
                
                const startAngle = entity.startParameter || 0;
                const endAngle = entity.endParameter || 2 * Math.PI;
                const isFullEllipse = Math.abs((endAngle - startAngle) - 2 * Math.PI) < 1e-6;
                
                const points = generateEllipseVertices(
                    transformedCenter,
                    majorRadius,
                    minorRadius,
                    startAngle,
                    endAngle,
                    rotation
                );
                
                // GeometryProcessor ile paylaşılacak zengin userData
                const ellipseData = {
                    ...entityData.data,
                    center: { x: transformedCenter.x, y: transformedCenter.y, z: transformedCenter.z },
                    majorRadius,
                    minorRadius,
                    majorAxisAngle: rotation,
                    startAngle,
                    endAngle,
                    isClosed: isFullEllipse,
                    points: points.map(p => ({ x: p.x, y: p.y, z: p.z }))
                };
                const ellipseEntityData = { ...entityData, data: ellipseData };
                
                const ellipseObject = createLine2Object(points, ellipseEntityData, defaultMaterial);
                if (ellipseObject) {
                    groupToAdd.add(ellipseObject);
                    if (stats.ellipsesAdded !== undefined) {
                        stats.ellipsesAdded++;
                    }
                    try { debug.log(`[DXF Scene][ELLIPSE] userData:`, ellipseObject.userData); } catch {}
                }
                
                // Merkez noktası ekle (sadece bir kez)
                const centerKey = `${transformedCenter.x.toFixed(3)},${transformedCenter.y.toFixed(3)},${transformedCenter.z.toFixed(3)}`;
                if (!existingCenterPoints.has(centerKey)) {
                    const centerPointObject = createCenterPointObject(transformedCenter, ellipseEntityData, defaultMaterial);
                    if (centerPointObject) {
                        groupToAdd.add(centerPointObject);
                        existingCenterPoints.set(centerKey, { type: 'ELLIPSE', handle: entityData.handle });
                        if (stats.centerPointsAdded !== undefined) {
                            stats.centerPointsAdded++;
                        }
                    }
                }
                break;
            }

            case 'POINT': {
                if (!entity.position && !entity.x && !entity.y) break;
                
                // POINT entity'si için pozisyon bilgisini al
                const pointPosition = entity.position || { x: entity.x || 0, y: entity.y || 0, z: entity.z || 0 };
                const transformedPoint = transformPoint(pointPosition, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                
                const pointObject = createPointObject(transformedPoint, entityData, defaultMaterial);
                if (pointObject) {
                    groupToAdd.add(pointObject);
                    if (stats.pointsAdded !== undefined) {
                        stats.pointsAdded++;
                    } else {
                        stats.pointsAdded = 1;
                    }
                }
                break;
            }

            case 'DIMENSION': {
                // Ölçü çizgilerini atla - görsel olarak gerekli değil
                debug.log('[DXF Scene Builder] Skipping DIMENSION entity');
                break;
            }

            case 'INSERT': {
                if (!entity.name || !parsedData.blocks || !parsedData.blocks[entity.name]) {
                    debug.warn(`Block '${entity.name}' not found for INSERT entity`);
                    
                    // Ölçü çizgilerini ve sistem block'larını filtrele
                    if (entity.name === '*S' || entity.name?.includes('S')) {
                        // Ölçü çizgisi layer'larını atla
                        if (entity.layer && (
                            entity.layer.includes('DIM') || 
                            entity.layer.includes('DIMENSION') ||
                            entity.layer.includes('*ADSK_ASSOC_ENTITY_BACKUPS') ||
                            entity.layer.includes('DEFPOINTS')
                        )) {
                            debug.log('[DXF Scene Builder] Skipping dimension layer:', entity.layer);
                            break;
                        }
                        
                        // Sistem block'larını atla
                        if (entity.name.includes('*S') && entity.name.length <= 3) {
                            debug.log('[DXF Scene Builder] Skipping system block:', entity.name);
                            break;
                        }
                        
                        // Sadece gerçek geometri için fallback çember oluştur
                        debug.log('[DXF Scene Builder] Creating fallback circle for missing block:', entity.name);
                        
                        // Basit çember oluştur (INSERT pozisyonunda)
                        const insertPoint = entity.position || { x: 0, y: 0, z: 0 };
                        const radius = entity.scaleX || 10; // Varsayılan yarıçap
                        
                        const circleGeometry = new THREE.BufferGeometry();
                        const circlePoints: number[] = [];
                        const segments = 32;
                        
                        for (let i = 0; i <= segments; i++) {
                            const angle = (i / segments) * Math.PI * 2;
                            circlePoints.push(
                                insertPoint.x + radius * Math.cos(angle),
                                insertPoint.y + radius * Math.sin(angle),
                                insertPoint.z || 0
                            );
                        }
                        
                        circleGeometry.setFromPoints(
                            circlePoints.map((_, i) => 
                                new THREE.Vector3(circlePoints[i*3], circlePoints[i*3+1], circlePoints[i*3+2])
                            )
                        );
                        
                        const circleLine = new Line2(
                            new LineGeometry().setPositions(circlePoints),
                            defaultMaterial
                        );
                        
                        circleLine.position.set(insertPoint.x, insertPoint.y, insertPoint.z || 0);
                        circleLine.userData = {
                            type: 'CIRCLE',
                            layer: entity.layer || '0',
                            handle: entity.handle || 'fallback',
                            data: {
                                center: insertPoint,
                                radius: radius,
                                type: 'CIRCLE'
                            }
                        };
                        
                        groupToAdd.add(circleLine);
                        debug.log('[DXF Scene Builder] Fallback circle created at:', insertPoint);
                    }
                    break;
                }
                
                const block = parsedData.blocks[entity.name];
                const insertPoint = entity.position || { x: 0, y: 0, z: 0 };
                const scale = entity.scaleFactors || { x: 1, y: 1, z: 1 };
                const rotationDeg = entity.rotation || 0;
                const rotationRad = rotationDeg * (Math.PI / 180);
                
                // Mevcut transform'ları birleştir
                const combinedInsertPoint = transformPoint(insertPoint, currentInsertPoint, currentScale, currentRotationRad, 0, centeringOffset);
                const combinedScale = {
                    x: (currentScale.x || 1) * (scale.x || 1),
                    y: (currentScale.y || 1) * (scale.y || 1),
                    z: (currentScale.z || 1) * (scale.z || 1)
                };
                const combinedRotation = currentRotationRad + rotationRad;
                
                // Block içindeki entities'leri işle
                if (block.entities) {
                    block.entities.forEach((blockEntity: any) => {
                        processEntity(
                            blockEntity,
                            parsedData,
                            groupToAdd,
                            defaultMaterial,
                            existingCenterPoints,
                            {
                                x: combinedInsertPoint.x,
                                y: combinedInsertPoint.y,
                                z: combinedInsertPoint.z
                            },
                            combinedScale,
                            combinedRotation,
                            depth + 1,
                            stats,
                            // centeringOffset'i burada geçirmeyin, çünkü zaten combinedInsertPoint'te uygulandı
                        );
                    });
                }
                
                stats.insertsProcessed++;
                break;
            }

            default:
                // Desteklenmeyen entity türleri için uyarı
                debug.log(`Unsupported entity type: ${entity.type}`);
                break;
        }
        
        stats.totalEntitiesProcessed++;
    } catch (error) {
        console.error(`Error processing ${entity.type} entity:`, error, entity);
    }
}

export const buildSceneFromParsedData = (parsedData: any, defaultMaterial: LineMaterial): THREE.Group => {
    const mainGroup = new THREE.Group();
    const existingCenterPoints = new Map<string, { type: string, handle: string }>();
    
    // İstatistik objesi oluştur
    const stats: DxfStats = {
        totalEntitiesProcessed: 0,
        linesAdded: 0,
        circlesAdded: 0,
        arcsAdded: 0,
        insertsProcessed: 0,
        polylinesAdded: 0,
        splinesAdded: 0,
        ellipsesAdded: 0,
        centerPointsAdded: 0,
        pointsAdded: 0
    };
    
    // Centering offset hesapla
    const centeringOffset = calculateCenteringOffset(parsedData);
    //debug.log(`Applying centering offset: (${centeringOffset.x}, ${centeringOffset.y})`);
    
   // debug.log('[DXF Scene Builder] Processing entities...');
    
    // Block bilgilerini debug et
    if (parsedData.blocks) {
      //  debug.log('[DXF Scene Builder] Available blocks:', Object.keys(parsedData.blocks));
    } else {
        debug.warn('[DXF Scene Builder] No blocks found in parsed data');
    }
    
    // Ana entities'leri işle
    if (parsedData.entities && Array.isArray(parsedData.entities)) {
        parsedData.entities.forEach((entity: any) => {
            processEntity(
                entity,
                parsedData,
                mainGroup,
                defaultMaterial,
                existingCenterPoints,
                { x: 0, y: 0, z: 0 }, // currentInsertPoint
                { x: 1, y: 1, z: 1 }, // currentScale
                0, // currentRotationRad
                0, // depth
                stats,
                centeringOffset
            );
        });
    }
    
    debug.log('[DXF Scene Builder] Processing completed. Stats:', stats);

    // Çizgi / yay / spline (ve açık elips) uçları — yakın uçlar tek seçilebilir noktada birleştirilir
    addMergedVertexEndpoints(mainGroup, defaultMaterial, stats);
    
    // İstatistikleri mainGroup'a ekle
    mainGroup.userData.stats = stats;
    mainGroup.userData.centeringOffset = centeringOffset;
    
    return mainGroup;
}

const calculateRobustCenteringOffset = (parsedData: any): THREE.Vector3 | null => {
    const xs: number[] = [];
    const ys: number[] = [];

    const simpleTransform = (
        point: { x: number, y: number, z?: number },
        insertPoint = { x: 0, y: 0, z: 0 },
        scale = { x: 1, y: 1, z: 1 },
        rotationRad = 0
    ): { x: number, y: number, z: number } => {
        const v = new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
        v.multiply(new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1));
        v.applyAxisAngle(new THREE.Vector3(0, 0, 1), rotationRad);
        v.add(new THREE.Vector3(insertPoint.x || 0, insertPoint.y || 0, insertPoint.z || 0));
        return { x: v.x, y: v.y, z: v.z };
    };

    const pushPt = (x: number, y: number) => { if (isFinite(x) && isFinite(y)) { xs.push(x); ys.push(y); } };

    const processEntityPts = (
        entity: any,
        insertPoint = { x: 0, y: 0, z: 0 },
        scale = { x: 1, y: 1, z: 1 },
        rotationRad = 0
    ) => {
        switch (entity.type) {
            case 'LINE': {
                if (entity.vertices && entity.vertices.length) {
                    entity.vertices.forEach((v: any) => {
                        const p = simpleTransform({ x: v.x, y: v.y, z: v.z || 0 }, insertPoint, scale, rotationRad);
                        pushPt(p.x, p.y);
                    });
                }
                break;
            }
            case 'LWPOLYLINE':
            case 'POLYLINE': {
                if (entity.vertices && entity.vertices.length) {
                    entity.vertices.forEach((v: any) => {
                        const p = simpleTransform({ x: v.x, y: v.y, z: v.z || entity.elevation || 0 }, insertPoint, scale, rotationRad);
                        pushPt(p.x, p.y);
                    });
                }
                break;
            }
            case 'CIRCLE': {
                if (entity.center && typeof entity.radius === 'number') {
                    for (let i = 0; i < 8; i++) {
                        const angle = (i * Math.PI * 2) / 8;
                        const local = { x: entity.center.x + entity.radius * Math.cos(angle), y: entity.center.y + entity.radius * Math.sin(angle), z: entity.center.z || 0 };
                        const p = simpleTransform(local, insertPoint, scale, rotationRad);
                        pushPt(p.x, p.y);
                    }
                }
                break;
            }
            case 'ARC': {
                if (entity.center && typeof entity.radius === 'number') {
                    let start = entity.startAngle ?? 0;
                    let end = entity.endAngle ?? Math.PI * 2;
                    if (end <= start) end += Math.PI * 2;
                    const mid = (start + end) / 2;
                    [start, mid, end].forEach(ang => {
                        const local = { x: entity.center.x + entity.radius * Math.cos(ang), y: entity.center.y + entity.radius * Math.sin(ang), z: entity.center.z || 0 };
                        const p = simpleTransform(local, insertPoint, scale, rotationRad);
                        pushPt(p.x, p.y);
                    });
                }
                break;
            }
            case 'ELLIPSE': {
                if (entity.center && entity.majorAxisEndPoint && typeof entity.axisRatio === 'number') {
                    // Ana/ara eksen yönünde birkaç nokta örnekle
                    const axis = new THREE.Vector3(entity.majorAxisEndPoint.x, entity.majorAxisEndPoint.y, entity.majorAxisEndPoint.z || 0);
                    const a = axis.length();
                    const b = a * (entity.axisRatio || 1);
                    const rot = Math.atan2(axis.y, axis.x);
                    const samples = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
                    samples.forEach(t => {
                        const xLocal = a * Math.cos(t);
                        const yLocal = b * Math.sin(t);
                        const xr = xLocal * Math.cos(rot) - yLocal * Math.sin(rot);
                        const yr = xLocal * Math.sin(rot) + yLocal * Math.cos(rot);
                        const local = { x: (entity.center.x || 0) + xr, y: (entity.center.y || 0) + yr, z: entity.center.z || 0 };
                        const p = simpleTransform(local, insertPoint, scale, rotationRad);
                        pushPt(p.x, p.y);
                    });
                }
                break;
            }
            case 'INSERT': {
                const blockName = entity.name;
                if (blockName && parsedData.blocks && parsedData.blocks[blockName]) {
                    const block = parsedData.blocks[blockName];
                    const insertPos = entity.position || { x: 0, y: 0, z: 0 };
                    const insertScale = entity.scale || entity.scaleFactors || { x: 1, y: 1, z: 1 };
                    const insertRotation = (entity.rotation || 0) * Math.PI / 180;

                    const combinedInsertPoint = simpleTransform(insertPos, insertPoint, scale, rotationRad);
                    const combinedScale = {
                        x: (scale.x || 1) * (insertScale.x || 1),
                        y: (scale.y || 1) * (insertScale.y || 1),
                        z: (scale.z || 1) * (insertScale.z || 1)
                    };
                    const combinedRotation = rotationRad + insertRotation;

                    if (block.entities) block.entities.forEach((be: any) => processEntityPts(be, combinedInsertPoint, combinedScale, combinedRotation));
                }
                break;
            }
            default:
                break;
        }
    };

    if (parsedData.entities && Array.isArray(parsedData.entities)) {
        parsedData.entities.forEach((e: any) => processEntityPts(e));
    }

    if (xs.length < 3 || ys.length < 3) {
       // debug.log('[DXF Centering] Robust yöntem için yeterli nokta yok');
        return null;
    }

    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
//debug.log(`[DXF Centering] Robust merkez hesaplandı: (${centerX.toFixed(3)}, ${centerY.toFixed(3)})`);
  //  debug.log(`[DXF Centering] ${xs.length} nokta örneklendi`);
    return new THREE.Vector3(-centerX, -centerY, 0);
};

// Export all necessary functions and types
export {
    generateEllipseVertices,
    calculateBoundingBox,
    calculateLargestCircleCenteringOffset,
    calculateCenteringOffset,
    calculateRobustCenteringOffset,
    transformPoint,
    getOptimalSegmentCount,
    createLine2Object,
    createCenterPointObject,
    createPointObject,
    processEntity
};

export type { EntityData, DxfStats };