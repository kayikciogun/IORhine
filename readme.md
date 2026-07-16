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
                                              Falcon-Perception PagedInferenceEngine (CUDA)
                                              + OpenCV açı + ONNX orientation (CUDA)
                                              Marlin G-code (serial)
```

---

## Hızlı başlangıç

**Gereksinimler:** Node.js 20+, Python 3.11+, curl · VLM / orientation için NVIDIA GPU + CUDA 12 (torch cu128)

```bash
# Her şeyi kur ve başlat (Next.js :9002 + runtime :8000)
npm run start:all

# Kamera / seri port yokken mock donanım
npm run start:all:mock

# Sadece bağımlılık kurulumu (+ doğrulama)
npm run install:all

# Bash (Linux/macOS) — venv + pip[dev] + ORT pin doğrulama
./scripts/start.sh
./scripts/start.sh --install
./scripts/start.sh --mock
```

İlk kurulumda `start.sh` / `start.mjs`:

1. `npm install`
2. `pip install -e io-cam-runtime[dev]` (falcon-perception, torch CUDA, …)
3. `onnxruntime-gpu==1.20.2` pin’ini zorlar (1.27+ CUDA 13 ister; PyTorch CUDA 12 ile uyumsuz)
4. Import doğrulama: `PagedInferenceEngine`, torch CUDA, ORT `CUDAExecutionProvider`

| Adres | Açıklama |
|-------|----------|
| http://localhost:9002/ | Planlama |
| http://localhost:9002/production | Üretim |
| http://localhost:8000/health | Runtime sağlık (`ai_status` dahil) |

`.env` yoksa script `.env.example`’dan (veya yerleşik şablondan) oluşturur. Tek dosya — frontend (`NEXT_PUBLIC_*`) ve runtime (`IO_CAM_*`) aynı `.env`'i okur:

```env
NEXT_PUBLIC_RUNTIME_URL=http://127.0.0.1:8000
IO_CAM_VLM_PROMPT=stone
IO_CAM_VLM_MAX_STONES=10
IO_CAM_VLM_MODEL=tiiuae/Falcon-Perception
# IO_CAM_ORIENTATION_MODEL_DIR=/absolute/path/to/orientation_model_v2
```

| Değişken | Anlam |
|----------|--------|
| `IO_CAM_VLM_PROMPT` | Detection subject — her “Kare Al”da yeniden okunur |
| `IO_CAM_VLM_MAX_STONES` | Tek VLM çağrısında taş üst sınırı (varsayılan 10) |
| `IO_CAM_VLM_MODEL` | HF id — `tiiuae/Falcon-Perception` (0.6B) veya `…-300M` (0.3B, detection-only) |

macOS’ta gerçek kamera için **Sistem Ayarları → Gizlilik → Kamera** altında Terminal/IDE izni gerekir: `io-cam-runtime/scripts/request_camera_permission.py`.

---

## AI yaşam döngüsü (startup)

Server ayağa kalkınca VLM **arka planda** yüklenir; HTTP/WS hemen cevap verir:

```
uninitialized → loading → warming_up → ready
                              │
                              ├─ torch.compile (Inductor/Triton) — ilk açılış ~1–2 dk (Windows)
                              ├─ PagedInferenceEngine + CUDA graph capture
                              └─ dummy Sequence generate (warmup)
```

- UI: üretim sayfasında badge (`AI yükleniyor…` / `AI derleniyor…` / `AI hazır`), EventLog, “Kare Al” `ready` olana kadar disabled.
- Control WS `ai_status` event + `/health` / `/api/vision/status` poll.
- Orientation ONNX lifespan’ta preload (`CUDAExecutionProvider`; torch import önce → cuDNN DLL).

**Not:** İlk `torch.compile` uzun sürebilir; bu beklenen. Sonraki açılışlar Inductor cache ile genelde daha kısa. UI bu sırada kilitlenmez.

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

**Üretim sayfası**

- WebSocket: `/ws/control` (job + `ai_status`), `/ws/camera` (önizleme — VLM yok)
- “Kare Al” → `POST /api/vision/snapshot-detect` (sync detect `asyncio.to_thread`)
- Sağ üst HUD: faz, kamera, AI durumu, son cevap süresi (ms)

### Runtime (`io-cam-runtime/`)

```
io-cam-runtime/
├── app/
│   ├── main.py               # lifespan: VLM worker + ONNX preload + kamera restore
│   ├── services.py
│   ├── api/                  # REST + WebSocket
│   ├── motion/
│   ├── vision/
│   │   ├── vlm_worker.py     # PagedInferenceEngine worker + warmup
│   │   ├── ai_detect.py      # detect pipeline
│   │   ├── orientation_classifier.py  # batch ONNX (CUDA)
│   │   └── vlm_preprocess.py
│   ├── glue_sheet/
│   └── runtime/              # JobRunner, kamera, EventBus
├── datasets/orientation_model_v2/
├── calibration/
└── tests/
```

**JobRunner** (her placement satırı)

| Faz | Ne yapar |
|-----|----------|
| **PICK** | Kare → `detect_all` (VLM ≤N) → batch ONNX orientation → face-up seç → vakum |
| **ROTATE** | `delta_c = target − stone.angle` |
| **GLUE** | `reserve_cell` → motion → `commit` |
| **PLACE** | fabric → robot → vakum off |

Pick: `orientation == "true"` + confidence; face-up yoksa yeni frame (aynı karede VLM tekrar yok).

**Vision pipeline**

| Adım | Kim | Ne üretir |
|------|-----|-----------|
| 1 | Falcon-Perception **PagedInferenceEngine** (CUDA, `task="detection"`) | Bbox’lar — sahne başına bir çağrı |
| 2 | OpenCV ROI | Açı (adaptive threshold → PCA / üçüncü moment) |
| 3 | ONNX ConvNeXt (batch `session.run`, CUDA EP) | `true` / `false` / `uncertain` |

Ek:

- Görüntü VLM öncesi max **512 px** (`vlm_preprocess.py`).
- Inference tek worker + `Future` kuyruğu (`maxsize=1`); girdi `(PIL, prompt, tokens, stones)`.
- Confidence: `true ≥ 0.80`, `false ≥ 0.50`.
- `onnxruntime-gpu==1.20.2` (CUDA 12 / cuDNN 9; PyTorch cu128 ile uyumlu). 1.27+ CUDA 13 ister — kullanma.

**Kamera stream** (`/ws/camera`): `[4-byte BE meta len][JSON][JPEG]` — `fps`, `ai_status`, `mode: "preview"`.

---

## API özeti

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/health` | Durum + mock + `ai_status` |
| POST | `/api/job` | CSV + DXF yükle |
| GET | `/api/job/status` | Job fazı |
| GET/POST | `/api/camera/*` | Cihaz, seçim, status |
| GET/POST | `/api/motion/*` | Portlar, config |
| GET/POST | `/api/calibration/*` | Homography, fabric |
| GET/POST | `/api/glue_sheet/*` | Strip sync, status, reset |
| GET | `/api/vision/status` | `ai_status` + mesaj |
| POST | `/api/vision/snapshot-detect` | Tek kare AI tespit |
| WS | `/ws/control` | start/pause/… + EventBus (`ai_status`, job, …) |
| WS | `/ws/camera` | Binary frame |

