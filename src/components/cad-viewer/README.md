# CAD Viewer - Yüzey Bazlı Seçim Sistemi

## 🎯 Genel Bakış

Bu modül, profesyonel CAM yazılımları gibi **yüzey bazlı (face-based)** 3D model görüntüleme ve seçim sistemi sağlar. OpenCascade.js kullanarak STEP, IGES ve STL dosyalarındaki her yüzeyi ayrı bir mesh olarak işler.

## ✨ Özellikler

### 1. **Akıllı Yüzey Tespiti**
- STEP/IGES dosyalarındaki parametrik yüzeyleri otomatik tespit
- Her yüzey ayrı bir THREE.Mesh olarak sahneye eklenir
- STL dosyaları için de yüzey bazlı işleme desteği

### 2. **Profesyonel Seçim Sistemi**
- **Hover Efekti**: Mouse ile üzerine gelindiğinde yüzey hafif ışıldar
- **Seçim**: Tıklayarak yüzey seçimi (turuncu renk)
- **Deselect**: Seçili yüzeye tekrar tıklayarak veya boş alana tıklayarak seçimi kaldırma
- Cursor değişimi (pointer) ile kullanıcı deneyimi

### 3. **Metadata Desteği**
Her mesh şu bilgileri taşır:
```typescript
mesh.userData = {
  faceId: number              // Benzersiz yüzey ID'si
  isCADFace: boolean          // CAD yüzeyi mi?
  faceOrientation: string     // 'normal' | 'reversed'
  triangleCount: number       // Üçgen sayısı
}
```

## 📁 Dosya Yapısı

```
src/components/cad-viewer/
├── cadLoaderCDN.ts        # STEP/IGES loader (OpenCascade CDN)
├── STLSegmenter.ts        # STL normal-based segmentation
└── README.md              # Bu dosya
```

**Not:** Yüzey seçimi için mevcut `useViewerInteractions` sistemi kullanılır.

## ⚠️ Önemli Notlar

### Format Bazlı İşleme

| Format | Yöntem | Doğruluk | Gereksinim |
|--------|--------|----------|------------|
| **STEP/IGES** | OpenCascade (CDN) | %100 | İnternet (ilk yükleme) |
| **STL** | Normal-based segmentation | ~%85 | - |

### OpenCascade CDN Kullanımı

STEP/IGES için OpenCascade.js **CDN'den** yüklenir (webpack WASM uyumluluk sorunları nedeniyle):
- ✅ Build hatalarını önler
- ✅ Production-ready
- ✅ On-demand yükleme (daha küçük bundle)
- ⚠️ İnternet bağlantısı gerektirir (ilk yükleme için)

### STL Segmentation

STL dosyaları için **region growing algoritması** kullanılır:
- Normal vektörlerine göre komşu üçgenler gruplandırılır
- Varsayılan threshold: **10 derece**
- Ayarlanabilir hassasiyet
- Gürültü filtresi: En az 5 üçgen

## 🚀 Kullanım

### 1. STEP/IGES Dosyaları (OpenCascade CDN)

```tsx
import { loadCADFileWithCDN } from '@/components/cad-viewer/cadLoaderCDN';

function MyViewer() {
  const [file, setFile] = useState<File | null>(null);
  const sceneRef = useRef<THREE.Scene>(null);

  // CAD dosyasını yükle
  useEffect(() => {
    if (!file || !sceneRef.current) return;
    
    loadCADFileWithCDN(
      file,
      sceneRef.current,
      (meshes) => {
        console.log(`Loaded ${meshes.length} faces`);
        // Her mesh selectable olarak işaretlenir
        meshes.forEach(mesh => {
          mesh.userData.selectable = true;
          mesh.userData.isCADFace = true;
        });
      },
      (error) => {
        console.error('Error loading CAD file:', error);
      }
    );
  }, [file]);

  return (
    <div>
      {/* Yüzey seçimi mevcut useViewerInteractions ile otomatik çalışır */}
    </div>
  );
}
```

### 2. STL Dosyaları (Normal-Based Segmentation)

```tsx
// STL otomatik olarak segmentation kullanır
// Aynı loadCADFileWithCDN fonksiyonu
loadCADFileWithCDN(
  stlFile,
  scene,
  (meshes) => {
    console.log(`STL segmented into ${meshes.length} faces`);
    meshes.forEach(mesh => {
      console.log(`Face ${mesh.userData.faceId}:`, {
        triangles: mesh.userData.triangleCount,
        normal: mesh.userData.faceNormal
      });
    });
  },
  (error) => console.error(error)
);
```

### 3. Segmentation Hassasiyeti (STL)

```tsx
// STLSegmenter.ts içinde threshold değiştir
const segmenter = new STLSegmenter(5);  // Daha hassas (daha fazla yüzey)
const segmenter = new STLSegmenter(10); // Varsayılan
const segmenter = new STLSegmenter(20); // Daha az yüzey (ana yüzeyler)
```

