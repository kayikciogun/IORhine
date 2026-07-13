# IO-CAM — Pick & Place Robot Kontrolü

Taş dizim (pick & place) için uçtan uca kontrol sistemi: CAD planlamadan robot hareketine.

| Katman | Rol |
|--------|-----|
| **Frontend** (`src/`) | Next.js 15 + React + Three.js — planlama ve üretim arayüzü |
| **Runtime** (`io-cam-runtime/`) | FastAPI — vision, motion, yapışkan levha, job orkestrasyonu |

```
DXF / DWG  →  Kontür seçimi  →  Yerleştirme CSV  →  JobRunner
                                                          │
                                              Pick → Rotate → Glue → Place
                                                          │
                                              Falcon-Perception + OpenCV
                                              Marlin G-code (serial)
```

---

## Hızlı başlangıç

**Gereksinimler:** Node.js 20+, Python 3.11+, curl

```bash
# Her şeyi kur ve başlat (Next.js :9002 + runtime :8000)
npm run start:all

# Kamera / seri port yokken mock donanım
npm run start:all:mock

# Sadece bağımlılık kurulumu
npm run install:all
```

| Adres | Açıklama |
|-------|----------|
| http://localhost:9002/ | Planlama |
| http://localhost:9002/production | Üretim |
| http://localhost:8000/health | Runtime sağlık (AI durumu dahil) |

`.env.local` yoksa `scripts/start.sh` otomatik oluşturur:

```env
NEXT_PUBLIC_RUNTIME_URL=http://127.0.0.1:8000
```

macOS’ta gerçek kamera için **Sistem Ayarları → Gizlilik ve Güvenlik → Kamera** altında Terminal (veya kullandığınız IDE) izni gerekir. Yardımcı script: `io-cam-runtime/scripts/request_camera_permission.py`.

---

## Mimari

### Frontend (`src/`)

```
src/
├── app/
│   ├── page.tsx              # Planlama (/)
│   └── production/page.tsx   # Üretim (/production)
├── components/
│   ├── dxf-viewer/           # Three.js CAD viewer + seçim
│   ├── pick-place/           # Taş tipi, strip preview, export
│   └── production/           # Kamera, motion, kalibrasyon, job panelleri
├── contexts/                 # DxfContext, PickPlaceContext
├── lib/                      # runtimeClient, oturum, pipeline, CSV
├── operations/               # Strip üretimi, placement orders, CSV export
├── types/                    # runtime ↔ frontend tip sözleşmeleri
└── Utils/                    # Offset (WASM), açı, DXF yazıcı
```

**Planlama akışı**

1. DXF/DWG yükle → IndexedDB’de saklanır  
2. Kontür seç (raycasting) → taş tipi ata  
3. Yapışkan levha şablonu önizle  
4. CSV üret veya makineye gönder → `/production`

**Üretim sayfası**

- WebSocket: `/ws/control` (job komutları), `/ws/camera` (canlı önizleme)  
- Job: yükle / start / pause / resume / stop / estop  
- Kalibrasyon, motion ayarları, yapışkan levha durumu, vision ayarları  
- AI tespit: kullanıcı “Kare Al” ile `POST /api/vision/snapshot-detect` (canlı stream’de VLM yok)

**Oturum kalıcılığı** (`appSessionStore.ts`)

- `localStorage` — taş tipleri, config, transform, placement snapshot  
- `IndexedDB` — DXF ham metni  

### Runtime (`io-cam-runtime/`)

```
io-cam-runtime/
├── app/
│   ├── main.py               # FastAPI + lifespan (VLM warm-up)
│   ├── services.py           # AppServices singleton
│   ├── api/                  # REST + WebSocket
│   ├── motion/               # Marlin G-code sürücü
│   ├── vision/               # Falcon-Perception + OpenCV
│   ├── glue_sheet/           # Hücre reserve/commit
│   └── runtime/              # JobRunner, kamera, EventBus
├── calibration/              # Homography, fabric, motion, glue state
├── scripts/                  # macOS kamera izni yardımcısı
└── tests/                    # pytest
```

**JobRunner döngüsü** (her placement satırı)

| Faz | Ne yapar |
|-----|----------|
| **PICK** | Kare al → `detect_all()` → homography → en yakın taş → vakum |
| **ROTATE** | `delta_c = target − stone.angle` → C ekseni |
| **GLUE** | `reserve_cell` → motion → `commit` (başarısızsa cursor ilerlemez) |
| **PLACE** | `fabric_to_robot` → XY → Z in → vakum off → Z out → C sıfırla |

