ORhine-1 (IO-CAM Pick & Place) — Tam Uygulama Analizi
Genel Bakış
Bu, taş dizim (pick & place) yapan bir endüstriyel robot kontrol sistemidir. İki ana bölümden oluşur:

Frontend (Next.js + React + Three.js) — Planlama ve üretim arayüzü
io-cam-runtime (Python/FastAPI) — Görüntü işleme, robot kontrolü, donanım yönetimi
1. Frontend (src/)
Mimari Yapı
src/
├── app/                      # Next.js App Router
│   ├── layout.tsx           # Root layout + Provider'lar
│   ├── page.tsx             # Planlama ana sayfası (/)
│   └── production/page.tsx  # Üretim sayfası (/production)
├── components/
│   ├── dxf-viewer/          # DXF/DWG/3D viewer (Three.js)
│   ├── pick-place/          # Taş tipi, şablon, dışa aktarma
│   ├── production/          # Kamera, motion, kalibrasyon panelleri
│   ├── ui/                  # Radix UI bileşenleri
│   └── icons/               # Logo
├── contexts/                # React Context (state yönetimi)
│   ├── DxfContext.tsx       # DXF dosyası durumu
│   └── PickPlaceContext.tsx # Taş tipleri + config durumu
├── hooks/                   # React hooks
├── lib/                     # İş mantığı yardımcıları
│   ├── runtimeClient.ts    # Python runtime HTTP/WS istemcisi
│   ├── appSessionStore.ts   # IndexedDB + localStorage oturum kalıcılığı
│   ├── planningPipeline.ts  # Planlama → Production geçişi
│   ├── glueStripSync.ts     # Yapışkan levha senkronu
│   ├── placementCsv.ts      # CSV satır dönüşümü
│   ├── contourPlacement.ts  # Kontur yerleştirme merkezi
│   └── placementSession.ts  # Yerleştirme oturumu
├── operations/              # İşlem modülleri
│   ├── stripGenerator.ts    # Yapışkan levha şablonu üretimi
│   ├── placementOrders.ts   # Yerleştirme sıraları (CSV için)
│   └── csvExport.ts         # CSV dışa aktarma
├── types/                   # TypeScript tip tanımları
│   ├── runtime.ts           # Python runtime ↔ Next.js tip sözleşmeleri
│   ├── pickplace.ts         # StoneType, PickPlaceConfig, PlacementOrder
│   └── selection.ts         # DXF seçim bilgileri
├── Utils/                   # Yardımcı fonksiyonlar
│   ├── offsetUtils.ts      # Cavalier Contours (WASM) offset
│   ├── contourAngle.ts     # Kontur açısı hesaplama
│   ├── dxfWriter.ts        # DXF yazma
│   └── debug.ts            # Debug logging
├── services/               # (boş — kullanılmıyor)
└── legacy/                 # (boş — eski kod)
Ana Özellikler
DXF Viewer (components/dxf-viewer/):

