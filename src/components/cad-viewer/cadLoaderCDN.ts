// src/components/cad-viewer/cadLoaderCDN.ts
// Load OCCT-Import-JS (better Next.js compatibility)

import * as THREE from 'three';
import { debug } from '@/Utils/debug';

let occtInstance: any = null;
let isLoading = false;
let loadPromise: Promise<any> | null = null;
let isOCCTAvailable: boolean | null = null; // null = not checked, true = available, false = unavailable

/**
 * OCCT-Import-JS'i yükle (STEP/IGES için)
 */
async function loadOpenCascadeFromCDN(): Promise<any> {
  if (occtInstance) return occtInstance;
  if (isLoading && loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = new Promise(async (resolve, reject) => {
    try {
      debug.log('[CAD Loader] Loading OCCT-Import-JS...');
      
      // Dynamic import - client-side only
      // @ts-ignore - no type definitions available for occt-import-js
      const occtModule: any = await import('occt-import-js');
      const initOCCT = occtModule.default || occtModule;
      
      if (!initOCCT) {
        throw new Error('Failed to import occt-import-js module');
      }
      
      debug.log('[CAD Loader] OCCT-Import-JS module loaded, initializing...');
      
      // Initialize OCCT with locateFile to find WASM files in public directory
      occtInstance = await initOCCT({
        locateFile: (path: string) => {
          // WASM files are in the public root directory
          if (path.endsWith('.wasm') || path.endsWith('.data')) {
            return `/${path}`;
          }
          return path;
        }
      });
      
      debug.log('[CAD Loader] OCCT-Import-JS initialized successfully');
      isLoading = false;
      resolve(occtInstance);
      
    } catch (error) {
      isLoading = false;
      isOCCTAvailable = false;
      debug.error('[CAD Loader] Failed to load OCCT-Import-JS:', error);
      debug.error('[CAD Loader] STEP/IGES support will not be available. Only STL files can be loaded.');
      reject(error);
    }
  });

  return loadPromise;
}

/**
 * OCCT (STEP/IGES) desteğinin olup olmadığını kontrol et
 */
export async function checkOCCTAvailability(): Promise<boolean> {
  if (isOCCTAvailable !== null) return isOCCTAvailable;
  
  try {
    await loadOpenCascadeFromCDN();
    isOCCTAvailable = true;
    return true;
  } catch (error) {
    isOCCTAvailable = false;
    return false;
  }
}

/**
 * CAD dosyasını CDN versiyonu ile yükle
 */
export async function loadCADFileWithCDN(
  file: File,
  scene: THREE.Scene,
  onLoad: (meshes: THREE.Mesh[]) => void,
  onError: (error: Error) => void
): Promise<void> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    debug.log('[CAD CDN] Loading file:', file.name, 'Format:', ext);
    const buffer = await file.arrayBuffer();
    
    // ✅ STL için OpenCascade'e gerek yok - early return
    if (ext === 'stl') {
      debug.log('[CAD CDN] Loading STL file with segmentation...');
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const { STLSegmenter } = await import('./STLSegmenter');
      
      const stlLoader = new STLLoader();
      const stlGeometry = stlLoader.parse(buffer);
      
      // Segmentation yap (10 derece threshold)
      const segmenter = new STLSegmenter(10);
      const meshes = segmenter.segmentMesh(stlGeometry);
      
      debug.log(`[CAD CDN] STL segmented into ${meshes.length} faces`);
      onLoad(meshes);
      return; // Başarılı - early return
    }
    
    // STEP/IGES için OCCT-Import-JS'i yükle
    const occt = await loadOpenCascadeFromCDN();
    
    debug.log('[CAD Loader] Reading file as buffer...');
    const fileBuffer = new Uint8Array(buffer);
    
    // Triangulation parametreleri
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.01,
      angularDeflection: 20
    };

    debug.log('[CAD Loader] Importing CAD file with OCCT...');
    
    let result: any;
    
    // Format'a göre doğru import fonksiyonunu çağır
    switch (ext) {
      case 'step':
      case 'stp':
        result = occt.ReadStepFile(fileBuffer, params);
        break;

      case 'iges':
      case 'igs':
        result = occt.ReadIgesFile(fileBuffer, params);
        break;

      default:
        throw new Error(`Desteklenmeyen format: ${ext}`);
    }

    if (!result.success) {
      throw new Error(`CAD dosyası import edilemedi`);
    }

    debug.log('[CAD Loader] CAD file imported successfully, converting to Three.js meshes...');
    debug.log('[CAD Loader] Meshes in result:', result.meshes?.length || 0);

    // OCCT result'ı Three.js mesh'lerine çevir
    const meshes: THREE.Mesh[] = [];

    if (result.meshes && result.meshes.length > 0) {
      result.meshes.forEach((meshData: any, meshIndex: number) => {
        // Her brep_face için ayrı mesh oluştur (yüzey bazlı seçim için)
        if (meshData.brep_faces && meshData.brep_faces.length > 0) {
          let faceIndex = 0;
          meshData.brep_faces.forEach((brepFace: any) => {
            const geometry = new THREE.BufferGeometry();
            
            // Position attribute
            const positions = new Float32Array(meshData.attributes.position.array);
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            
            // Normal attribute (if available)
            if (meshData.attributes.normal) {
              const normals = new Float32Array(meshData.attributes.normal.array);
              geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            }
            
            // Bu yüze ait triangle index'leri
            const faceIndices = meshData.index.array.slice(
              brepFace.first * 3,
              (brepFace.last + 1) * 3
            );
            geometry.setIndex(new THREE.Uint32BufferAttribute(faceIndices, 1));
            
            // Normal yoksa hesapla
            if (!meshData.attributes.normal) {
              geometry.computeVertexNormals();
            }
            
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            // Material - yüz rengini kullan
            const color = brepFace.color 
              ? new THREE.Color(brepFace.color[0] / 255, brepFace.color[1] / 255, brepFace.color[2] / 255)
              : new THREE.Color(0.8, 0.8, 0.8);

            const material = new THREE.MeshStandardMaterial({
              color: color,
              metalness: 0.3,
              roughness: 0.6,
              side: THREE.DoubleSide,
              flatShading: false
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData.faceId = faceIndex;
            mesh.userData.meshId = meshIndex;
            mesh.userData.isCADFace = true;
            mesh.userData.triangleCount = (brepFace.last - brepFace.first + 1);
            mesh.name = `${meshData.name || 'Mesh'}_Face_${faceIndex}`;
            
            meshes.push(mesh);
            faceIndex++;
          });
        }
      });
    }

    if (meshes.length === 0) {
      throw new Error('CAD dosyasından mesh oluşturulamadı');
    }

    debug.log(`[CAD Loader] Successfully created ${meshes.length} face meshes`);
    onLoad(meshes);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
    debug.error('[CAD CDN] Error loading CAD file:', error);
    
    // Daha açıklayıcı hata mesajı
    let userFriendlyError = errorMsg;
    if (errorMsg.includes('Failed to import') || errorMsg.includes('occt')) {
      userFriendlyError = `CAD dosyası yüklenemedi. OCCT-Import-JS modülü başlatılamadı.\n\nAlternatif: Dosyanızı STL formatında dışa aktarıp tekrar yüklemeyi deneyin.\n\nTeknik Detay: ${errorMsg}`;
    }
    
    onError(new Error(userFriendlyError));
  }
}

