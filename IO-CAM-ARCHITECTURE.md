# IO-CAM Pick & Place — Mimari & Runtime Pipeline

> **Durum:** v0.6 (May 2026)  
> **Kapsam:** DXF tabanlı taş yerleştirme; Next.js planlama + yapışkan ızgarası; Python runtime motion + glue sheet + vision pick.

---

## İçindekiler

0. [Uygulama Durumu](#0-uygulama-durumu)
1. [Sistem Genel Görünümü](#1-sistem-genel-görünümü)
2. [Donanım](#2-donanım)
3. [Yazılım Mimarisi](#3-yazılım-mimarisi)
4. [Planlama Pipeline (5 adım)](#4-planlama-pipeline-5-adım)
5. [Koordinat Sistemleri ve Kalibrasyon](#5-koordinat-sistemleri-ve-kalibrasyon)
6. [Job Başlatma Akışı](#6-job-başlatma-akışı)
7. [Ana Runtime Döngüsü](#7-ana-runtime-döngüsü)
8. [Vision Modülü](#8-vision-modülü)
9. [Motion Modülü](#9-motion-modülü)
10. [Yapışkan Levha (Glue Sheet)](#10-yapışkan-levha-glue-sheet)
11. [Donanım Kontrol Zinciri](#11-donanım-kontrol-zinciri)
12. [Gcode Komut Sözlüğü](#12-gcode-komut-sözlüğü)
13. [Frontend ↔ Backend Köprüsü](#13-frontend--backend-köprüsü)
14. [CSV Formatı](#14-csv-formatı)
15. [Hata Durumları](#15-hata-durumları)
16. [Tasarım Kararları](#16-tasarım-kararları)
17. [Proje Yapısı](#17-proje-yapısı)
18. [Açık Konular](#18-açık-konular)

---

## 0. Uygulama Durumu

Özet: **planlama pipeline + production UI tamam**; pick her zaman **vision** (konveyör + kamera + homography).

| Bileşen | Durum | Konum |
|---------|--------|--------|
| DXF viewer, taş tipi, kontur atama | ✅ | `src/components/dxf-viewer/`, `StoneTypePanel` |
| Yapışkan şablonu (20 mm grid, SVG önizleme, DXF export) | ✅ | `stripGenerator.ts`, `StripPreview.tsx` |
| Planlama pipeline + checklist + «5. Makineye gönder» | ✅ | `planningPipeline.ts`, `ExportPanel.tsx` |
| Oturum kalıcılığı (DXF, taş, CSV, glue şablon) | ✅ | `appSessionStore.ts`, `glueStripSync.ts` |
| Production UI (job, kamera, glue önizleme, kalibrasyon) | ✅ | `src/app/production/` |
| `runtimeClient` REST + WS | ✅ | `src/lib/runtimeClient.ts` |
| Python FastAPI + modüller | ✅ | `io-cam-runtime/app/` |
| `job_runner` PICK → ROTATE → GLUE → PLACE | ✅ | `app/runtime/job_runner.py` |
| Vision pick (kamera + homography) | ✅ | `detector.py` |
| Açı düzeltmesi: `delta_c = target_angle - stone.angle` | ✅ | `job_runner.py` |
| Glue sheet cursor + CSV açı sırası | ✅ | `glue_sheet/controller.py` |
| DXF → runtime şablon (`ezdxf`) | ✅ | `template_loader.py` |
| Homography kalibrasyonu | ✅ | `CalibrationPanel` |
| `vacuum_pick_retries` | ✅ | `job_runner` + `vacuum_gripped()` |
| Vision tune UI | ✅ | `VisionTunePanel`, `/api/vision/settings` |
| `pick_sheet` modülü | ❌ kaldırıldı | — |
| Konveyör yazılım kontrolü | ❌ kaldırıldı | Operatör elle besler |
| Vakum sensörü (gerçek okuma) | ⚠️ | `IO_CAM_VACUUM_SENSOR_PIN`; yoksa optimistic `True` |

**Mock:** `IO_CAM_MOCK_HARDWARE=1` veya `./scripts/start.sh --mock`  
**Gerçek donanım:** `./scripts/start.sh` veya `docker compose -f docker-compose.yml -f docker-compose.real.yml up`

**Silinen:** `src/legacy/gcode/`, `conveyor/` modülü, `ConveyorSettingsPanel`, `/api/conveyor/*`  
**Silinmeli:** `pick_sheet/` modülü, `/api/calibration/pick_sheet`, `/api/pick_sheet/status`, `IO_CAM_PICK_MODE`

---

## 1. Sistem Genel Görünümü

DXF desenindeki taşları, önceden hesaplanmış kumaş koordinatlarına (CSV) yerleştiren pick & place sistemi.

**İki yazılım parçası:**

| Parça | Rol |
|-------|-----|
| **Next.js** (`/`) | DXF, taş tipleri, yapışkan şablonu, CSV, «Makineye gönder» |
| **Python runtime** (`:8000`) | Job döngüsü, motion, glue sheet, kamera + vision pick |

**Uçtan uca veri akışı:**

```
[Planlama]
  DXF + taş tipleri
       │
       ├─► Üret (Glue Levha) ──► localStorage glueStrip (v3: svgD, cols, rows)
       ├─► CSV önizle ──► localStorage placement
       └─► 5. Makineye gönder
              ├─► POST /api/glue_sheet/from_planning
              ├─► placement snapshot
              └─► router → /production

[Production]
  POST /api/job (csv + dxf)
       │
       ▼
  WS start → job_runner döngüsü
       │
       ├─ PICK   — konveyörden vision: detect_all → nearest_stone (x, y, angle)
       ├─ ROTATE — hedef açıya döndür: delta_c = CSV target_angle − stone.angle
       ├─ GLUE   — yapışkan grid hücre i'ye dip (taşı bırakma, sadece yapışkan)
       └─ PLACE  — kumaşa CSV (target_x, target_y) konumuna bırak
```

---

## 2. Donanım

| Bileşen | Detay |
|---------|--------|
| Gantry | X, Y, Z lineer + **C** rotasyon (nozzle) |
| Kontrol | Marlin (ör. BTT SKR 3), USB serial 115200 |
| Vakum | M106/M107; opsiyonel sensör (`IO_CAM_VACUUM_SENSOR_PIN`) |
| Kamera | Sabit, tepeden — vision pick + canlı önizleme |
| Konveyör | Taşları kamera görüş alanına taşır; yazılım kontrolü yok (operatör) |
| **Yapışkan ızgarası** | Dayama; **20×20 mm** hücreler; pick sonrası dip |
| Kumaş | Sabit fixture; `fabric_offset` kalibrasyonu |

**Prototip kabulü:** Job süresince tek `shape_id`. Alma ızgarası yok — taşlar konveyörden kamera alanına gelir, vision ile tespit edilir.

---

## 3. Yazılım Mimarisi

```
┌─────────────────────────────────────────────┐
│  Next.js (:9002)                             │
│  / planlama    /production                   │
│  DXF · taş · strip · export · pipeline      │
└──────────────────┬──────────────────────────┘
                   │ REST + WebSocket
┌──────────────────▼──────────────────────────┐
│  FastAPI (:8000)                            │
│  vision · motion · glue_sheet               │
│  job_runner · camera                         │
└──────────────────┬──────────────────────────┘
                   │ USB Serial (Gcode)
                   ▼
            Marlin → motorlar
```

**Deployment:** `docker-compose.yml` (app + runtime); gerçek donanım için `docker-compose.real.yml` (`/dev/ttyUSB0`, `/dev/video0`).

**Bağımlılık yönü:**

```
api ──► services ──┬── vision
                   ├── motion
                   ├── glue_sheet
                   └── runtime (job_runner, camera)
```

---

## 4. Planlama Pipeline (5 adım)

| # | Adım | UI | Kalıcılık |
|---|------|-----|-----------|
| 1 | DXF yükle | Sol panel | IndexedDB `dxf-current` |
| 2 | Taş tipi + kontur ata | Taş Tipleri | `localStorage` pickplace |
| 3 | Yapışkan şablonu **Üret** | Glue Levha | `rhinecnc:v1:glueStrip` (v3) |
| 4 | CSV **önizle** (isteğe bağlı) | Dışa aktar | `rhinecnc:v1:placement` |
| 5 | **Makineye gönder** | Dışa aktar | `sendPlanningToMachine()` → runtime + `/production` |

**`sendPlanningToMachine()`** (`src/lib/planningPipeline.ts`):

1. `generateStripData` → `saveGlueStripSnapshot` (svg path + cols/rows)
2. `buildPlacementOrders` → `savePlacementSnapshot`
3. `POST /api/glue_sheet/from_planning` (cols, rows, origin, cell_size)
4. `savePlanningBundle` → Production özeti

**Izgara boyutu:** `glueStripGridDims(n, rowLength)` → `cols = min(rowLength, n)`, `rows = ceil(n/cols)`.

---

## 5. Koordinat Sistemleri ve Kalibrasyon

| Sistem | Birim | Kaynak |
|--------|-------|--------|
| Kamera piksel `(u, v)` | px | Ham frame |
| Robot `(X, Y)` | mm | Marlin |
| Kumaş/DXF `(X, Y)` | mm | CSV `target_x, target_y` |

### 5.1 Kalibrasyon dosyaları (`io-cam-runtime/calibration/`)

| Dosya | Amaç | UI |
|-------|------|-----|
| `homography.npy` | Kamera piksel → robot mm | Production → Kal. (satranç tahtası) |
| `glue_sheet.json` | Yapışkan ızgarası origin, z, cols, rows, cell_size | Production → Kal. |
| `glue_sheet_state.json` | Glue cursor (job arası persist) | Otomatik |
| `fabric_offset.json` | Kumaş → robot offset | Production → Kal. |
| `vision.json` | Blur, eşik, match threshold | Production → Görüntü |

### 5.2 Homography

Kamera piksel `(u, v)` → robot `(X, Y)` mm dönüşümü. Vision pick için **zorunlu**.  
`POST /api/calibration/homography` — satranç tahtası görüntüsünden hesaplanır.

### 5.3 Glue hücre merkezi formülü

```
col = index % cols
row = index // cols
x = origin_x + col * cell_size + cell_size / 2
y = origin_y + row * cell_size + cell_size / 2
```

---

## 6. Job Başlatma Akışı

```
1. Planlama tamamlandı (§4)
2. Production: POST /api/job
   - Form: csv + dxf
   - template: build_template_from_dxf_bytes veya placeholder kare
   - glue.load_angles(CSV target_angle listesi); glue.reset()
   - init_hardware() → motion + glue + camera
3. JobRunner.prepare(): G28, kamera aç → phase "ready"
4. WS { "cmd": "start" } → _run_loop
```

---

## 7. Ana Runtime Döngüsü

Her CSV satırı `i` için (`job_runner._run_loop`):

```
LOOP: i = 0 .. total-1
    hedef = rows[i]

    ┌─ PICK ─────────────────────────────────────
    │  frame = camera.capture()
    │  stones = detect_all(frame, template, cal_dir)
    │  # → her taş: robot_x, robot_y, angle (kameradan homography)
    │  if not stones:
    │     emit operator_feed_required; retry; N kez sonra no_stone_detected
    │  stone = nearest_stone(stones, head_xy)
    │
    │  PICK motion (vacuum_pick_retries+1 deneme):
    │     safe_z → move_xy(stone.x, stone.y) → sync
    │     → move_z(pick_z) → vacuum_on → dwell → safe_z
    │     if not vacuum_gripped(): vacuum_off; retry
    │  if all fail: emit vacuum_pick_failed; continue (aynı i)
    │
    ┌─ ROTATE ───────────────────────────────────
    │  # Taşı hedef açıya getir (pick sırasında tespite göre)
    │  delta_c = target_angle − stone.angle        # CSV target_angle
    │  delta_c = ((delta_c + 180) % 360) − 180     # en kısa yön
    │  if |delta_c| > 0.5°: rotate_c(delta_c)
    │  # C ekseni artık target_angle pozisyonunda
    │
    ┌─ GLUE ─────────────────────────────────────
    │  gx, gy, gz = glue.next_cell()   # sıralı: sol-alt → satır satır
    │  if GlueSheetExhausted: pause, emit glue_sheet_exhausted, bekle, retry
    │  move_xy(gx, gy) → sync → move_z(gz)
    │  dwell(glue_dwell_s)              # 0.5 s — yapışkan transferi
    │  safe_z                           # vakum AÇIK, taş KAFADA KALIR
    │
    ┌─ PLACE ────────────────────────────────────
    │  rx, ry = fabric_to_robot(hedef.target_x, hedef.target_y, offset)
    │  move_xy(rx, ry) → sync → move_z(place_z)
    │  vacuum_off → dwell → safe_z
    │  rotate_c_to(0); sync             # C sıfırla (hortum sarılması)
    │
    i++; emit placed + state

END → home, job_complete
```

**Açı akışı:**
- Vision tespiti: `stone.angle` — kameradaki taşın yönü (homography'den bağımsız, PCA açısı)
- Hedef: `hedef.target_angle` — CSV'deki kumaş üzerindeki kontur yönü
- Rotasyon: `delta_c = target_angle − stone.angle` → kafayı glue'ye giderken döndür
- Glue dip: taş zaten doğru açıda, sadece yapışkan transferi
- Place: C ekseni değişmez, taş hedef açısında bırakılır
- Döngü sonu: `rotate_c_to(0)`

---

## 8. Vision Modülü

### 8.1 `detect_all` (job pick)

`vision.detect_all(frame, template, cal_dir) -> list[Stone]`:

1. Gri → Gauss blur → Otsu eşikleme
2. `cv.findContours` → alan filtresi
3. Her kontür: `cv.matchShapes` (Hu moments) → skor filtresi
4. PCA → ana eksen açısı `[0°, 180°)` → asimetri → `[0°, 360°)` (yönlü taşlar)
5. Homography (`homography.npy`) → piksel → robot mm

**Çıktı:** `[Stone(robot_x, robot_y, angle, score, area), ...]`

### 8.2 `fast_detect` (canlı UI)

`/ws/camera` → düşük gecikme önizleme; `matchShapes` yok, sadece kontur bbox.

### 8.3 Şablon

`build_template_from_dxf_bytes` (`ezdxf`): LWPOLYLINE, LINE, ARC (5° örnekleme), CIRCLE.  
Başarısız parse → 10×10 mm placeholder.

### 8.4 Vision tune

`GET/POST /api/vision/settings` → `calibration/vision.json`

| Parametre | Config |
|-----------|--------|
| `blur_kernel` | 9 |
| `min_contour_area` | 500 px² |
| `match_threshold` | 0.15 |
| `fast_detect_threshold` | 120 (0 = Otsu) |

---

## 9. Motion Modülü

```
job_runner → MotionController → GcodeDriver → pyserial → Marlin
```

| Metod | Açıklama |
|-------|----------|
| `home()`, `move_xy`, `move_z`, `move_to_safe_z` | Hareket |
| `rotate_c(delta)` / `rotate_c_to(abs)` | C ekseni |
| `vacuum_on/off`, `vacuum_gripped()` | Vakum (sensör yoksa her zaman `True`) |
| `dwell(s)`, `sync()` (M400) | Bekleme / senkron |

**Z değerleri** (`config/motion.json`): `safe_z`, `pick_z`, `glue_z`, `place_z` — fiziksel kalibrasyon ile belirlenir.

**Mock:** `IO_CAM_MOCK_HARDWARE=1` → `MockSerial`; gerçek modda port yoksa **hata** (sessiz fallback yok).

---

## 10. Yapışkan Levha (Glue Sheet)

**Dosya:** `app/glue_sheet/controller.py`, kalibrasyon: `glue_sheet.json`

```python
gx, gy, gz = glue.next_cell()   # cursor ilerler, state persist
```

- Sıralı: sol-alttan, col önce, sonra row
- Job yüklemede `reset()` — her job yeni levhayla başlar
- `GlueSheetExhausted` → pause → operatör yeni levha → frontend `reset` → resume
- Planlama sync: `POST /api/glue_sheet/from_planning`
- Cursor persist: `glue_sheet_state.json` (pause/resume, güç kesilmesi)

**Not:** `next_cell()` artık `target_angle` döndürmez — açı rotasyonu §7 ROTATE adımında `stone.angle` üzerinden hesaplanır.

**Production önizleme:** `GlueSheetStatus.tsx` → `loadGlueStripSnapshot()` kontür SVG + cursor/kalan hücre.

API: `POST /api/calibration/glue_sheet`, `POST /api/glue_sheet/from_planning`, `POST /api/glue_sheet/reset`, `GET /api/glue_sheet/status`

---

## 11. Donanım Kontrol Zinciri

```
Python (Gcode) → USB 115200 → Marlin → stepper sürücüler → X,Y,Z,C
```

PC pulse üretmez; Marlin MCU timing yapar.

**Senkronizasyon (`M400`):**

| Adım | sync gerekli |
|------|-------------|
| `move_xy` → `move_z` | **Evet** |
| `move_z` → `vacuum_on/off` | **Evet** |
| `place` → döngü sonu | **Evet** |

---

## 12. Gcode Komut Sözlüğü

| Gcode | Kullanım |
|-------|----------|
| `G28` | Home |
| `G0` / `G1` | XY / Z |
| `G1 A..` / `M82`+`G1 E..` | C rotasyon (config `rotation_axis`) |
| `M106 S255` / `M107` | Vakum açık/kapalı |
| `G4 S..` | Dwell (saniye) |
| `M400` | Sync |
| `M410` | E-stop |

---

## 13. Frontend ↔ Backend Köprüsü

### 13.1 REST

| Method | Path | Amaç |
|--------|------|------|
| `POST` | `/api/job` | CSV + DXF yükle |
| `GET` | `/api/job/status` | Job durumu |
| `GET` | `/api/calibration` | Kalibrasyon özeti |
| `POST` | `/api/calibration/homography` | Homography (satranç tahtası) |
| `POST` | `/api/calibration/fabric` | Kumaş offset |
| `POST` | `/api/calibration/glue_sheet` | Yapışkan levha (manuel) |
| `POST` | `/api/glue_sheet/from_planning` | Planlama şablonundan sync |
| `POST` | `/api/glue_sheet/reset` | Cursor sıfırla |
| `GET` | `/api/glue_sheet/status` | Kalan hücre / cursor |
| `GET`/`POST` | `/api/vision/settings` | Vision tune |
| `GET` | `/api/camera/devices` | Kamera listesi |
| `POST` | `/api/camera/select` | Kamera seç |

**Kaldırılan:** `/api/conveyor/*`, `/api/calibration/pick_sheet`, `/api/pick_sheet/status`

### 13.2 WebSocket

**`/ws/control`:** `start`, `pause`, `resume`, `stop`, `estop`

Events: `state`, `placed`, `error`, `operator_feed_required`, `glue_sheet_exhausted`, `vacuum_pick_failed`, `job_complete`

**`/ws/camera`:** `frame` + `fast_detect` taş listesi (JPEG base64)

### 13.3 Tarayıcı oturumu

| Anahtar | İçerik |
|---------|--------|
| `rhinecnc:v1:pickplace` | Taş tipleri, strip config |
| `rhinecnc:v1:placement` | CSV satırları + csv metni |
| `rhinecnc:v1:glueStrip` | Yapışkan şablon v3 (svgD, cols, rows, config) |
| `rhinecnc:v1:planningBundle` | Son gönderim özeti |
| IndexedDB `dxf-current` | Ham DXF metni |

---

## 14. CSV Formatı

```csv
id,target_x,target_y,target_angle,shape_id
0,125.5,80.2,45.0,1A2B
1,130.1,82.0,0.0,1A2B
```

| Sütun | Açıklama |
|-------|----------|
| `target_x`, `target_y` | Kumaş düzleminde mm |
| `target_angle` | Konturun kumaştaki yönü `[0°, 360°)` — `delta_c = target_angle − stone.angle` |
| `shape_id` | DXF handle (tek tip per job) |

---

## 15. Hata Durumları

| Durum | Davranış |
|-------|----------|
| Vision: taş yok | `operator_feed_required`, retry, `no_stone_detected` |
| Vakum başarısız | `vacuum_pick_failed`, aynı satır yeniden |
| Glue bitti | `glue_sheet_exhausted`, pause, reset API |
| Runtime kapalı | Production glue paneli mesaj; localStorage önizleme kalır |
| Marlin error | `error` event, phase ERROR |
| E-stop | `M410`, vakum kapat |

---

## 16. Tasarım Kararları

| Karar | Seçim | Gerekçe |
|-------|--------|---------|
| Pick modu | Her zaman vision | Konveyörden gelen taşın pozisyonu ve açısı bilinemez |
| Açı düzeltmesi | `delta_c = target_angle − stone.angle` | Vision tespiti gerçek taş açısını verir |
| Rotasyon zamanı | Pick sonrası, glue öncesi (hareket sırasında) | Glue'de taş doğru yönde; kumaşa direkt bırakılır |
| Glue dip | Yapışkan transferi — taşı bırakmaz | C ekseni değişmez, place adımında hedef açı korunur |
| Planlama → runtime | Tek «Makineye gönder» | CSV + glue geometry + bundle |
| Izgara cols | `min(rowLength, taş sayısı)` | UI ile runtime önizleme uyumu |
| Glue cursor persist | `glue_sheet_state.json` | Pause/resume, güç kesilmesi |
| Mock | Opt-in (`--mock` / env) | Gerçek modda port zorunlu |
| Kontrol kartı | Marlin tabanlı | 4. eksen (C) desteği |
| Senkronizasyon | M400 kritik noktalarda | Look-ahead avantajı korunur |

---

## 17. Proje Yapısı

### 17.1 Frontend (`src/`)

```
src/
├── app/
│   ├── page.tsx                 # Planlama
│   └── production/page.tsx
├── components/
│   ├── dxf-viewer/
│   ├── pick-place/
│   │   ├── StripPreview.tsx
│   │   ├── ExportPanel.tsx
│   │   └── PipelineChecklist.tsx
│   └── production/
│       ├── GlueSheetStatus.tsx
│       ├── PlanningSummaryCard.tsx
│       ├── CalibrationPanel.tsx
│       ├── VisionTunePanel.tsx
│       └── ...
├── lib/
│   ├── planningPipeline.ts
│   ├── glueStripSync.ts
│   ├── appSessionStore.ts
│   └── runtimeClient.ts
└── operations/
    ├── stripGenerator.ts
    ├── placementOrders.ts
    └── csvExport.ts
```

### 17.2 Backend (`io-cam-runtime/`)

```
io-cam-runtime/
├── app/
│   ├── main.py
│   ├── services.py
│   ├── api/
│   │   ├── job.py
│   │   ├── calibration.py
│   │   ├── camera.py
│   │   ├── vision.py
│   │   └── ws.py
│   ├── glue_sheet/controller.py
│   ├── motion/
│   ├── vision/
│   └── runtime/job_runner.py
├── calibration/
└── tests/
```

**Silinmesi gereken:** `app/pick_sheet/` dizini, `api/calibration.py` içindeki pick_sheet endpoint'leri.

### 17.3 Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `IO_CAM_MOCK_HARDWARE` | `0` | Mock serial + kamera |
| `IO_CAM_SERIAL_PORT` | `/dev/ttyUSB0` | Marlin |
| `IO_CAM_VACUUM_SENSOR_PIN` | — | Opsiyonel |
| `NEXT_PUBLIC_RUNTIME_URL` | `http://127.0.0.1:8000` | Frontend → runtime |

Örnek: `io-cam-runtime/.env.example`

---

## 18. Açık Konular

**Tamamlanan (kod):**

- [x] `job_runner.py`: vision-only pick, ROTATE `delta_c = target_angle − stone.angle`
- [x] `glue_sheet/controller.py`: `next_cell()` → `(x, y, z)`; `load_angles` kaldırıldı
- [x] `pick_sheet/` modülü ve API endpoint'leri silindi
- [x] `settings.py`: `pick_mode` ve pick grid ayarları kaldırıldı
- [x] Frontend: `CalibrationPanel`, `runtime.ts`, `EventLog` güncellendi

**Saha doğrulama:**

- [ ] Homography: gerçek satranç tahtası + kamera kalibrasyonu
- [ ] Vision açı tespiti (`stone.angle`) saha doğruluğu
- [ ] `delta_c = target_angle − stone.angle` doğrulama
- [ ] Vakum sensörü (`IO_CAM_VACUUM_SENSOR_PIN`)
- [ ] Glue Z düzlemselliği

**İyileştirme:**

- [ ] Log persistence
- [ ] Job sırasında `/ws/camera` pick overlay
- [ ] `matchShapes` kötü skorda alternatif taş seçimi

**Tamamlanan:**

- [x] Konveyör modülü ve UI kaldırıldı
- [x] Planlama pipeline + glue/from_planning
- [x] Oturum kalıcılığı (glue v3 svg, placement)
- [x] Production glue kontür önizlemesi
- [x] Izgara boyutu `min(rowLength, n)` düzeltmesi