Güvenlik: vakum fail streak → ERROR · glue tükenince → PAUSE · istisna → `emergency_stop` (M410) · stop timeout → task cancel.

**Vision pipeline** (`ai_detect.py`)

1. Falcon-Perception (MLX, Apple Silicon) → bbox merkezleri  
2. ROI’de OpenCV: adaptive threshold → morphology → kontur  
3. PCA + üçüncü moment ile yönlü açı (`contour_angle_deg` / `_directed_angle`)  
4. Model arka planda yüklenir (~30 sn warm-up); `/health` → `ai_status`

Inference tek worker thread + `Future` kuyruğu ile thread-safe.

**Kamera stream protokolü** (`/ws/camera`)

```
[4-byte big-endian meta uzunluğu][JSON meta][JPEG]
```

Meta: `fps`, `ai_status`, `mode: "preview"`, isteğe bağlı `camera_warning` / `mock_frame`. Max genişlik varsayılan 640 px.

---

## API özeti

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/health` | Durum + mock + AI |
| POST | `/api/job` | CSV + DXF yükle |
| GET | `/api/job/status` | Job fazı |
| GET/POST | `/api/camera/*` | Cihaz listesi, seçim, status |
| GET/POST | `/api/motion/*` | Portlar, config, select |
| GET/POST | `/api/calibration/*` | Homography, fabric |
| POST | `/api/glue_sheet/from_planning` | Planlamadan strip sync |
| GET/POST | `/api/glue_sheet/*` | Status, reset |
| GET/POST | `/api/vision/*` | Ayarlar, status, snapshot-detect |
| WS | `/ws/control` | start / pause / resume / stop / estop |
| WS | `/ws/camera` | Binary frame akışı |

Ortam değişkenleri `IO_CAM_` önekli (`settings.py`): `MOCK_HARDWARE`, `SERIAL_PORT`, `CORS_ORIGINS`, `CONTROL_TOKEN`, kamera FPS/JPEG, motion hızları vb.

---

## Veri akışı

```
[Planlama /]
  DXF → IndexedDB
  Kontür → StoneType (localStorage)
  Strip → SVG preview
       │
       ▼ makineye gönder
  glueSheetSync → POST /api/glue_sheet/from_planning
  placement snapshot → /production
       │
[Üretim /production]
  POST /api/job (CSV + DXF)     WS /ws/control
                \                 /
                 ▼               ▼
              JobRunner (Pick → Rotate → Glue → Place)
                    │                │
              detect_all      fabric_to_robot + G-code
```

---

## Docker

```bash
# Mock / geliştirme compose
docker compose up --build

# Gerçek donanım (Linux örnek paths)
docker compose -f docker-compose.yml -f docker-compose.real.yml up
```

| Servis | Host port |
|--------|-----------|
| Next.js (`app`) | 9002 → 3000 |
| Runtime | 8000 |

Kalibrasyon volume: `io-cam-runtime/calibration` → container `/app/calibration`.  
SSR için `RUNTIME_INTERNAL_URL=http://runtime:8000`; tarayıcı için `NEXT_PUBLIC_RUNTIME_URL=http://localhost:8000`.

---

## Teknoloji

| Katman | Stack |
|--------|--------|
| Frontend | Next.js 15, React 18, TypeScript, Three.js, Tailwind, Radix UI |
| CAD | dxf-parser, LibreDWG (WASM), Cavalier Contours (WASM) |
| Backend | FastAPI, uvicorn, OpenCV, NumPy, ezdxf, Pydantic |
| AI | Falcon-Perception (MLX), OpenCV, PCA |
| Donanım | Marlin G-code (serial), USB kamera |
| State | React Context, localStorage, IndexedDB |
| Real-time | WebSocket (binary kamera + JSON kontrol) |

---

## Geliştirme

```bash
# Frontend (Turbopack, :9002) — genelde start.sh ile birlikte
npm run dev:next

# Runtime ayrı
cd io-cam-runtime && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Testler
cd io-cam-runtime && pytest
```

Loglar: `.logs/runtime.log`, `.logs/frontend.log`.

---

## Notlar (kod tabanı ile uyum)

- Üretimde ayrı bir **BootScreen** yok; hazırlık paneller ve health/WS üzerinden yürür.  
- Canlı kamera stream’inde her karede VLM **çalışmaz**; tespit `snapshot-detect` (ve job döngüsündeki `detect_all`) ile yapılır.  
- Açı: simetrik olmayan şekillerde üçüncü moment tabanlı yön (`_directed_angle`), eski `_expand_to_360` yaklaşımının yerini almıştır.  
- `src/services/` ve `src/legacy/` şu an kullanılmıyor.
