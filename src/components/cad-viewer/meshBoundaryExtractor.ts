// src/components/cad-viewer/meshBoundaryExtractor.ts

import * as THREE from 'three';
import { debug } from '@/Utils/debug';

/**
 * Mesh'in boundary edges'lerini (sınır çizgilerini) çıkarır
 * Boundary edge = Sadece 1 triangle tarafından kullanılan edge (shared değil)
 * 
 * @param useLocalCoordinates - true ise local coordinates kullan (mesh child olarak eklenecekse)
 */
export function extractMeshBoundaryEdges(
  mesh: THREE.Mesh,
  useLocalCoordinates: boolean = true
): THREE.Vector3[][] {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const index = geometry.index;
  
  if (!position) {
    debug.warn('[BoundaryExtractor] No position attribute found');
    return [];
  }
  
  // World transform uygula (sadece world coordinates gerekiyorsa)
  mesh.updateMatrixWorld(true);
  const matrix = useLocalCoordinates ? new THREE.Matrix4() : mesh.matrixWorld;
  
  // Edge map: Her edge'i kaç triangle kullanıyor?
  // Key: "minVertexIndex_maxVertexIndex" (küçük index önce)
  const edgeCount = new Map<string, {
    v1: THREE.Vector3;
    v2: THREE.Vector3;
    count: number;
  }>();
  
  const getEdgeKey = (i1: number, i2: number): string => {
    return i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
  };
  
  const getVertex = (idx: number): THREE.Vector3 => {
    const v = new THREE.Vector3(
      position.getX(idx),
      position.getY(idx),
      position.getZ(idx)
    );
    if (!useLocalCoordinates) {
      v.applyMatrix4(matrix);
    }
    return v;
  };
  
  // Triangle'ları tara ve edge'leri say
  if (index) {
    // Indexed geometry
    for (let i = 0; i < index.count; i += 3) {
      const i1 = index.getX(i);
      const i2 = index.getX(i + 1);
      const i3 = index.getX(i + 2);
      
      // Üçgenin 3 kenarı
      const edges = [
        [i1, i2],
        [i2, i3],
        [i3, i1]
      ];
      
      edges.forEach(([a, b]) => {
        const key = getEdgeKey(a, b);
        const existing = edgeCount.get(key);
        
        if (existing) {
          existing.count++;
        } else {
          edgeCount.set(key, {
            v1: getVertex(a),
            v2: getVertex(b),
            count: 1
          });
        }
      });
    }
  } else {
    // Non-indexed geometry
    for (let i = 0; i < position.count; i += 3) {
      const i1 = i;
      const i2 = i + 1;
      const i3 = i + 2;
      
      const edges = [
        [i1, i2],
        [i2, i3],
        [i3, i1]
      ];
      
      edges.forEach(([a, b]) => {
        const key = getEdgeKey(a, b);
        const existing = edgeCount.get(key);
        
        if (existing) {
          existing.count++;
        } else {
          edgeCount.set(key, {
            v1: getVertex(a),
            v2: getVertex(b),
            count: 1
          });
        }
      });
    }
  }
  
  // Boundary edges: count === 1 olanlar
  const boundaryEdges: THREE.Vector3[][] = [];
  
  edgeCount.forEach((edge) => {
    if (edge.count === 1) {
      boundaryEdges.push([edge.v1, edge.v2]);
    }
  });
  
  debug.log(`[BoundaryExtractor] Found ${boundaryEdges.length} boundary edges out of ${edgeCount.size} total edges for mesh: ${mesh.userData?.handle || mesh.uuid}`);
  
  if (boundaryEdges.length > 0) {
    // İlk birkaç edge'i debug için göster
    const firstEdge = boundaryEdges[0];
    debug.log(`[BoundaryExtractor] Sample edge: [${firstEdge[0].toArray().join(',')}] -> [${firstEdge[1].toArray().join(',')}]`);
  }
  
  return boundaryEdges;
}

/**
 * Boundary edges'leri connected polylines'lara birleştir
 * Daha verimli görselleştirme için
 */