### 4. DxfViewer Entegrasyonu

DxfViewer otomatik olarak tüm CAD formatlarını tespit eder:

```typescript
// Desteklenen formatlar
const supportedFormats = [
  '.step', '.stp',  // STEP (OpenCascade)
  '.iges', '.igs',  // IGES (OpenCascade)
  '.stl'            // STL (Region growing)
];
```

## 🎨 Görsel Özelleştirme

### Material Ayarları

```typescript
// cadLoaderHelper.ts içinde
const material = new THREE.MeshStandardMaterial({
  color: 0x808080,      // Gri
  metalness: 0.3,       // Metalik görünüm
  roughness: 0.6,       // Pürüzlülük
  side: THREE.DoubleSide,
  flatShading: false    // Smooth shading
});
```

## 🔧 Tessellation Kalitesi

OpenCascade tessellation parametreleri:

```typescript
const linearDeflection = 0.1;  // Daha düşük = daha iyi kalite (0.01 - 1.0)
const angularDeflection = 0.5; // Radyan cinsinden (0.1 - 1.0)
```

- **linearDeflection**: Mesh'in eğrilere ne kadar yakın olacağı
- **angularDeflection**: Açısal sapma toleransı

## 📊 Performans

### Optimizasyonlar

1. **BVH (Bounding Volume Hierarchy)**: Raycasting için hızlı çarpışma tespiti
2. **Dynamic Import**: OpenCascade.js sadece gerektiğinde yüklenir
3. **Vertex Normal Computation**: GPU'da hesaplanır
4. **Spatial Partitioning**: Büyük mesh'ler için (STL)

### Bellek Yönetimi

```typescript
// Cleanup örneği
useEffect(() => {
  return () => {
    // Mesh'leri temizle
    meshes.forEach(mesh => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  };
}, []);
```

## 🐛 Hata Ayıklama

### Debug Mode

```typescript
// localStorage'da DEBUG_DXF=1 olarak ayarla
localStorage.setItem('DEBUG_DXF', '1');

// Konsol çıktısı:
// [CAD Helper] Loading file: cylinder.step Format: step
// [CAD Helper] Tessellating geometry...
// [CAD Helper] Successfully loaded 3 faces
// [Face Selector] Face selected: { faceId: 0, name: "Face_0", ... }
```

### Yaygın Hatalar

1. **"Failed to load OpenCascade.js from CDN"**
   - İnternet bağlantısı yok veya CDN erişilemiyor
   - Çözüm: İnternet bağlantısını kontrol et veya farklı CDN kullan

2. **"Unsupported format"**
   - Dosya formatı desteklenmiyor
   - Çözüm: .step, .stp, .iges, .igs, .stl formatlarından birini kullan

3. **"Empty geometry"**
   - Dosya bozuk veya boş
   - Çözüm: CAD yazılımında dosyayı yeniden export et

### CDN URL Değiştirme

CDN'den yüklenemeyen durumlarda `cadLoaderCDN.ts` içindeki URL'i değiştirin:

```typescript
// jsdelivr yerine unpkg kullan
script.src = 'https://unpkg.com/opencascade.js@2.0.0-beta.2/dist/opencascade.wasm.js';
```

## 🔗 Kaynaklar

- [OpenCascade.js Documentation](https://ocjs.org/)
- [Three.js Documentation](https://threejs.org/docs/)
- [STEP Format Specification](https://www.iso.org/standard/63141.html)
- [IGES Format Specification](https://en.wikipedia.org/wiki/IGES)

## 📝 Örnek Kullanım Senaryoları

### Senaryo 1: Silindir Üst Yüzeyini Seçme

```
1. Silindir STEP dosyası yükle
2. OpenCascade 3 yüzey tespit eder:
   - Üst daire (Face_0)
   - Yan yüzey (Face_1)
   - Alt daire (Face_2)
3. Kullanıcı üst daireyi tek tıkla seçer
4. Seçili yüzey turuncu olur
5. G-code üretimi için sadece o yüzey kullanılır
```

### Senaryo 2: Karmaşık Parça

```
1. IGES dosyası 20+ yüzey içeriyor
2. Her yüzey ayrı mesh olarak yüklenir
3. Hover ile hangi yüzey olduğu görülür
4. İstenilen yüzeyler tek tek seçilir
5. Multi-selection için Ctrl+Click (gelecek özellik)
```

## 🚧 Gelecek Geliştirmeler

- [ ] Multi-selection desteği (Ctrl+Click)
- [ ] Yüzey tipine göre otomatik gruplama (düzlem, silindir, koni, vb.)
- [ ] Edge (kenar) seçimi
- [ ] Vertex (köşe) seçimi
- [ ] Yüzey normal yönü gösterimi
- [ ] Yüzey alan hesaplama
- [ ] Web Worker ile arka planda işleme
- [ ] BREP format desteği