DxfViewer.tsx (1803 satır) — Three.js tabanlı 2D/3D CAD viewer
DXF, DWG, GLTF, OBJ, STL, FBX, 3DS, DAE dosya formatları
DWG → DXF dönüşümü (dwgToDxfConverter.ts) — LibreDWG WASM ile tarayıcıda
Mesh partitioning (spatial grid ile büyük mesh'leri parçalara ayırma)
OrbitControls ile sağ tık döndürme, orta tık pan, tekerlek zoom
WASM: public/wasm/v0aigcode_cavalier_ffi_bg.wasm — Cavalier Contours (offset hesaplama)
Seçim sistemi (useSelection.tsx, useViewerInteractions.ts)
Pick & Place modu: taş tiplerine göre kontür renklendirme
Planlama Akışı (page.tsx):

Kullanıcı DXF yükler → DxfContext (IndexedDB'de saklanır)
Kontür seçer → useSelection ile Three.js raycasting
StoneTypePanel ile taş tipi oluşturur (renk, isim, kalınlık)
StripPreview ile yapışkan levha şablonu önizlerir (SVG)
ExportPanel ile CSV üretir ve/veya /production'a gönderir
Üretim Sayfası (production/page.tsx, 754 satır):

BootScreen ile başlangıç kontrolü
WebSocket ile runtime'a bağlanır (ws/control, ws/camera)
Canlı kamera görüntüsü (binary protokol: 4-byte header + JSON meta + JPEG)
AI Snapshot tespiti (Falcon-Perception VLM)
Job kontrolü: start/pause/resume/stop/estop
Yapışkan levha durumu, kalibrasyon, motion ayarları
State Yönetimi
DxfContext: Seçili DXF dosyası, parsed DXF, Three.js scene, model transform PickPlaceContext: Taş tipleri listesi, aktif tip, config (strip origin, cell size, row length)

Oturum Kalıcılığı (appSessionStore.ts)
localStorage: Taş tipleri, config, model transform, placement snapshot
IndexedDB: DXF ham metni (büyük dosyalar için)
Sayfa yenilense bile tüm veriler korunur
2. io-cam-runtime (Python/FastAPI)
Mimari Yapı
io-cam-runtime/
├── app/
│   ├── main.py              # FastAPI app + lifespan + router'lar
│   ├── services.py          # AppServices (singleton — tüm servisleri yönetir)
│   ├── api/                 # REST + WebSocket endpoint'leri
│   │   ├── job.py           # POST /api/job (CSV+DXF yükleme)
│   │   ├── camera.py        # Kamera cihaz listesi/seçim
│   │   ├── motion.py        # Seri port listesi, motion config
│   │   ├── calibration.py   # Homography, fabric offset, glue sheet
│   │   ├── vision.py        # Vision ayarları, snapshot-detect
│   │   └── ws.py            # WebSocket: /ws/control + /ws/camera
│   ├── config/
│   │   ├── settings.py      # Pydantic Settings (env vars)
│   │   ├── runtime_store.py # Runtime state (vision config)
│   │   └── motion.json      # Motion varsayılan ayarları
│   ├── motion/              # G-code/Marlin sürücü katmanı
│   │   ├── controller.py    # MotionController (XY/Z/C ekseni)
│   │   ├── gcode_driver.py  # Serial → Marlin G-code
│   │   ├── mock_driver.py   # MockSerial (test için)
│   │   ├── kinematics.py    # fabric_to_robot dönüşümü
│   │   ├── config_store.py  # Motion config dosya yönetimi
│   │   └── serial_config.py # Seri port kayıt/yükleme
│   ├── vision/              # Bilgisayarlı görü
│   │   ├── ai_detect.py     # Falcon-Perception VLM + OpenCV hibrit tespit
│   │   ├── calibration.py   # Homography (satranç tahtası), fabric offset
│   │   └── template_loader.py # DXF'den taş şablonu oluşturma
│   ├── glue_sheet/
│   │   └── controller.py    # Yapışkan levha hücre yönetimi
│   └── runtime/
│       ├── job_runner.py    # Pick-Place döngüsü (ana orkestrasyon)
│       ├── state.py         # JobPhase enum + RuntimeContext
│       ├── events.py        # EventBus (pub/sub)
│       ├── camera.py        # Threaded USB kamera yakalama
│       ├── camera_sources.py # Cihaz tespiti (macOS/Linux)
│       └── csv_loader.py    # Placement CSV parsing
├── calibration/             # Kalibrasyon dosyaları (homography, glue sheet)
├── tests/                   # pytest testleri
├── Dockerfile
└── pyproject.toml
JobRunner — Pick & Place Döngüsü (job_runner.py)
Bu sistemin kalbidir. Her satır için:

PICK (Vision): Kamera karesi al → detect_all() ile taşları tespit et
Homography ile pixel → robot koordinat dönüşümü
En yakın taşı seç (nearest_stone)
Vacuum ile taşı al (retry mekanizması + sensör kontrolü)
ROTATE: delta_c = target_angle − stone.angle → C eksenini döndür
GLUE: Yapışkan levhadan hücre al (reserve_cell → motion → commit)
GlueSheetExhausted → pause + operatör bekle
PLACE: fabric_to_robot(x, y, offset) → XY hareket → Z in → vacuum off → Z out
Rotasyon sıfırla: rotate_c_to(0)
Güvenlik mekanizmaları:

Vacuum fail streak → ERROR fazı
Glue sheet exhausted → PAUSE + operatör müdahalesi
Exception → emergency_stop() (M410 + vacuum off)
Stop timeout 5 sn → task cancel
Görüntü İşleme (vision/ai_detect.py)
Hibrit pipeline:

Falcon-Perception VLM (MLX backend, Apple Silicon) — tiiuae/Falcon-Perception
Arka plan thread'inde yüklenir (warm-up ~30 sn)
Bbox tespiti: bboxes_raw → {x, y} center'ları
OpenCV — Her bbox ROI için:
Adaptive threshold → morphology → contour
PCA ile açı tahmini (contour_angle_deg)
_expand_to_360: Simetrik olmayan taşlar için 360° açı
Canlı kamera akışı (ws.py /ws/camera):

Binary protokol: [4-byte big-endian meta len][JSON metadata][raw JPEG]
FPS EMA hesaplama
Stream max width 640px (optimize)
AI tespiti her frame'de yapılır (ai_snapshot_detect)
Motion Sistemi (motion/)
GcodeDriver: Marlin firmware üzerinden serial

send() — komut gönder + ok bekle (timeout ile)
Hata tespiti: error, !!, resend: regex
busy/processing → deadline reset
MotionController: High-level hareket komutları

home(): G21 + G90 + G28 + G92 A0/E0
move_xy/move_z: G0/G1 ile hız kontrolü
rotate_c/rotate_c_to: A veya E ekseni (config'e göre)
vacuum_on/off: M106 S255 / M107
vacuum_gripped(): M42 pin okuma (sensör varsa)
emergency_stop(): M410 + vacuum off
Yapışkan Levha (glue_sheet/controller.py)
reserve_cell() + commit() pattern (P2-A8)
Motion başarısız olursa cursor advance olmaz (gap yok)
GlueSheetExhausted → operatör reset bekler
State glue_sheet_state.json'da saklanır
3. Veri Akışı
[Planlama Sayfası]
   │
   ├─ DXF yükle → IndexedDB
   ├─ Kontür seç → StoneType ata (localStorage)
   ├─ Strip üret → SVG preview
   │
   └─ Makineye gönder →
       ├─ generateStripData → glueSheetSync → POST /api/glue_sheet/from_planning
       ├─ buildPlacementOrders → savePlacementSnapshot
       └─ router.push('/production')
                          │
                   [Üretim Sayfası]
                          │
                   ┌──────┴──────┐
                   │             │
              POST /api/job   ws/control
              (CSV + DXF)     (start/pause)
                          │
                   [JobRunner]
                   │  │  │  │
                Pick Rotate Glue Place
                   │       │   │
              detect_all  reserve  fabric_to_robot
                   │      commit  move_xy/z
              VLM+OpenCV
4. Docker & Deployment
docker-compose.yml: 2 service (app:9002, runtime:8000)
Next.js Dockerfile: Multi-stage (deps → build → runner), Alpine tabanlı
Python Dockerfile: Multi-stage (builder → runtime), slim tabanlı, non-root user
scripts/start.sh: Geliştirme için tek komut başlatıcı (venv + npm + uvicorn)
5. Teknoloji Stack
Katman	Teknoloji
Frontend	Next.js 15, React 18, TypeScript, Three.js, Tailwind, Radix UI
CAD	dxf-parser, LibreDWG WASM, Cavalier Contours WASM
Backend	FastAPI, uvicorn, OpenCV, numpy, ezdxf
AI/Vision	Falcon-Perception (MLX), OpenCV, PCA
Donanım	Marlin G-code (serial), USB kamera (OpenCV)
State	React Context, localStorage, IndexedDB
Real-time	WebSocket (binary protokol)
Deployment	Docker Compose
Bu, tam donanımlı bir taş dizim robotunun uçtan uca kontrol sistemidir — DXF tasarımından robot hareketlerine kadar tüm akışı kapsar.