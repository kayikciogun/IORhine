RhineCNC Sistem Mimarisi - Kapsamlı Analiz
1. Proje Hakkında
RhineCNC (IO-CAM Pick & Place), DXF dosyalarını işleyerek kristal/taş dizme (pick & place) CNC makinelerini kontrol eden bir web uygulamasıdır. Temel özellikler:

DXF/DWG Dosya İşleme: 2D CAD dosyalarını Three.js ile 3D görselleştirme
Taş Tipi Yönetimi: Farklı boyut/renk/Ofset değerlerine sahip taş türleri tanımlama
Strip Generator: Taşların konveyör bant üzerinde dizilme şablonu oluşturma
G-code Üretimi: Mach3/GRBL uyumlu CNC kodları üretme
Web Serial API: CNC makinesine doğrudan USB üzerinden bağlanma
2. Klasör Yapısı ve Ana Dosyalar
src/
├── app/
│   ├── page.tsx              # Ana sayfa (PickPlaceHome)
│   ├── layout.tsx            # Kök layout - Provider'lar burada
│   └── globals.css           # Tailwind CSS
├── components/
│   ├── dxf-viewer/           # DXF görüntüleyici
│   │   ├── DxfViewer.tsx     # Three.js tabanlı ana viewer
│   │   ├── dxfSceneBuilder.ts# DXF → Three.js sahnesi dönüştürücü
│   │   ├── useViewerInteractions.ts
│   │   ├── useSelection.tsx  # Seçim yönetimi
│   │   ├── useMobileViewerInteractions.ts
│   │   ├── geometryProperties.ts
│   │   ├── GeometryInfoCard.tsx
│   │   ├── vertexEndpointVisual.ts
│   │   ├── dwgToDxfConverter.ts
│   │   └── libredwg/         # DWG okuyucu (Rust/WASM)
│   ├── pick-place/           # Pick & Place UI
│   │   ├── StoneTypePanel.tsx
│   │   ├── StripPreview.tsx
│   │   └── GcodePanel.tsx
│   └── ui/                   # Radix UI bileşenleri
├── contexts/
│   ├── PickPlaceContext.tsx  # Taş tipleri, konfigürasyon state
│   └── DxfContext.tsx         # DXF dosya ve sahne state
├── operations/
│   ├── stripGenerator.ts     # Strip layout üretici
│   └── Mach3PostProcessor.ts# G-code üretici
├── services/
│   ├── webSerialGcodeSender.ts # Web Serial API ile CNC bağlantısı
│   └── pyodideGcodeSender.ts
├── types/
│   ├── pickplace.ts          # Ana tipler
│   └── index.ts
└── Utils/
    ├── offsetUtils.ts        # Cavalier Contours WASM offset
    ├── dxfWriter.ts          # DXF yazıcı
    ├── debug.ts              # Debug utilities
    └── contourAngle.ts       # Açı hesaplama