export function connectBoundaryEdges(edges: THREE.Vector3[][]): THREE.Vector3[][] {
  if (edges.length === 0) return [];
  
  const polylines: THREE.Vector3[][] = [];
  const usedEdges = new Set<number>();
  const tolerance = 1e-6;
  
  const arePointsEqual = (p1: THREE.Vector3, p2: THREE.Vector3): boolean => {
    return p1.distanceTo(p2) < tolerance;
  };
  
  for (let i = 0; i < edges.length; i++) {
    if (usedEdges.has(i)) continue;
    
    const polyline: THREE.Vector3[] = [edges[i][0].clone(), edges[i][1].clone()];
    usedEdges.add(i);
    
    let foundConnection = true;
    
    // Polyline'ı extend et - başına ve sonuna edge'ler ekle
    while (foundConnection) {
      foundConnection = false;
      
      for (let j = 0; j < edges.length; j++) {
        if (usedEdges.has(j)) continue;
        
        const edge = edges[j];
        const firstPoint = polyline[0];
        const lastPoint = polyline[polyline.length - 1];
        
        // Polyline başına bağlan
        if (arePointsEqual(edge[1], firstPoint)) {
          polyline.unshift(edge[0].clone());
          usedEdges.add(j);
          foundConnection = true;
        } else if (arePointsEqual(edge[0], firstPoint)) {
          polyline.unshift(edge[1].clone());
          usedEdges.add(j);
          foundConnection = true;
        }
        // Polyline sonuna bağlan
        else if (arePointsEqual(edge[0], lastPoint)) {
          polyline.push(edge[1].clone());
          usedEdges.add(j);
          foundConnection = true;
        } else if (arePointsEqual(edge[1], lastPoint)) {
          polyline.push(edge[0].clone());
          usedEdges.add(j);
          foundConnection = true;
        }
        
        if (foundConnection) break;
      }
    }
    
    polylines.push(polyline);
  }
  
  debug.log(`[BoundaryExtractor] Connected ${edges.length} edges into ${polylines.length} polylines`);
  
  return polylines;
}

/**
 * Sadece tamamen aynı noktalardan geçen edge'leri filtrele (çok konservatif)
 */
function filterDuplicateEdges(edges: THREE.Vector3[][], tolerance: number = 1e-6): THREE.Vector3[][] {
  const filteredEdges: THREE.Vector3[][] = [];
  
  for (const edge of edges) {
    if (edge.length < 2) continue;
    
    let isDuplicate = false;
    
    // Mevcut edge'lerle karşılaştır - sadece tamamen aynı olanları filtrele
    for (const existingEdge of filteredEdges) {
      if (existingEdge.length !== edge.length) continue;
      
      // Her nokta çiftini karşılaştır
      let allPointsMatch = true;
      for (let i = 0; i < edge.length; i++) {
        const distance = edge[i].distanceTo(existingEdge[i]);
        if (distance > tolerance) {
          allPointsMatch = false;
          break;
        }
      }
      
      // Tamamen aynı edge bulundu - skip et
      if (allPointsMatch) {
        isDuplicate = true;
        break;
      }
      
      // Ters çevrilmiş versiyonunu da kontrol et
      allPointsMatch = true;
      for (let i = 0; i < edge.length; i++) {
        const distance = edge[i].distanceTo(existingEdge[edge.length - 1 - i]);
        if (distance > tolerance) {
          allPointsMatch = false;
          break;
        }
      }
      
      if (allPointsMatch) {
        isDuplicate = true;
        break;
      }
    }
    
    // Duplicate değilse ekle
    if (!isDuplicate) {
      filteredEdges.push(edge);
    }
  }
  
  debug.log(`[BoundaryExtractor] Filtered duplicate edges: ${edges.length} -> ${filteredEdges.length}`);
  return filteredEdges;
}

/**
 * Boundary edges'lerini Three.js Line objelerine dönüştür (selectable)
 * Line2 yerine normal THREE.Line kullanıyoruz - daha stabil ve kolay debug
 */
export function createBoundaryLineObjects(
  mesh: THREE.Mesh,
  color: number = 0xffffff, // ✅ Beyaz (default) - DXF line'ları gibi
  lineWidth: number = 2
): THREE.Line[] {
  // ✅ Local coordinates kullan - mesh'in child'ı olarak ekleneceği için
  const edges = extractMeshBoundaryEdges(mesh, true);
  
  // ✅ Sadece tamamen aynı edge'leri filtrele (çok konservatif)
  const filteredEdges = filterDuplicateEdges(edges, 1e-6); // 1e-6mm tolerance - sadece gerçek duplicate'ları filtrele
  const polylines = connectBoundaryEdges(filteredEdges);
  
  const lineObjects: THREE.Line[] = [];
  
  polylines.forEach((polyline, index) => {
    if (polyline.length < 2) return;
    
    // BufferGeometry oluştur
    const geometry = new THREE.BufferGeometry();
    
    // Points array hazırla
    const positions: number[] = [];
    polyline.forEach(point => {
      positions.push(point.x, point.y, point.z);
    });
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    
    // ✅ LineBasicMaterial - DXF line'ları ile aynı renk sistemi
    // linewidth parametresi WebGL'de genelde çalışmaz, ama yine de ayarla
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff, // ✅ Beyaz (default) - DXF line'ları gibi
      linewidth: Math.max(lineWidth, 1), // WebGL'de genelde 1'den büyük çalışmaz ama dene
      depthTest: false, // Mesh'in önünde görünsün
      depthWrite: false,
      transparent: true,
      opacity: 1.0
    });
    
    // ✅ Kalın çizgi efekti için: Her edge'i iki kez çiz (hafif offset ile)
    // Bu WebGL linewidth limitasyonunu aşmak için basit bir workaround
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 999; // ✅ Mesh'in üstünde render et
    
    // Scale'i hafif büyüt - çizgileri daha kalın gösterir (visual trick)
    line.scale.set(1.001, 1.001, 1.001);
    
    // ✅ userData ekle - Selection için kritik!
    line.userData = {
      type: 'boundary_edge',
      handle: `boundary_${mesh.userData?.handle || mesh.uuid}_${index}`,
      selectable: true,
      sourceMesh: mesh,
      sourceMeshHandle: mesh.userData?.handle,
      boundaryIndex: index,
      pointCount: polyline.length,
      isBoundaryEdge: true // ✅ Raycaster için extra flag
    };
    
    lineObjects.push(line);
  });
  
  debug.log(`[BoundaryExtractor] Created ${lineObjects.length} selectable boundary line objects for mesh: ${mesh.userData?.handle || mesh.uuid}`);
  
  if (lineObjects.length > 0) {
    const firstLine = lineObjects[0];
    const material = firstLine.material as THREE.LineBasicMaterial;
    debug.log(`[BoundaryExtractor] First line object info:`, {
      type: firstLine.type,
      geometryVertices: firstLine.geometry.attributes.position.count,
      materialColor: material.color?.getHexString() || 'unknown',
      userData: firstLine.userData,
      visible: firstLine.visible
    });
  }
  
  return lineObjects;
}

