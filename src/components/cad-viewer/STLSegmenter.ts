// src/components/cad-viewer/STLSegmenter.ts
import * as THREE from 'three';
import { debug } from '@/Utils/debug';

interface FaceGroup {
  triangles: number[];
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
}

/**
 * STL mesh'lerini normal vektörlerine göre yüzeylere ayırır
 * Region growing algoritması kullanır
 */
export class STLSegmenter {
  private angleThreshold: number; // Radyan cinsinden

  /**
   * @param angleThreshold - Normal açı farkı threshold (derece)
   */
  constructor(angleThreshold: number = 10) {
    this.angleThreshold = angleThreshold * Math.PI / 180; // Derece → Radyan
    debug.log('[STL Segmenter] Initialized with angle threshold:', angleThreshold, 'degrees');
  }

  /**
   * Mesh'i yüzeylere ayır
   */
  segmentMesh(geometry: THREE.BufferGeometry): THREE.Mesh[] {
    debug.log('[STL Segmenter] Starting segmentation...');
    
    geometry.computeVertexNormals();
    
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const triangleCount = position.count / 3;

    debug.log('[STL Segmenter] Triangle count:', triangleCount);

    // Her üçgenin face normal'ini hesapla (vertex normal'ları ortalaması)
    const triangleNormals: THREE.Vector3[] = [];
    for (let i = 0; i < triangleCount; i++) {
      const n1 = new THREE.Vector3().fromBufferAttribute(normal, i * 3);
      const n2 = new THREE.Vector3().fromBufferAttribute(normal, i * 3 + 1);
      const n3 = new THREE.Vector3().fromBufferAttribute(normal, i * 3 + 2);
      
      // Ortala ve normalize et
      const avgNormal = n1.add(n2).add(n3).divideScalar(3).normalize();
      triangleNormals.push(avgNormal);
    }

    // Komşuluk haritası oluştur (edge-based)
    debug.log('[STL Segmenter] Building adjacency map...');
    const adjacency = this.buildAdjacency(geometry);
    debug.log('[STL Segmenter] Adjacency map built, edges:', adjacency.size);

    // Region growing ile grupla
    debug.log('[STL Segmenter] Running region growing...');
    const groups = this.regionGrowing(triangleNormals, adjacency, geometry);
    debug.log('[STL Segmenter] Found', groups.length, 'face groups');

    // Her grup için ayrı mesh oluştur
    debug.log('[STL Segmenter] Creating meshes from groups...');
    const meshes = this.createMeshesFromGroups(geometry, groups);
    debug.log('[STL Segmenter] Segmentation complete:', meshes.length, 'meshes created');

    return meshes;
  }

  /**
   * Edge-based adjacency map oluştur
   */
  private buildAdjacency(geometry: THREE.BufferGeometry): Map<number, Set<number>> {
    const position = geometry.attributes.position;
    const adjacency = new Map<number, Set<number>>();
    
    // Edge → triangle mapping
    const edgeMap = new Map<string, number[]>();
    
    for (let i = 0; i < position.count; i += 3) {
      const triIndex = i / 3;
      
      // Üçgenin 3 edge'i
      for (let j = 0; j < 3; j++) {
        const v1Idx = i + j;
        const v2Idx = i + ((j + 1) % 3);
        
        const v1 = new THREE.Vector3().fromBufferAttribute(position, v1Idx);
        const v2 = new THREE.Vector3().fromBufferAttribute(position, v2Idx);
        
        // Edge key (küçük index önce)
        const key = this.getEdgeKey(v1, v2);
        
        if (!edgeMap.has(key)) {
          edgeMap.set(key, []);
        }
        edgeMap.get(key)!.push(triIndex);
      }
    }

    // Komşuları bağla (shared edge = neighbor)
    edgeMap.forEach(triangles => {
      if (triangles.length === 2) {
        const [t1, t2] = triangles;
        if (!adjacency.has(t1)) adjacency.set(t1, new Set());
        if (!adjacency.has(t2)) adjacency.set(t2, new Set());
        adjacency.get(t1)!.add(t2);
        adjacency.get(t2)!.add(t1);
      }
    });

    return adjacency;
  }