3. Temel Tipler (src/types/pickplace.ts)
// Taş tipi - her farklı kristal/taş için bir tanım
interface StoneType {
  id: string;
  name: string;           // "Swarovski 4mm kristal"
  color: string;          // "#E24B4A" - viewer'da renk
  pickZOffset: number;    // -3.5mm - alma derinliği
  placeZOffset: number;   // -1.0mm - bırakma derinliği
  contourIds: string[];   // DXF entity handle'ları
}
// Strip yapılandırması - taşların bant üzerinde dizilişi
interface StripConfig {
  cellSize: number;        // 20mm - her hücre boyutu
  cellGap: number;         // 0mm - hücreler arası boşluk
  contourOffset: number;   // 0.5mm - geçme payı (offset)
  rowLength: number;       // 10 - satır başına max taş
}
// Pick & Place makine konfigürasyonu
interface PickPlaceConfig {
  stripOriginX/Y: number;  // Strip'in başlangıç noktası
  rowLength: number;
  cellSize: number;
  safeZ: number;           // 10mm - güvenli yükseklik
  rapidFeed: number;       // 1000mm/dk
  pickFeed: number;        // 300mm/dk
  placeFeed: number;       // 200mm/dk
  rotationAxis: 'E' | 'A'; // Döndürme ekseni
  rotationFeed: number;
  vacuumOnCode: string;    // "M106 S255"
  vacuumOffCode: string;   // "M107"
  probeOffsetX/Y: number;  // Probe → Nozzle mesafesi
  probeNozzleOffsetZ: number;
  // ... probe ve diğer ayarlar
}
// Yerleştirme sırası - her taş için pick/place koordinatları
interface PlacementOrder {
  index: number;
  pickX, pickY, pickZ: number;  // Strip üzerinde alma noktası
  placeX, placeY, placeZ: number; // Kumaş üzerinde bırakma noktası
  placeAngle: number;            // Döndürme açısı
}
4. PickPlaceContext - Merkezi State Yönetimi
// PickPlaceProvider: Tüm pick-place state'ini yönetir
// Sağlanan state:
interface PickPlaceContextType {
  stoneTypes: StoneType[];           // Tüm taş tipleri
  activeStoneTypeId: string | null;   // Şu an seçili taş tipi
  pickPlaceConfig: PickPlaceConfig;   // Makine ayarları
  stripConfig: StripConfig;           // Strip boyutları
  
  // Metodlar:
  addStoneType()
  updateStoneType()
  removeStoneType()
  setActiveStoneTypeId()
  updatePickPlaceConfig()
  updateStripConfig()
  assignContoursToType()  // DXF kontürlerini taş tipine ata
  unassignContours()      // Kontür atamasını kaldır
  reorderStoneTypes()     // Taş tiplerini sırala
}
Context Akışı:

DXF Viewer (kontür seçimi)
    ↓
StoneTypePanel (atanan kontürler → stoneType.contourIds)
    ↓
PickPlaceContext güncellenir
    ↓
StripPreview / GcodePanel (veriyi kullanır)
5. stripGenerator.ts - Strip Üretimi
interface StripCell {
  x: number;
  y: number;
  stoneTypeId: string;
  color: string;
  originalHandle: string;  // DXF handle'u
  path: Path;             // Offset'li kontür şekli (Line/Arc)
}
// Ana fonksiyon: DXF scene + stoneTypes → StripCell[]
function generateStripData(
  scene: THREE.Scene,
  stoneTypes: StoneType[],
  config: StripConfig
): StripCell[] {
  // 1. Her stoneType'ın contourIds'ini tara
  // 2. Scene'den handle ile mesh'i bul
  // 3. Geometry'den vertex/kapalı bilgi çıkar
  // 4. Merkezi orijine taşı (lokal koordinat)
  // 5. Offset uygula (Cavalier Contours ile)
  // 6. Grid'e yerleştir (col = index % rowLength, row = floor(index / rowLength))
  // 7. StripCell oluştur
}
// DXF export
function exportStripToDxf(cells: StripCell[], config: StripConfig): string {
  // DXF Writer ile strip layout'u .dxf olarak kaydet
}
6. Mach3PostProcessor.ts - G-code Üretimi
İki ayrı G-code dosyası üretilir:

setup.nc - Probe referansı

Strip yüzeyini probe eder → #500 değişkenine kaydeder
Kumaş yüzeyini probe eder → #501 değişkenine kaydeder
Bir kez çalıştırılır, makine hafızasında kalır
pickplace.nc - Taş yerleştirme

#500 ve #501 kullanır
Her taş için: Pick → Döndür → Place → Sıfırla
Z Koordinatı Hesabı:

Pick Z  = #500 + probeNozzleOffsetZ + stone.pickZOffset
Place Z = #501 + probeNozzleOffsetZ + stone.placeZOffset
Ana Sınıf:

class Mach3PostProcessor {
  constructor(cfg: PickPlaceConfig)
  
  generate(
    orders: PlacementOrder[],
    stoneTypeMap: Map<string, StoneType>
  ): GcodeResult
}
// Helper fonksiyonlar:
buildPlacementOrders()  // Scene'den orders üretir
generateSetupGcode()    // Setup G-code üretir
firstStoneCoord()       // İlk taş pozisyonu (probe için)
7. DXF İşleme Akışı
DXF/DWG Dosya
     ↓