/**
 * Mesh'e boundary edges ekle (child olarak - rotation ile birlikte dönecek)
 */
export function addBoundaryEdgesToMesh(
  mesh: THREE.Mesh,
  options?: {
    color?: number;
    lineWidth?: number;
  }
): THREE.Group {
  // Mesh için boundary group oluştur
  const boundaryGroup = new THREE.Group();
  boundaryGroup.name = `BoundaryEdges_${mesh.userData?.handle || mesh.uuid}`;
  boundaryGroup.userData = {
    type: 'boundary_group',
    selectable: false,
    sourceMeshHandle: mesh.userData?.handle
  };
  
  const boundaryLines = createBoundaryLineObjects(
    mesh,
    options?.color,
    options?.lineWidth
  );
  
  // ✅ NO OFFSET: Edge'ler mesh ile bire bir aynı olmalı (doğru ölçü için)
  
  boundaryLines.forEach(line => {
    boundaryGroup.add(line);
  });
  
  // Boundary group'u mesh'in child'ı olarak ekle - rotation ile birlikte dönecek!
  mesh.add(boundaryGroup);
  
  debug.log(`[BoundaryExtractor] Added ${boundaryLines.length} boundary lines to mesh: ${mesh.userData?.handle || mesh.uuid}`);
  
  return boundaryGroup;
}

/**
 * Tüm scene'deki mesh'lerin boundary'lerini çıkar ve her mesh'e ekle
 */
export function addBoundaryLinesToScene(
  scene: THREE.Scene,
  boundaryGroup?: THREE.Group, // Deprecated - artık kullanılmıyor
  options?: {
    color?: number;
    lineWidth?: number;
    onlySelectedMeshes?: THREE.Mesh[];
  }
): THREE.Group {
  // Scene-level group oluştur (deprecated ama geri dönüş için)
  const sceneGroup = new THREE.Group();
  sceneGroup.name = 'BoundaryEdges';
  sceneGroup.userData = {
    type: 'boundary_group_collection',
    selectable: false
  };
  
  const meshes = options?.onlySelectedMeshes || [];
  
  if (!options?.onlySelectedMeshes) {
    // Tüm mesh'leri topla
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry && obj.userData?.selectable) {
        meshes.push(obj);
      }
    });
  }
  
  debug.log(`[BoundaryExtractor] Processing ${meshes.length} meshes for boundary extraction`);
  
  let totalBoundaryLines = 0;
  
  meshes.forEach((mesh) => {
    const meshBoundaryGroup = addBoundaryEdgesToMesh(mesh, {
      color: options?.color,
      lineWidth: options?.lineWidth
    });
    
    totalBoundaryLines += meshBoundaryGroup.children.length;
  });
  
  debug.log(`[BoundaryExtractor] Added ${totalBoundaryLines} total boundary lines to ${meshes.length} meshes`);
  
  return sceneGroup; // Boş group döner ama geriye uyumluluk için
}

/**
 * Boundary lines'ları scene'den kaldır
 */
export function removeBoundaryLinesFromScene(scene: THREE.Scene): void {
  const boundaryGroup = scene.getObjectByName('BoundaryEdges');
  
  if (boundaryGroup) {
    // Geometry ve material'ları temizle
    boundaryGroup.traverse((obj) => {
      if (obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      }
    });
    
    scene.remove(boundaryGroup);
    debug.log('[BoundaryExtractor] Removed boundary lines from scene');
  }
}

/**
 * Boundary lines'ların görünürlüğünü toggle et
 */
export function toggleBoundaryLinesVisibility(scene: THREE.Scene, visible: boolean): void {
  const boundaryGroup = scene.getObjectByName('BoundaryEdges');
  
  if (boundaryGroup) {
    boundaryGroup.visible = visible;
    debug.log(`[BoundaryExtractor] Boundary lines visibility: ${visible}`);
  }
}