  /**
   * Edge key oluştur (vertex pozisyonlarına göre)
   */
  private getEdgeKey(v1: THREE.Vector3, v2: THREE.Vector3): string {
    const precision = 3; // 0.001 hassasiyet (daha toleranslı)
    const hash = (v: THREE.Vector3) => 
      `${v.x.toFixed(precision)},${v.y.toFixed(precision)},${v.z.toFixed(precision)}`;
    
    const h1 = hash(v1);
    const h2 = hash(v2);
    // Alfabetik sıra (consistent key)
    return h1 < h2 ? `${h1}-${h2}` : `${h2}-${h1}`;
  }

  /**
   * Region growing algoritması ile benzer normalli üçgenleri grupla
   */
  private regionGrowing(
    normals: THREE.Vector3[], 
    adjacency: Map<number, Set<number>>,
    geometry: THREE.BufferGeometry
  ): FaceGroup[] {
    const visited = new Set<number>();
    const groups: FaceGroup[] = [];
    const position = geometry.attributes.position;

    for (let seed = 0; seed < normals.length; seed++) {
      if (visited.has(seed)) continue;

      const group: FaceGroup = {
        triangles: [],
        normal: normals[seed].clone(),
        centroid: new THREE.Vector3()
      };

      const queue = [seed];
      visited.add(seed);

      while (queue.length > 0) {
        const current = queue.shift()!;
        group.triangles.push(current);

        const neighbors = adjacency.get(current) || new Set();
        
        neighbors.forEach(neighbor => {
          if (visited.has(neighbor)) return;

          // Normal farkı threshold'dan küçük mü?
          const angle = normals[seed].angleTo(normals[neighbor]);
          
          if (angle < this.angleThreshold) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }

      // En az 1 üçgen olmalı (tüm yüzeyleri dahil et)
      if (group.triangles.length >= 1) {
        // Centroid hesapla
        group.triangles.forEach(triIdx => {
          for (let i = 0; i < 3; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(position, triIdx * 3 + i);
            group.centroid.add(v);
          }
        });
        group.centroid.divideScalar(group.triangles.length * 3);
        
        groups.push(group);
      }
    }

    // Büyükten küçüğe sırala (en büyük yüzeyler önce)
    groups.sort((a, b) => b.triangles.length - a.triangles.length);

    // İstatistikler
    const totalVisited = visited.size;
    const filteredCount = normals.length - totalVisited;
    if (filteredCount > 0) {
      debug.log(`[STL Segmenter] Note: ${filteredCount} isolated triangles filtered out`);
    }
    
    // Grup istatistikleri
    const triangleCounts = groups.map(g => g.triangles.length);
    const minTri = Math.min(...triangleCounts);
    const maxTri = Math.max(...triangleCounts);
    const avgTri = (triangleCounts.reduce((a, b) => a + b, 0) / triangleCounts.length).toFixed(1);
    debug.log(`[STL Segmenter] Face statistics: min=${minTri}, max=${maxTri}, avg=${avgTri} triangles per face`);

    return groups;
  }

  /**
   * Group'lardan ayrı mesh'ler oluştur
   */
  private createMeshesFromGroups(
    originalGeometry: THREE.BufferGeometry,
    groups: FaceGroup[]
  ): THREE.Mesh[] {
    const position = originalGeometry.attributes.position;
    const meshes: THREE.Mesh[] = [];

    groups.forEach((group, index) => {
      const vertices: number[] = [];
      const indices: number[] = [];
      const vertexMap = new Map<string, number>();

      group.triangles.forEach(triIndex => {
        for (let i = 0; i < 3; i++) {
          const vIdx = triIndex * 3 + i;
          const v = new THREE.Vector3().fromBufferAttribute(position, vIdx);
          
          // Vertex deduplication (daha toleranslı precision)
          const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
          
          if (!vertexMap.has(key)) {
            vertexMap.set(key, vertices.length / 3);
            vertices.push(v.x, v.y, v.z);
          }
          
          indices.push(vertexMap.get(key)!);
        }
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material = new THREE.MeshStandardMaterial({
        color: 0x808080,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
        flatShading: false
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.faceId = index;
      mesh.userData.isCADFace = true;
      mesh.userData.isSTLSegmented = true;
      mesh.userData.triangleCount = group.triangles.length;
      mesh.userData.faceNormal = group.normal.toArray();
      mesh.name = `STL_Face_${index}`;

      debug.log(`[STL Segmenter] Face ${index}: ${group.triangles.length} triangles, normal: (${group.normal.x.toFixed(2)}, ${group.normal.y.toFixed(2)}, ${group.normal.z.toFixed(2)})`);

      meshes.push(mesh);
    });

    return meshes;
  }
}

