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
                                              Falcon-Perception (CUDA)
                                              + OpenCV açı + ONNX orientation
                                              Marlin G-code (serial)
```

---

## Hızlı başlangıç

**Gereksinimler:** Node.js 20+, Python 3.11+, curl · VLM için NVIDIA GPU + CUDA (torch)

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

`.env` yoksa `scripts/start.sh` (veya `start.mjs`) `.env.example`'dan otomatik oluşturur. Tek dosya — frontend (`NEXT_PUBLIC_*`) ve runtime (`IO_CAM_*`) aynı `.env`'i okur (`settings.py` yalnızca repo kökü `.env`):

```env
NEXT_PUBLIC_RUNTIME_URL=http://127.0.0.1:8000
IO_CAM_VLM_PROMPT=single black rhinestone
IO_CAM_VLM_MAX_STONES=10
# IO_CAM_ORIENTATION_MODEL_DIR=/absolute/path/to/orientation_model_v2
```

`VLM_PROMPT` / `VLM_MAX_STONES` her “Kare Al”da yeniden okunur — runtime restart gerekmez.  
Job pick varsayılanı **tek seferde çok taş** (`10`): VLM konumları bulur, ONNX her crop’a orientation verir, face-up (`true`) olan seçilir.

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
│   ├── main.py               # FastAPI + lifespan (VLM arka plan yükleme)
│   ├── services.py           # AppServices singleton
│   ├── api/                  # REST + WebSocket
│   ├── motion/               # Marlin G-code sürücü
│   ├── vision/               # Falcon CUDA + OpenCV + ONNX orientation
│   ├── glue_sheet/           # Hücre reserve/commit
│   └── runtime/              # JobRunner, kamera, EventBus
├── datasets/                 # Orientation ONNX (orientation_model_v2), Train/eval scriptleri
├── calibration/              # Homography, fabric, motion, glue state
├── scripts/                  # macOS kamera izni yardımcısı
└── tests/                    # pytest
```

**JobRunner döngüsü** (her placement satırı)

| Faz | Ne yapar |
|-----|----------|
| **PICK** | Kare al → `detect_all()` (VLM ≤N taş) → her bbox ONNX orientation → `select_stone_to_pick` (face-up) → vakum |
| **ROTATE** | `delta_c = target − stone.angle` → C ekseni (`rotate_c`) |
| **GLUE** | `reserve_cell` → motion → `commit` (başarısızsa cursor ilerlemez) |
| **PLACE** | `fabric_to_robot` → XY → Z in → vakum off → Z out → C sıfırla |

Pick seçimi: `orientation == "true"` ve confidence eşiği geçen taşlar arasından kafaaya en yakın. Hiç face-up yoksa **aynı kare için VLM tekrar çağrılmaz** — settle + yeni frame; retry aşımında `no_true_orientation_stone`.

Güvenlik: vakum fail streak → ERROR · glue tükenince → PAUSE · istisna → `emergency_stop` (M410) · stop timeout → task cancel.

**Vision pipeline** (`ai_detect.py` + `orientation_classifier.py`)

Roller ayrıdır — VLM yön (true/false) **söylemez**:

| Adım | Kim | Ne üretir |
|------|-----|-----------|
| 1 | Falcon-Perception (CUDA, `task="detection"`) | Taş bbox’ları (merkez + kaba boyut) — sahne başına **bir** çağrı |
| 2 | OpenCV (ROI) | Açı: adaptive threshold → kontur → PCA / üçüncü moment |
| 3 | ONNX ConvNeXt (`orientation_classifier.py`) | Her VLM bbox crop → `true` / `false` / `uncertain` + confidence |

Ek notlar:

- Görüntü VLM öncesi uzun kenarı **512 px**’e iner (`vlm_preprocess.py`).  
- Inference tek worker + `Future` kuyruğu (`maxsize=1`). Varsayılan `vlm_max_stones=10`.  
- Asimetrik confidence: `true ≥ 0.80`, `false ≥ 0.50`; altındakiler `uncertain` (yanlış face-up pahalı).  
- Model lifespan’ta arka plan thread’inde yüklenir · `/health` → `ai_status`.  
- Log satırındaki `[VLM] … orient=…` birleşik etikettir; **orientation ONNX’den** gelir.

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

Ortam değişkenleri `IO_CAM_` önekli (`settings.py`): `MOCK_HARDWARE`, `SERIAL_PORT`, `CORS_ORIGINS`, `CONTROL_TOKEN`, `VLM_PROMPT`, `VLM_MAX_STONES`, `ORIENTATION_MODEL_DIR`, kamera FPS/JPEG, motion hızları vb.

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
| AI | Falcon-Perception (`falcon-perception[torch]`, CUDA), OpenCV, ONNX Runtime GPU (orientation) |
| Donanım | Marlin G-code (serial), USB kamera |
| State | React Context, localStorage, IndexedDB |
| Real-time | WebSocket (binary kamera + JSON kontrol) |

---

## Geliştirme

```bash
# Frontend + runtime birlikte (dev, uvicorn --reload)
npm run dev

# Sadece Next.js (Turbopack, :9002)
npm run dev:next

# Runtime ayrı
cd io-cam-runtime && source .venv/bin/activate   # Windows: .venv\Scripts\activate
uvicorn app.main:app --reload --port 8000

# Testler
cd io-cam-runtime && pytest
```

Loglar: `.logs/runtime.log`, `.logs/frontend.log`.

---

## Orientation modeli

```
io-cam-runtime/datasets/orientation_model_v2/
  orientation_model.onnx   # ConvNeXt-Tiny, img_size=128
  class_names.json         # ["false", "true"], img_size
  best_model.pth           # eğitim checkpoint (yeniden export için)
```

Eğitim / eval (CUDA önerilir):

```bash
cd io-cam-runtime/datasets
python Train_orientation.py \
  --coco aug_dataset/aug_dataset \
  --images aug_dataset/aug_dataset_images \
  --epochs 20 --img-size 128 --resolution-aug-prob 0.3 \
  --out ./orientation_model_v2

python eval_confusion.py \
  --coco aug_dataset/aug_dataset \
  --images aug_dataset/aug_dataset_images \
  --checkpoint orientation_model_v2/best_model.pth \
  --with-thresholds
```

ONNX export Windows’ta encoding/dynamo sorununa takılırsa: `python export_orientation_onnx.py` (`dynamo=False`).

---

## Notlar (kod tabanı ile uyum)

- Üretimde ayrı bir **BootScreen** yok; hazırlık paneller ve health/WS üzerinden yürür.  
- Canlı kamera stream’inde her karede VLM **çalışmaz**; tespit `snapshot-detect` (ve job döngüsündeki `detect_all`) ile yapılır.  
- Açı: simetrik olmayan şekillerde üçüncü moment tabanlı yön (`_directed_angle`), eski `_expand_to_360` yaklaşımının yerini almıştır.  
- Orientation tamamen ONNX (`orientation_classifier.py`); VLM yalnızca konum. Varsayılan dizin `datasets/orientation_model_v2`.  
- Pick: çoklu bbox → classifier → `select_stone_to_pick`; false çıkınca VLM’i tekrar çağırmak yerine yeni frame.  
- VLM backend **CUDA/torch**’tır (MLX değil); CUDA yoksa worker `error` durumuna düşer.  
- `src/services/` ve `src/legacy/` şu an kullanılmıyor.