dwgToDxfConverter (DWG → DXF, LibreDWG WASM)
     ↓
DxfParser (dxf-parser库)
     ↓
buildSceneFromParsedData() 
     ↓
THREE.Group (mainGroup)
     ↓
DxfViewer.tsx'te render
dxfSceneBuilder.ts Ana İşlevler:

// Entity tipleri işlenir:
processEntity() {
  case 'LINE':      // İki nokta arası çizgi
  case 'CIRCLE':    // Merkez + radius → 96 segmentli polyline
  case 'ARC':       // Başlangıç/bitiş açısı ile yay
  case 'LWPOLYLINE': // Bulge'lı (kavisli) polyline
  case 'POLYLINE': 
  case 'SPLINE':    // NURBS veya Catmull-Rom
  case 'ELLIPSE':
  case 'INSERT':    // Block referansı (nested)
  case 'POINT':     // Tek nokta
}
// Her entity için:
1. Transform hesapla (INSERT için birleşik transform)
2. Offset uygula (centering)
3. Line2 veya Mesh oluştur
4. userData'ya type, handle, data'yı kaydet
5. Vertex endpoint'lerini merge et (snap noktaları)
8. DxfViewer - Three.js Görselleştirme
Ana Özellikler:

Dosya Yükleme: DXF, DWG, GLTF, GLB, OBJ, STL, FBX, 3DS, DAE
Kamera Kontrolü:
OrbitControls (2D için disabled)
Wheel zoom-to-cursor
Sağ tık rotation, orta tık pan
Seçim: Raycasting ile obje seçimi
Pick & Place Modu:
Taş tiplerine göre renklendirme
Aktif olmayanları soluklaştırma
Seçili kontürleri vurgulama
9. UI Bileşenleri
StoneTypePanel.tsx:

Yeni taş tipi ekleme (isim, renk, Z-ofsetleri)
Mevcut tipleri düzenleme/silme
DXF'den seçili kontürleri ata/çıkar
Taş tiplerini sıralama (yukarı/aşağı ok)
StripPreview.tsx:

Grid konfigürasyonu (X, hücre boyutu, offset)
SVG ile strip önizlemesi
DXF export butonu
GcodePanel.tsx:

USB bağlantı (Web Serial API)
Probe çalıştırma → #500/#501 kaydetme
G-code üret + gönder
Canlı log görüntüleme
İlerleme takibi
10. Web Serial Bağlantısı
class WebSerialGCodeSender {
  // Bağlantı
  requestPort()           // Port seçimi dialog
  connect(port, baudrate) // 115200 baud
  disconnect()
  
  // G-code gönderme
  async sendGCode(lines: string[]) {
    // 1. Temizle (cleanGCodeCommand)
    // 2. İlk buffer doldur (3-4 satır)
    // 3. ok/alındı kontrolü ile streaming
    // 4. Byte takibi ile buffer overflow önleme
  }
  
