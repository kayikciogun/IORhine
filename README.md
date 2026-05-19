# IO-CAM Pick & Place — Mimari & Runtime Pipeline

> **Durum:** v0.7.1 (20 May 2026)  
> **Kapsam:** DXF tabanlı taş yerleştirme; Next.js planlama + yapışkan ızgarası; Python runtime (vision pick + motion + glue sheet).  
> **Kaynak kod:** `feat/io-cam-runtime-production` dalı (`io-cam-runtime/`, `src/`, `scripts/start.sh`).  
> **Sürüm geçmişi:** [§0 — Changelog](#sürüm-geçmişi-changelog)

---

## İçindekiler

0. [Uygulama Durumu](#0-uygulama-durumu) · [Changelog](#sürüm-geçmişi-changelog)
1. [Sistem Genel Görünümü](#1-sistem-genel-görünümü)
2. [Donanım](#2-donanım)
3. [Yazılım Mimarisi](#3-yazılım-mimarisi)
4. [Planlama Pipeline (5 adım)](#4-planlama-pipeline-5-adım)
5. [Koordinat Sistemleri ve Kalibrasyon](#5-koordinat-sistemleri-ve-kalibrasyon)
6. [Production ve Job Akışı](#6-production-ve-job-akışı)
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
18. [Açık Konular](#18-açık-konular) · [Tamamlanan](#tamamlanan-kümülatif--kod)

---

## 0. Uygulama Durumu

Özet: **planlama + production UI + Python runtime tamam**; pick her zaman **vision** (konveyör + kamera + homography). `pick_sheet` ve konveyör yazılım kontrolü **kaldırıldı**.

| Bileşen | Durum | Konum |
|---------|--------|--------|
| DXF viewer, taş tipi, kontur atama | ✅ | `src/components/dxf-viewer/`, `StoneTypePanel` |
| Yapışkan şablonu (grid, SVG, DXF export) | ✅ | `stripGenerator.ts`, `StripPreview.tsx` |
| Planlama pipeline + «5. Makineye gönder» | ✅ | `planningPipeline.ts`, `ExportPanel.tsx` |
| Oturum kalıcılığı (DXF, taş, CSV, glue) | ✅ | `appSessionStore.ts`, `glueStripSync.ts` |
| Production UI (job, kamera, glue, kalibrasyon) | ✅ | `src/app/production/page.tsx` |
| Motion USB port seçici | ✅ | `MotionPortSelector.tsx`, `/api/motion/*` |
| Motion config (Z, feed, C ekseni, dwell) | ✅ | `MotionConfigPanel.tsx`, `motion_config.json` |
| `runtimeClient` REST + WS | ✅ | `src/lib/runtimeClient.ts` |
| FastAPI runtime | ✅ | `io-cam-runtime/app/` |
| `job_runner` PICK → ROTATE → GLUE → PLACE | ✅ | `app/runtime/job_runner.py` |
| Vision pick + homography | ✅ | `vision/detector.py` |
| `shortest_delta_c(target_angle, stone.angle)` | ✅ | `job_runner.py` |
| Glue `next_cell()` → `(x, y, z)` | ✅ | `glue_sheet/controller.py` |
| DXF şablon (`ezdxf`) + `_seg_*` fallback | ✅ | `template_loader.py` |
| Çoklu `shape_id` CSV (ilk satır şablon) | ✅ | `csv_loader.resolve_template_shape_id` |
| Job yükleme donanım hatası → HTTP 503 | ✅ | `api/job.py` |
| `pick_sheet` modülü | ❌ kaldırıldı | — |
| Konveyör yazılım kontrolü | ❌ kaldırıldı | Operatör elle besler |
| Vakum sensörü (gerçek okuma) | ⚠️ | `IO_CAM_VACUUM_SENSOR_PIN` + `M42` (§12); yoksa her zaman `True` |

**Çalıştırma**

| Mod | Komut |
|-----|--------|
| Mock (port/kamera yok) | `./scripts/start.sh --mock` veya `IO_CAM_MOCK_HARDWARE=1` |
| Gerçek donanım | `./scripts/start.sh` |
| Docker | `docker compose up` (+ isteğe `docker-compose.real.yml` ile `/dev/ttyUSB0`, `/dev/video0`) |

**Kaldırılan (eski):** `src/legacy/gcode/`, `app/pick_sheet/`, `/api/conveyor/*`, `IO_CAM_PICK_MODE`, tarayıcıdan doğrudan G-code gönderimi.

### Sürüm geçmişi (changelog)

| Sürüm | Tarih | Özet |
|-------|-------|------|
| **v0.7.1** | 20 May 2026 | Referans el kitabı netleştirmesi (kod değişikliği yok): §2 çoklu `shape_id` / tek vision şablonu; §5.1 `calibration/` dosya kategorileri; §7 `IO_CAM_SETTLING_MS`; §10 `GlueSheetExhausted` reset + WS `resume`; §12 `M42` vakum sensörü sınırı; çapraz referanslar. |
| **v0.7** | May 2026 | Mimari doküman kodla hizalandı: `io-cam-runtime`, motion API/UI, Production akışı, REST/WS tabloları, `pick_sheet` ve konveyör API kaldırıldı. |
| **v0.6** | May 2026 | İlk bütünleşik mimari: vision-only pick, PICK→ROTATE→GLUE→PLACE, planlama pipeline, glue strip v3, Production glue önizleme. |

Yeni **minor** veya **point** sürümde bu tabloya 2–3 satır ekleyin; üst başlıktaki sürüm + tarihi güncelleyin; §18 [Tamamlanan](#tamamlanan-kümülatif--kod) listesini senkron tutun.

---

## 1. Sistem Genel Görünümü

DXF desenindeki taşları, önceden hesaplanmış kumaş koordinatlarına (CSV) yerleştiren pick & place sistemi.

**İki yazılım parçası:**

| Parça | Rol | Adres |
|-------|-----|--------|
| **Next.js** | Planlama (`/`), üretim (`/production`) | `:9002` |
| **Python runtime** | Job, motion, glue, kamera, vision | `:8000` |

**Uçtan uca veri akışı:**

```
[Planlama — /]
  DXF + taş tipleri
       │
       ├─► Üret (Glue Levha) ──► localStorage glueStrip (v3: svgD, cols, rows)
       ├─► CSV önizle ──► localStorage placement
       └─► 5. Makineye gönder
              ├─► POST /api/glue_sheet/from_planning
              ├─► placement + planningBundle snapshot
              └─► /production

[Production — /production]
  Motion USB seç (isteğe bağlı, gerçek mod)
  Motion config kaydet (Z, feed, rotation_axis)
       │
  POST /api/job (csv + dxf)
       │
       ▼
  phase = ready → WS { "cmd": "start" }
       │
       ├─ PICK   — vision: detect_all → nearest_stone
       ├─ ROTATE — delta_c = shortest_delta_c(target_angle, stone.angle)
       ├─ GLUE   — glue.next_cell() → dip (taş kafada)
       └─ PLACE  — fabric_to_robot → bırak → rotate_c_to(0)
```

---

## 2. Donanım

| Bileşen | Detay |
|---------|--------|
| Gantry | X, Y, Z lineer + **C** rotasyon (nozzle) |
| Kontrol kartı | **Marlin** (ör. BTT SKR 3), USB serial **115200** |
| Önerilen firmware | [PixiePlacer Marlin 11.07.2023](https://github.com/PixiePlacer/PixiePlacer/tree/main/Software/Motion_Controller_Marlin/Marlin_PixiePlacer_11.07.2023) — pin/eksen uyumu için |
| Host iletişim | **pyserial** — G-code satır gönderimi (`GcodeDriver`); firmware alternatifi değil |
| Vakum | `M106`/`M107`; opsiyonel sensör (`IO_CAM_VACUUM_SENSOR_PIN`, §12) |
| Kamera | USB, sabit tepeden — vision pick + canlı önizleme |
| Konveyör | Taşları kamera alanına taşır; **yazılım kontrolü yok** |
| Yapışkan ızgarası | Dayama; tipik **20×20 mm** hücre; pick sonrası dip |
| Kumaş | Sabit fixture; `fabric_offset` kalibrasyonu |

**Prototip kabulü (konveyör + vision):**

- Konveyörde pratikte **tek fiziksel taş tipi** beslenir (aynı kontur / boyut).
- Planlama CSV’sinde **birden fazla `shape_id` sütunu olabilir** (her DXF konturunun kendi handle’ı, örn. `432_seg_0`, `432_seg_1`).
- Runtime yine de **tek bir vision şablonu** kullanır: `resolve_template_shape_id()` çoklu id görürse **ilk CSV satırının** `shape_id` değerinden `build_template_from_dxf_bytes` üretir (`csv_loader.py`).
- Diğer satırlardaki `shape_id` yalnızca kayıt amaçlıdır; pick eşleşmesi bu tek şablona göre yapılır. Farklı taş tipleri aynı job’da **desteklenmez**.

---

## 3. Yazılım Mimarisi

```
┌─────────────────────────────────────────────┐
│  Next.js (:9002)                             │
│  /              planlama                     │
│  /production    job · motion · glue · cam    │
└──────────────────┬──────────────────────────┘
                   │ REST + WebSocket
┌──────────────────▼──────────────────────────┐
│  FastAPI (:8000)  io-cam-runtime             │
│  api: job · calibration · camera · motion    │
│       vision · ws                              │
│  services → job_runner · glue · motion · cam │
└──────────────────┬──────────────────────────┘
                   │ USB Serial (G-code, pyserial)
                   ▼
            Marlin firmware → stepper X,Y,Z,C
```

**Bağımlılık yönü:**

```
api/* ──► services ──┬── vision (detector, template, calibration)
                     ├── motion (GcodeDriver, MotionController)
                     ├── glue_sheet
                     └── runtime (job_runner, camera, events, state)
```

**`AppServices` yaşam döngüsü:**

| Metod | Ne zaman | Seri port gerekir? |
|-------|----------|-------------------|
| `ensure_glue()` | Glue API, planlama sync | Hayır |
| `ensure_camera()` | `/ws/camera` | Hayır (mock/USB) |
| `init_hardware()` | İlk `load_job` (gerçek mod) | Evet |
| `load_job()` | `POST /api/job` | Evet (mock hariç) |

---

## 4. Planlama Pipeline (5 adım)

| # | Adım | UI | Kalıcılık |
|---|------|-----|-----------|
| 1 | DXF yükle | Sol panel | IndexedDB `dxf-current` |
| 2 | Taş tipi + kontur ata | Taş Tipleri | `rhinecnc:v1:pickplace` |
| 3 | Yapışkan şablonu **Üret** | Glue Levha | `rhinecnc:v1:glueStrip` (v3) |
| 4 | CSV **önizle** (isteğe bağlı) | Dışa aktar | `rhinecnc:v1:placement` |
| 5 | **Makineye gönder** | Dışa aktar | `sendPlanningToMachine()` |

**`sendPlanningToMachine()`** (`src/lib/planningPipeline.ts`):

1. `generateStripData` → `saveGlueStripSnapshot` (SVG path `svgD`, cols, rows)
2. `buildPlacementOrders` → `savePlacementSnapshot`
3. `POST /api/glue_sheet/from_planning` (origin, cols, rows, cell_size, z)
4. `savePlanningBundle` (`v: 1`) → Production özeti

**Izgara boyutu:** `glueStripGridDims(n, rowLength)` → `cols = min(rowLength, n)`, `rows = ceil(n/cols)`.

---

## 5. Koordinat Sistemleri ve Kalibrasyon

| Sistem | Birim | Kaynak |
|--------|-------|--------|
| Kamera piksel `(u, v)` | px | Ham frame |
| Robot `(X, Y)` | mm | Marlin (homography sonrası) |
| Kumaş/DXF `(X, Y)` | mm | CSV `target_x`, `target_y` |

### 5.1 `calibration/` altındaki dosyalar

Tümü `io-cam-runtime/calibration/` dizininde tutulur (Docker volume mount). **Klasör adı «kalibrasyon» olsa da** dosyalar rolüne göre üç gruptur:

| Dosya | Kategori | Amaç | UI / API |
|-------|----------|------|----------|
| `homography.npy` | **Kalibrasyon** | Kamera piksel → robot mm | `POST /api/calibration/homography` |
| `fabric_offset.json` | **Kalibrasyon** | Kumaş → robot offset | `POST /api/calibration/fabric` |
| `glue_sheet.json` | **Kalibrasyon** | Glue origin, z, cols, rows, cell_size | Planlama sync / Kal. paneli |
| `glue_sheet_state.json` | **Durum** | Glue cursor (job arası) | Otomatik (`next_cell`) |
| `vision.json` | **Kalibrasyon** | Blur, eşik, match threshold | `GET/POST /api/vision/settings` |
| `motion_config.json` | **Runtime config** | Z, feed, rotation_axis, dwell | `GET/POST /api/motion/config` |
| `motion_serial.json` | **Donanım seçimi** | Seçili Marlin USB portu | `POST /api/motion/select` |
| `camera_source.json` | **Donanım seçimi** | USB kamera index veya mock | `POST /api/camera/select` |

**Repo içi varsayılan (kalibrasyon değil):** `app/config/motion.json` — ilk kurulum değerleri; runtime başlangıcında `load_motion_config(calibration/motion_config.json)` ile üzerine yazılır.

### 5.2 Homography

Vision pick için **zorunlu**. Satranç tahtası görüntüsü → `calibrate_homography_from_frame` → `homography.npy`.

### 5.3 Glue hücre merkezi

```
col = index % cols
row = index // cols
x = origin_x + col * cell_size + cell_size / 2
y = origin_y + row * cell_size + cell_size / 2
z = glue_sheet.json → z
```

Sıra: sol-alt köşe, önce sütun, sonra satır (`glue_sheet/controller.py`).

---

## 6. Production ve Job Akışı

```
1. Runtime ayakta (./scripts/start.sh veya docker)
2. Production:
   a. Motion → USB port seç (gerçek mod, /api/motion/select)
   b. Motion config → Z, feed, rotation_axis kaydet
   c. Kamera seç (isteğe bağlı)
   d. Job yükle: POST /api/job (Form: csv, File: dxf)
      - parse_placement_csv
      - resolve_template_shape_id (çoklu shape_id → ilk satır)
      - build_template_from_dxf_bytes (veya placeholder)
      - init_hardware() → GcodeDriver + MotionController + GlueSheet
      - glue.reset()
      - JobRunner.prepare() → G28, kamera aç → phase "ready"
   e. Başlat: WS { "cmd": "start" }  (yalnızca phase === "ready")
3. Döngü §7; glue_cell / placed / state eventleri
4. Bitti: job_complete, phase "complete"
```

**Job yükleme hataları:** Seri port açılamazsa HTTP **503** + Türkçe mesaj (mock önerisi). Frontend `Failed to fetch` yerine JSON `detail` gösterir.

**Glue önizleme senkronu:** `GlueSheetStatus` ve `PlacementJobTable` aynı `activeIndex` + `phase` kullanır; WS `glue_cell` ile cursor canlı güncellenir.

---

## 7. Ana Runtime Döngüsü

Her CSV satırı `i` için (`job_runner._run_loop`):

```
LOOP: i = 0 .. total-1
    hedef = rows[i]
    await asyncio.sleep(settling_ms / 1000)   # IO_CAM_SETTLING_MS (varsayılan 300 ms)

    ┌─ PICK (vision) ────────────────────────────
    │  frame = camera.capture()
    │  stones = detect_all(frame, template, cal_dir)
    │  if not stones:
    │     emit operator_feed_required; retry
    │     empty_stone_retries aşılırsa error no_stone_detected
    │  stone = nearest_stone(stones, head_xy)
    │
    │  vacuum_pick_retries+1 deneme:
    │     safe_z → move_xy → sync → move_z(pick_z)
    │     → vacuum_on → dwell → safe_z
    │     if not vacuum_gripped(): vacuum_off; retry
    │  başarısız: error vacuum_pick_failed; continue (aynı i)

    ┌─ ROTATE ───────────────────────────────────
    │  delta_c = shortest_delta_c(hedef.target_angle, stone.angle)
    │  if |delta_c| > 0.5°: rotate_c(delta_c)

    ┌─ GLUE ─────────────────────────────────────
    │  gx, gy, gz = glue.next_cell()
    │  emit glue_cell { cell, x, y }
    │  GlueSheetExhausted → glue_sheet_exhausted, pause; operatör reset+resume (§10)
    │  move_xy → sync → move_z(gz) → dwell(glue_dwell_s) → safe_z
    │  (vakum açık, taş kafada)

    ┌─ PLACE ────────────────────────────────────
    │  rx, ry = fabric_to_robot(target_x, target_y, offset)
    │  move_xy → sync → move_z(place_z)
    │  vacuum_off → dwell → safe_z
    │  rotate_c_to(0); sync

    i++; emit placed + state

END → home, job_complete
```

**Settling süresi (`IO_CAM_SETTLING_MS`, `settings.settling_ms`):** Her döngü adımının başında (özellikle PICK öncesi) uygulanır. Konveyör veya operatör yeni taş getirdiğinde mekanik titreşim ve kamera görüntüsünün stabil olması için kısa bekleme; ardından `capture()` + `detect_all`. `operator_feed_required` sonrası yeniden denemede de aynı süre kullanılır (`job_runner.py`).

**Açı akışı:**

| Aşama | Kaynak |
|-------|--------|
| `stone.angle` | Vision PCA (+ asimetri düzeltmesi) |
| `hedef.target_angle` | CSV |
| ROTATE | `shortest_delta_c(target, stone)` |
| GLUE / PLACE | C değişmez (hedef açıda) |
| Döngü sonu | `rotate_c_to(0)` — hortum sarılması önleme |

---

## 8. Vision Modülü

### 8.1 `detect_all` (job pick)

`vision/detector.py`:

1. Gri → Gauss blur → Otsu
2. Kontür + alan filtresi (`min_contour_area`, `max_contour_area`)
3. `cv.matchShapes` (Hu) → `match_threshold`
4. PCA açı → `[0°, 360°)` (asimetrik taşlar)
5. `homography.npy` → `Stone(robot_x, robot_y, angle, score, area)`

### 8.2 `fast_detect` (canlı UI)

`/ws/camera` — düşük gecikme; tam şablon eşleşmesi yok.

### 8.3 Şablon (`template_loader.py`)

- DXF: LWPOLYLINE, LINE, ARC (5°), CIRCLE
- Handle bulunamazsa `_seg_*` → parent handle (ör. `432_seg_6` → `432`)
- Hâlâ yoksa 10×10 mm placeholder kare

### 8.4 Vision tune

`calibration/vision.json` ↔ `GET/POST /api/vision/settings`

| Parametre | Varsayılan (settings) |
|-----------|------------------------|
| `blur_kernel` | 9 |
| `min_contour_area` | 500 |
| `max_contour_area` | 80000 |
| `match_threshold` | 0.15 |
| `fast_detect_threshold` | 120 (0 = Otsu) |

---

## 9. Motion Modülü

```
job_runner → MotionController → GcodeDriver (pyserial) → Marlin
```

| Bileşen | Dosya |
|---------|--------|
| Seri G-code | `motion/gcode_driver.py` |
| Hareket API | `motion/controller.py` |
| Mock | `motion/mock_driver.py` |
| Port persist | `motion/serial_config.py` → `motion_serial.json` |
| Config persist | `motion/config_store.py` → `motion_config.json` |
| REST | `api/motion.py` |

| Metod | Açıklama |
|-------|----------|
| `home()`, `move_xy`, `move_z`, `move_to_safe_z` | Hareket |
| `rotate_c` / `rotate_c_to` | C ekseni (`rotation_axis`: **A** veya **E**) |
| `vacuum_on/off`, `vacuum_gripped()` | M106/M107; sensör §12 |
| `dwell`, `sync` (M400) | Bekleme |
| `emergency_stop` | M410 + vakum kapat |

**Config alanları** (UI + `motion_config.json`): `safe_z`, `pick_z`, `glue_z`, `place_z`, `xy_feed`, `z_feed`, `rotation_feed`, `vacuum_on_dwell_s`, `vacuum_off_dwell_s`, `glue_dwell_s`, `rotation_axis`.

**Mock:** `IO_CAM_MOCK_HARDWARE=1` → `MockSerial`; gerçek modda port yoksa **hata** (sessiz fallback yok).

Port veya `rotation_axis` değişince `services.motion` ve `runner` sıfırlanır; sonraki job yüklemede yeniden bağlanır.

---

## 10. Yapışkan Levha (Glue Sheet)

```python
gx, gy, gz = glue.next_cell()  # cursor++, state persist
```

- `load_angles` **yok** — açı §7 ROTATE’te hesaplanır
- Job yüklemede `glue.reset()`
- Planlama: `POST /api/glue_sheet/from_planning` (config yazar + reset)

**Levha bitti (`GlueSheetExhausted`) — kod + UX akışı:**

1. `next_cell()` cursor ≥ cols×rows → exception (`job_runner.py`).
2. Runtime: `glue_sheet_exhausted` WS eventi, `phase = paused`, `pause_event.clear()` → döngü **askıda** (`await pause_event.wait()`).
3. **Otomatik devam yok.** Operatör:
   - Yeni yapışkan levha takar; gerekirse `glue_sheet.json` cols/rows günceller (planlama sync veya Kal.).
   - Production → Yapışkan sekmesi → **«Levha sıfırla»** → `POST /api/glue_sheet/reset` (cursor = 0, `glue_sheet_state.json`).
   - Job kontrol → **«Devam»** → WS `{ "cmd": "resume" }` → `pause_event.set()`, döngü kaldığı **aynı CSV satırı `i`** üzerinden `next_cell()` ile devam eder.

`reset` yalnızca cursor’u sıfırlar; job’u baştan başlatmaz. `start` yalnızca `phase === ready` iken kullanılır (`JobControlPanel`). Levha değişiminde cursor=0, glue hücresi 1’den yeniden sayılır — operatör bunu bilinçli yapmalıdır.

**Production:** `GlueSheetStatus.tsx` — `loadGlueStripSnapshot()` SVG kontür + hücre durumu (`done` / `processing` / `next`).

---

## 11. Donanım Kontrol Zinciri

```
Python GcodeDriver → USB 115200 → Marlin (kartta) → stepper X,Y,Z,C
```

PC step pulse üretmez; zamanlama MCU’da.

**`M400` sync:** `move_xy`→`move_z`, vakum, place sonrası kritik.

**Firmware notu:** Host tarafında pyserial yeterli; kartta PixiePlacer veya uyumlu Marlin config (pin, steps/mm, C ekseni) gerekir.

---

## 12. Gcode Komut Sözlüğü

| Gcode | Kullanım |
|-------|----------|
| `G21` / `G90` | mm, mutlak (home) |
| `G28` | Home |
| `G0` / `G1` | XY / Z hareket |
| `G1 A..` veya `M82` + `G1 E..` | C rotasyon (`rotation_axis`) |
| `G92 A0` | C sıfır (home sonrası) |
| `M106 S255` / `M107` | Vakum aç/kapa |
| `M42 P{n}` | ⚠️ Vakum sensörü (mevcut kod, §9) |
| `G4 S..` | Dwell |
| `M400` | Hareket tamamlanana kadar bekle |
| `M410` | E-stop |
| `M114` | Konum okuma |

**Vakum sensörü (`vacuum_gripped`) — implementasyon notu:**

`MotionController.vacuum_gripped()` (`controller.py`):

- `IO_CAM_VACUUM_SENSOR_PIN` **yoksa** → her zaman `True` (sensörsüz prototip).
- **Varsa** → `M42 P{pin}` gönderir; dönen satırlarda `s255` veya `1` arar.

Standart Marlin’de `M42` dijital **çıkış** pinidir; ham `M42 P{n}` genelde pin **okumaz**. PixiePlacer veya özel firmware bu komuta anlamlı bir yanıt veriyorsa çalışır; aksi halde saha doğrulaması veya `M42 P{n} I1` / `M119` / firmware GPIO okuma gerekir. Dokümantasyon amacı: mevcut kodun varsayımını göstermek, Marlin uyumluluğunu garanti etmemek.

---

## 13. Frontend ↔ Backend Köprüsü

### 13.1 REST

| Method | Path | Amaç |
|--------|------|------|
| `GET` | `/health` | Runtime ayakta mı |
| `POST` | `/api/job` | CSV + DXF yükle |
| `GET` | `/api/job/status` | phase, index, total |
| `GET` | `/api/calibration` | homography, fabric, glue bayrakları |
| `POST` | `/api/calibration/homography` | Satranç tahtası kalibrasyonu |
| `POST` | `/api/calibration/fabric` | Kumaş offset |
| `POST` | `/api/calibration/glue_sheet` | Glue manuel |
| `POST` | `/api/glue_sheet/from_planning` | Planlama sync |
| `POST` | `/api/glue_sheet/reset` | Cursor sıfır |
| `GET` | `/api/glue_sheet/status` | cursor, remaining |
| `GET`/`POST` | `/api/vision/settings` | Vision tune |
| `GET` | `/api/camera/devices` | USB kameralar |
| `GET` | `/api/camera/status` | Seçili kaynak |
| `POST` | `/api/camera/select` | Kamera seç |
| `GET` | `/api/motion/ports` | Seri port listesi |
| `GET` | `/api/motion/status` | mock, port, initialized |
| `POST` | `/api/motion/select` | Port kaydet |
| `GET`/`POST` | `/api/motion/config` | Z, feed, rotation_axis |

### 13.2 WebSocket

**`/ws/control`:** `start`, `pause`, `resume`, `stop`, `estop`

| Event | Anlam |
|-------|--------|
| `state` | phase, i, total |
| `placed` | Satır tamam, `took_ms` |
| `glue_cell` | Glue hücre numarası + xy |
| `operator_feed_required` | Konveyöre taş koy |
| `glue_sheet_exhausted` | Levha bitti → phase `paused`; reset + WS `resume` gerekir (§10) |
| `job_complete` | Döngü bitti |
| `error` | `code`: `no_stone_detected`, `vacuum_pick_failed`, `runtime_error`, `no_job`, `estop`, … |

**`/ws/camera`:** `frame` (JPEG base64) + `stones[]` (fast_detect)

### 13.3 Tarayıcı oturumu

| Anahtar | İçerik |
|---------|--------|
| `rhinecnc:v1:pickplace` | Taş tipleri, strip config |
| `rhinecnc:v1:placement` | CSV satırları |
| `rhinecnc:v1:glueStrip` | Glue şablon v3 (`svgD`, cols, rows) |
| `rhinecnc:v1:planningBundle` | Son gönderim özeti (`v: 1`) |
| IndexedDB `dxf-current` | Ham DXF |

**Ortam:** `NEXT_PUBLIC_RUNTIME_URL` (`.env.local.example`)

---

## 14. CSV Formatı

```csv
id,target_x,target_y,target_angle,shape_id
0,125.5,80.2,45.0,1A2B
1,130.1,82.0,0.0,432_seg_0
```

| Sütun | Açıklama |
|-------|----------|
| `target_x`, `target_y` | Kumaş mm (`fabric_offset` ile robota) |
| `target_angle` | Kumaştaki kontur yönü — ROTATE hedefi |
| `shape_id` | DXF handle; bkz. §2 — çoklu id olabilir, vision **tek şablon** (ilk satır) |

**§2 ile ilişki:** Her satır farklı `shape_id` taşıyabilir (planlama export’u); pick yine de §2’deki tek şablonla yapılır. Tüm taşlar aynı kontur varsayılır.

---

## 15. Hata Durumları

| Durum | Davranış |
|-------|----------|
| Vision: taş yok | `operator_feed_required` → `no_stone_detected` |
| Vakum pick başarısız | `error` code `vacuum_pick_failed`, aynı `i` |
| Glue bitti | `glue_sheet_exhausted`, phase `paused`; `POST /api/glue_sheet/reset` + WS `resume` (§10) |
| Job yokken start | `error` code `no_job` |
| Runtime kapalı | Production local önizleme; API hata |
| Marlin / serial | `POST /api/job` → **503** |
| E-stop | `M410`, phase ERROR |

---

## 16. Tasarım Kararları

| Karar | Seçim | Gerekçe |
|-------|--------|---------|
| Pick | Her zaman vision | Konveyör pozisyonu bilinmez |
| Host motion | pyserial + G-code | Marlin ekosistemi, basit debug |
| Kart firmware | PixiePlacer Marlin (öneri) | Pin/eksen hazır config |
| Açı | `shortest_delta_c(target, stone)` | En kısa C dönüşü |
| Rotasyon zamanı | Pick sonrası, glue öncesi | Glue/place hedef açıda |
| Glue | Sadece `(x,y,z)`; açı ROTATE’te | `load_angles` kaldırıldı |
| Çoklu shape_id | İlk satır şablon | Çok konturlu DXF export |
| `_seg_*` handle | Parent DXF entity | Bölünmüş LWPOLYLINE |
| Motion config | JSON + Production UI | Saha Z/feed ayarı |
| Mock | Opt-in | Gerçek modda port zorunlu |
| Planlama → runtime | Tek «Makineye gönder» | Glue geometry + CSV |

---

## 17. Proje Yapısı

### 17.1 Frontend (`src/`)

```
src/
├── app/
│   ├── page.tsx                      # Planlama
│   └── production/page.tsx           # Üretim
├── components/
│   ├── dxf-viewer/
│   ├── pick-place/
│   │   ├── StripPreview.tsx
│   │   ├── ExportPanel.tsx
│   │   └── PipelineChecklist.tsx
│   └── production/
│       ├── JobControlPanel.tsx
│       ├── GlueSheetStatus.tsx
│       ├── PlacementJobTable.tsx
│       ├── MotionPortSelector.tsx
│       ├── MotionConfigPanel.tsx
│       ├── CalibrationPanel.tsx
│       ├── VisionTunePanel.tsx
│       ├── LiveCameraView.tsx
│       └── EventLog.tsx
├── lib/
│   ├── planningPipeline.ts
│   ├── glueStripSync.ts
│   ├── appSessionStore.ts
│   └── runtimeClient.ts
├── operations/
│   ├── stripGenerator.ts
│   ├── placementOrders.ts
│   └── csvExport.ts
└── types/runtime.ts
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
│   │   ├── motion.py
│   │   ├── vision.py
│   │   └── ws.py
│   ├── config/
│   │   ├── settings.py
│   │   ├── motion.json
│   │   └── runtime_store.py
│   ├── glue_sheet/controller.py
│   ├── motion/
│   │   ├── gcode_driver.py
│   │   ├── controller.py
│   │   ├── config_store.py
│   │   └── serial_config.py
│   ├── vision/
│   │   ├── detector.py
│   │   ├── template_loader.py
│   │   └── fast_detect.py
│   └── runtime/
│       ├── job_runner.py
│       ├── csv_loader.py
│       └── camera.py
├── calibration/          # persist (volume mount)
├── tests/
├── Dockerfile
└── .env.example
```

### 17.3 Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `IO_CAM_MOCK_HARDWARE` | `0` | Mock serial + kamera |
| `IO_CAM_SERIAL_PORT` | `/dev/ttyUSB0` | Marlin (UI ile override) |
| `IO_CAM_SERIAL_BAUD` | `115200` | |
| `IO_CAM_VACUUM_SENSOR_PIN` | — | Opsiyonel M42 |
| `IO_CAM_CAMERA_INDEX` | `0` | USB kamera |
| `IO_CAM_CORS_ORIGINS` | `localhost:9002` | |
| `IO_CAM_SETTLING_MS` | `300` | Pick öncesi bekleme |
| `IO_CAM_EMPTY_STONE_RETRIES` | `5` | |
| `IO_CAM_VACUUM_PICK_RETRIES` | `2` | |
| `NEXT_PUBLIC_RUNTIME_URL` | `http://127.0.0.1:8000` | Frontend |

Örnek: `io-cam-runtime/.env.example`, `.env.local.example`

### 17.4 Başlatıcı

`scripts/start.sh` — venv, `pip install -e io-cam-runtime[dev]`, uvicorn + `npm run dev`, `--mock` / `--install` seçenekleri.

---

## 18. Açık Konular

### Tamamlanan (kümülatif — kod)

**Runtime & job döngüsü (v0.6 → v0.7)**

- [x] Vision-only pick; `pick_sheet` modülü ve API kaldırıldı
- [x] `job_runner`: PICK → ROTATE (`shortest_delta_c`) → GLUE → PLACE
- [x] `glue.next_cell()` → `(x, y, z)`; `load_angles` kaldırıldı
- [x] Konveyör yazılım kontrolü kaldırıldı (`operator_feed_required`)
- [x] DXF şablon (`ezdxf`), `_seg_*` → parent handle
- [x] Çoklu CSV `shape_id` → tek şablon (ilk satır)
- [x] `POST /api/job` donanım hatası → HTTP 503
- [x] WS `glue_cell`; Production glue/CSV sıra senkronu

**Planlama & frontend (v0.6 → v0.7)**

- [x] 5 adımlı pipeline + `sendPlanningToMachine` + glue strip v3 (`svgD`)
- [x] Production: job, kamera, kalibrasyon, vision tune
- [x] Motion USB port + `motion_config.json` UI/API
- [x] Eski tarayıcı G-code / legacy yolları kaldırıldı

**Doküman (v0.7.1)** — ayrıntı [§0 changelog](#sürüm-geçmişi-changelog)

- [x] Referans el kitabı seviyesi; bilinen belirsizlikler (M42, glue pause UX) kayıtlı
- [x] §2 / §14 `shape_id` tutarlılığı; §5.1 kalibrasyon vs donanım seçimi ayrımı

---

### Açık — saha doğrulama

**Saha doğrulama (henüz üretimde teyit edilmeli):**

- [ ] Homography — gerçek satranç tahtası + kamera
- [ ] `stone.angle` doğruluğu (PCA + asimetri)
- [ ] `shortest_delta_c` ile yerleşim açısı
- [ ] Vakum sensörü — `M42` varsayımı vs gerçek firmware okuma (§12)
- [ ] Glue Z düzlemselliği ve `glue_dwell_s`
- [ ] PixiePlacer Marlin config ↔ `rotation_axis` (A vs E)

### Açık — iyileştirme

- [ ] Yapılandırılmış log persistence
- [ ] Job sırasında `/ws/camera` üzerinde pick overlay
- [ ] Düşük `matchShapes` skorunda alternatif taş seçimi
- [ ] Vakum sensörü pin’i Production UI’da

### Referans (repo dışı kod)

- `controlOS_demo-youtube_2021-05-18/` — orijinal controlOS / mccom referansı (commit’te mevcut, runtime’a bağlı değil)