`IO_CAM_` önekli ayarlar: `MOCK_HARDWARE`, `SERIAL_PORT`, `CORS_ORIGINS`, `CONTROL_TOKEN`, `VLM_PROMPT`, `VLM_MAX_STONES`, `VLM_MODEL`, `ORIENTATION_MODEL_DIR`, …

---

## Veri akışı

```
[Planlama /]
  DXF → IndexedDB → StoneType → Strip
       │ makineye gönder
       ▼
  glueSheetSync + placement → /production
       │
[Üretim /production]
  POST /api/job          WS /ws/control (ai_status, job)
                \           /
                 ▼         ▼
              JobRunner / snapshot-detect
                    │
         PagedInferenceEngine → OpenCV açı → ONNX batch
```

---

## Docker

```bash
docker compose up --build
docker compose -f docker-compose.yml -f docker-compose.real.yml up
```

| Servis | Host port |
|--------|-----------|
| Next.js | 9002 → 3000 |
| Runtime | 8000 |

`RUNTIME_INTERNAL_URL=http://runtime:8000` · `NEXT_PUBLIC_RUNTIME_URL=http://localhost:8000`

---

## Teknoloji

| Katman | Stack |
|--------|--------|
| Frontend | Next.js 15, React 18, TypeScript, Three.js, Tailwind, Radix |
| CAD | dxf-parser, LibreDWG (WASM), Cavalier Contours (WASM) |
| Backend | FastAPI, uvicorn, OpenCV, NumPy, ezdxf, Pydantic |
| AI | Falcon-Perception **PagedInferenceEngine** (CUDA + torch.compile), ONNX Runtime GPU **1.20.2** (orientation) |
| Donanım | Marlin serial, USB kamera |
| Real-time | WebSocket (binary kamera + JSON kontrol) |

---

## Geliştirme

```bash
# Frontend + runtime (dev, uvicorn --reload) — Windows’ta npm run dev
npm run dev

# Sadece Next.js (:9002)
npm run dev:next

# Runtime ayrı
cd io-cam-runtime && source .venv/bin/activate   # Windows: .venv\Scripts\activate
uvicorn app.main:app --reload --port 8000

# Testler
cd io-cam-runtime && pytest
```

Loglar: `.logs/runtime.log`, `.logs/frontend.log`.  
Sınıflandırma debug: `[CLASSIFY_DEBUG] … inference=…` · VLM: `[TIMING] … engine=paged`.

---

## Orientation modeli

```
io-cam-runtime/datasets/orientation_model_v2/
  orientation_model.onnx
  class_names.json         # ["false", "true"], img_size=128
  best_model.pth
```

```bash
cd io-cam-runtime/datasets
python Train_orientation.py --coco … --images … --epochs 20 --img-size 128 --out ./orientation_model_v2
python eval_confusion.py --checkpoint orientation_model_v2/best_model.pth --with-thresholds
python export_orientation_onnx.py   # gerekirse dynamo=False
```

---

## Notlar

- Canlı stream’de VLM yok; tespit `snapshot-detect` / job `detect_all`.
- VLM motoru **PagedInferenceEngine** (paged KV + CUDA graph); eski `BatchInferenceEngine` yolu değil.
- Orientation CUDA EP; `torch` önce import edilir (cuDNN DLL). CPU fallback yavaş (~10×).
- Startup compile ~1–2 dk ilk sefer — UI bilgilendirilir, event loop bloke olmaz (`to_thread`).
- `src/services/` ve `src/legacy/` kullanılmıyor.