  stopSending()  // Acil durdurma
}
11. Kompleks Veri Akışı
┌─────────────────────────────────────────────────────────────────┐
│  1. DXF DOSYA YÜKLE                                              │
│  ┌──────────┐    ┌──────────────────┐    ┌───────────────────┐   │
│  │  File    │───▶│ DwgToDxfConverter│───▶│ DxfParser.parseSync│   │
│  └──────────┘    └──────────────────┘    └─────────┬─────────┘   │
│                                                    │            │
│  2. SAHNE OLUŞTUR                                   ▼            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ buildSceneFromParsedData()                                  ││
│  │ - LINE, CIRCLE, ARC, LWPOLYLINE, SPLINE, ELLIPSE, INSERT    ││
│  │ - Offset (centering), Line2/Mesh oluştur                   ││
│  │ - userData: { type, handle, data }                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                    │            │
│  3. GÖRÜNTÜLEME                                       ▼            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ DxfViewer (Three.js)                                        ││
│  │ - OrbitControls, Lighting                                 ││
│  │ - Pick & Place modu: renklendirme, seçim                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. TAŞ TİPİ TANIMLA (Kullanıcı)                                │
│  ┌──────────────┐    ┌────────────────────────────────────────┐│
│  │ StoneTypePanel│───▶│ PickPlaceContext.stoneTypes[]         ││
│  └──────────────┘    │ - Her biri contourIds[] içerir        ││
│                      └────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. KONTÜR ATAMASI (Kullanıcı DXF'den seçer)                    │
│  ┌──────────────────┐    ┌────────────────────────────────────┐│
│  │ useSelection()   │───▶│ stoneType.contourIds += handle      ││
│  └──────────────────┘    └────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. STRIP ÜRETİM                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ generateStripData(scene, stoneTypes, stripConfig)         │ │
│  │ → StripCell[] (grid koordinatları + path)                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                    │            │
│  ┌──────────────────┐    ┌──────────────────────────────┐      │
│  │ StripPreview      │    │ exportStripToDxf()          │      │
│  │ (SVG önizleme)    │    │ → .dxf dosya                │      │
│  └──────────────────┘    └──────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. G-CODE ÜRETİM                                                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ buildPlacementOrders(scene, stoneTypes, pickPlaceConfig)  │ │
│  │ → PlacementOrder[]                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                    │            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Mach3PostProcessor.generate(orders, stoneTypeMap)        │ │
│  │ → setup.nc + pickplace.nc G-code                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. CNC'YE GÖNDERİM                                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ WebSerialGCodeSender                                       │ │
│  │ 1. USB port bağlantı                                       │ │
│  │ 2. setup.nc gönder (probe)                                │ │
│  │ 3. pickplace.nc gönder (taş yerleştirme)                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
12. OffsetUtils - Cavalier Contours WASM
// WASM modülü ile offset işlemleri
// public/wasm/v0aigcode_cavalier_ffi.js
interface Path {
  type: 'Line' | 'Arc';
  start: { x, y };
  end: { x, y };
  center?: { x, y };        // Arc için
  radius?: number;           // Arc için
  startAngle?: number;      // Arc için
  endAngle?: number;        // Arc için
  clockwise?: boolean;     // Arc için
}
// Ana fonksiyonlar:
pathToCavalierPolyline(path, isClosed)  // JS → WASM formatı
cavalierPolylineToPath(polyline)        // WASM → JS formatı
createCavalierOffsets(path, offset)     // Tek polyline offset
createMultiPlineOffsets(boundary, islands, offset) // Multi-offset
13. Context'ler ve Sağlayıcılar (Provider)
layout.tsx Provider Hiyerarşisi:

<SelectionProvider>      // Seçim state'i (selectedObjectsSet)
  <DxfProvider>          // DXF dosya, parsedDxf, mainGroup
    <PickPlaceProvider>  // stoneTypes, configs
      {children}
    </PickPlaceProvider>
  </DxfProvider>
</SelectionProvider>
14. Önemli Dosyalar ve Satır Sayıları
Dosya	Satır	Açıklama
libredwg/libredwgread.mjs
4925
DWG okuma (Rust→WASM)
dxfSceneBuilder.ts
~1370
DXF→Three.js dönüştürücü
DxfViewer.tsx
~1880
Three.js görüntüleyici
offsetUtils.ts
~1040
Offset/Cavalier işlemleri
Mach3PostProcessor.ts
~290
G-code üretici
webSerialGcodeSender.ts
~800
CNC bağlantısı
PickPlaceContext.tsx
~140
State yönetimi
stripGenerator.ts
~200
Strip layout üretici
15. Teknoloji Stack
Framework: Next.js 15 (App Router, Turbopack)
UI: Radix UI + Tailwind CSS + Tailwind Animate
3D: Three.js + three-stdlib (Line2, OrbitControls)
State: Zustand (PickPlaceContext)
DXF: dxf-parser库
Offset: Cavalier Contours WASM (Rust)
DWG: LibreDWG WASM
Serial: Web Serial API
CNC: G-code (Mach3/GRBL formatı)