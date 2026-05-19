#!/usr/bin/env python3
"""
web_angle.py — Webcam açı tespiti web arayüzü
Çalıştırma: ./run_web   veya   .venv/bin/python3 web_angle.py
Tarayıcı  : http://localhost:5000
"""

import cv2 as cv
import numpy as np
import threading
import time
from flask import Flask, Response, jsonify, request

# ── Kamera ve tespit ayarları ─────────────────────────────────────────────────

MIN_AREA         = 600     # px²
BLUR_KERNEL      = 9
JPEG_QUALITY     = 80

app = Flask(__name__)

# Paylaşımlı durum
_lock        = threading.Lock()
_frame_jpg   = None
_objects     = []
_cam_error   = ""
_settings    = {
    "thresh"    : 120,
    "min_area"  : 600,
    "max_area"  : 80000,
    "show_mask" : False,
    "source"    : "0",
}
_restart_cam = threading.Event()  # kaynak değişince tetiklenir


# ── Kamera okuma iş parçacığı ─────────────────────────────────────────────────

def _parse_source(src: str):
    """'0','1' → int,  URL → str olarak döndürür."""
    src = src.strip()
    if src.isdigit():
        return int(src)
    return src


def camera_loop():
    global _frame_jpg, _objects, _cam_error

    while True:
        with _lock:
            src_raw = _settings["source"]
        source = _parse_source(src_raw)

        print(f"[kamera] kaynak açılıyor: {source!r}")
        cap = cv.VideoCapture(source)

        if not cap.isOpened():
            msg = f"Kamera açılamadı: {source!r}"
            print(f"[kamera] HATA: {msg}")
            with _lock:
                _cam_error = msg
            _make_error_frame(msg)
            _restart_cam.wait(timeout=3)
            _restart_cam.clear()
            continue

        with _lock:
            _cam_error = ""

        _restart_cam.clear()
        fail_count = 0

        while not _restart_cam.is_set():
            ret, frame = cap.read()
            if not ret:
                fail_count += 1
                if fail_count > 10:
                    print("[kamera] 10 hatalı kare — yeniden bağlanıyor")
                    break
                time.sleep(0.05)
                continue
            fail_count = 0

            # Ayarları kilitle içinde oku
            with _lock:
                thresh    = _settings["thresh"]
                min_area  = _settings["min_area"]
                max_area  = _settings["max_area"]
                show_mask = _settings["show_mask"]

            annotated, objects, mask = process(frame, thresh, min_area, max_area)
            display = cv.cvtColor(mask, cv.COLOR_GRAY2BGR) if show_mask else annotated

            ok, buf = cv.imencode(".jpg", display,
                                  [cv.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if ok:
                with _lock:
                    _frame_jpg = buf.tobytes()
                    _objects   = objects

        cap.release()
        _restart_cam.clear()


def _make_error_frame(msg: str):
    """Kamera yokken gösterilecek siyah hata karesi üretir."""
    global _frame_jpg
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    cv.putText(img, "KAMERA HATASI", (140, 160),
               cv.FONT_HERSHEY_SIMPLEX, 1.0, (60, 60, 220), 2)
    cv.putText(img, msg[:60], (30, 210),
               cv.FONT_HERSHEY_SIMPLEX, 0.55, (160, 160, 160), 1)
    cv.putText(img, "Kaynak girin ve [Baglat] a basin", (100, 270),
               cv.FONT_HERSHEY_SIMPLEX, 0.55, (100, 200, 100), 1)
    _, buf = cv.imencode(".jpg", img)
    with _lock:
        _frame_jpg = buf.tobytes()


def normalize_angle(rect):
    """
    minAreaRect → [0, 180) derece, uzun kenar baz alınır.
      0°  = yatay
      90° = dikey
    """
    angle = rect[2]   # OpenCV: [-90, 0)
    w, h  = rect[1]
    if w < h:
        # OpenCV kısa kenarı ölçtü; uzun kenara çevir
        angle += 90
    return angle % 180


def process(frame, thresh_val, min_area=MIN_AREA, max_area=80000):
    gray  = cv.cvtColor(frame, cv.COLOR_BGR2GRAY)
    blur  = cv.GaussianBlur(gray, (BLUR_KERNEL, BLUR_KERNEL), 0)
    _, bw = cv.threshold(blur, thresh_val, 255, cv.THRESH_BINARY_INV)

    contours, _ = cv.findContours(bw, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    out     = frame.copy()
    objects = []

    for i, c in enumerate(contours, 1):
        area = cv.contourArea(c)
        if area < min_area or area > max_area:
            continue

        rect  = cv.minAreaRect(c)
        angle = normalize_angle(rect)
        cx, cy = int(rect[0][0]), int(rect[0][1])
        w, h   = rect[1]

        # Döndürülmüş kutu
        box = cv.boxPoints(rect).astype(np.int32)
        cv.drawContours(out, [box], 0, (0, 220, 120), 2)

        # Uzun kenar boyunca iki yönlü eksen çizgisi
        half     = int(max(w, h) / 2) + 12
        rad      = np.deg2rad(angle)
        cos_a    = np.cos(rad)
        sin_a    = np.sin(rad)
        p1 = (int(cx - half * cos_a), int(cy - half * sin_a))
        p2 = (int(cx + half * cos_a), int(cy + half * sin_a))
        cv.line(out, p1, p2, (0, 140, 255), 2)
        cv.arrowedLine(out, p1, p2, (0, 140, 255), 2, tipLength=0.2)
        cv.circle(out, (cx, cy), 5, (0, 60, 255), -1)

        # Etiket
        label = f"#{i}  {angle:.1f}\u00b0"
        (tw, th), _ = cv.getTextSize(label, cv.FONT_HERSHEY_SIMPLEX, 0.56, 1)
        lx, ly = cx - tw // 2, cy - 16
        cv.rectangle(out, (lx - 3, ly - th - 3), (lx + tw + 3, ly + 4),
                     (0, 0, 0), -1)
        cv.putText(out, label, (lx, ly),
                   cv.FONT_HERSHEY_SIMPLEX, 0.56, (0, 220, 255), 1, cv.LINE_AA)

        objects.append({
            "id"   : i,
            "angle": round(angle, 1),
            "cx"   : cx,
            "cy"   : cy,
            "w"    : round(float(w), 1),
            "h"    : round(float(h), 1),
            "area" : round(area),
        })

    return out, objects, bw


# ── Flask rotaları ────────────────────────────────────────────────────────────

def gen_stream():
    while True:
        with _lock:
            jpg = _frame_jpg
        if jpg is None:
            time.sleep(0.02)
            continue
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n")
        time.sleep(0.03)   # ~30 fps


@app.get("/stream")
def stream():
    return Response(gen_stream(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/objects")
def api_objects():
    with _lock:
        data = list(_objects)
    return jsonify(data)


@app.post("/api/settings")
def api_settings():
    body = request.get_json(silent=True) or {}
    with _lock:
        if "thresh" in body:
            _settings["thresh"]    = int(body["thresh"])
        if "min_area" in body:
            _settings["min_area"]  = int(body["min_area"])
        if "max_area" in body:
            _settings["max_area"]  = int(body["max_area"])
        if "show_mask" in body:
            _settings["show_mask"] = bool(body["show_mask"])
        if "source" in body:
            _settings["source"] = str(body["source"])
            _restart_cam.set()          # kamera iş parçacığını yeniden başlat
    return jsonify(ok=True)


@app.get("/api/status")
def api_status():
    with _lock:
        return jsonify(source=_settings["source"], error=_cam_error)


@app.get("/api/scan")
def api_scan():
    """0–4 arası indexleri test eder, açılabilen kameraları döndürür."""
    import os, sys
    found = []
    # OpenCV'nin 'out of bound' uyarılarını bastır
    devnull = open(os.devnull, 'w')
    old_stderr = os.dup(2)
    os.dup2(devnull.fileno(), 2)
    try:
        for i in range(5):
            cap = cv.VideoCapture(i)
            if cap.isOpened():
                ret, _ = cap.read()
                found.append({"index": i, "readable": bool(ret)})
                cap.release()
    finally:
        os.dup2(old_stderr, 2)
        os.close(old_stderr)
        devnull.close()
    return jsonify(cameras=found)


@app.get("/")
def index():
    return HTML


# ── HTML / CSS / JS ───────────────────────────────────────────────────────────

HTML = """<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Webcam Açı Tespiti</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }

  body {
    background: #0d1117;
    color: #e6edf3;
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    background: #161b22;
    border-bottom: 1px solid #30363d;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header h1 { font-size: 1.15rem; font-weight: 600; }
  .badge {
    background: #238636;
    color: #fff;
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
    letter-spacing: .5px;
  }
  #status-dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: #f85149;
    flex-shrink: 0;
    transition: background .3s;
  }
  #status-dot.live { background: #3fb950; box-shadow: 0 0 6px #3fb95088; }

  main {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: 0;
  }

  /* ── Video paneli ── */
  .video-panel {
    background: #010409;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    border-right: 1px solid #30363d;
  }
  .video-panel img {
    max-width: 100%;
    border-radius: 8px;
    border: 1px solid #30363d;
  }
  .video-label {
    margin-top: 10px;
    font-size: 0.75rem;
    color: #8b949e;
  }

  /* ── Sağ panel ── */
  .side-panel {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: #0d1117;
  }

  .section {
    padding: 16px;
    border-bottom: 1px solid #21262d;
  }
  .section h2 {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #8b949e;
    margin-bottom: 12px;
  }

  /* ── Kontroller ── */
  .control-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .control-row label {
    font-size: 0.82rem;
    color: #c9d1d9;
    min-width: 60px;
  }
  input[type=range] {
    flex: 1;
    accent-color: #388bfd;
    height: 4px;
  }
  .val-badge {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 0.8rem;
    min-width: 38px;
    text-align: center;
    color: #79c0ff;
    font-variant-numeric: tabular-nums;
  }

  /* toggle */
  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.82rem;
    color: #c9d1d9;
    cursor: pointer;
  }
  .toggle {
    position: relative;
    width: 38px; height: 20px;
    flex-shrink: 0;
  }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .slider-tog {
    position: absolute; inset: 0;
    background: #30363d;
    border-radius: 20px;
    transition: .2s;
  }
  .slider-tog::before {
    content: '';
    position: absolute;
    width: 14px; height: 14px;
    left: 3px; top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: .2s;
  }
  .toggle input:checked + .slider-tog { background: #388bfd; }
  .toggle input:checked + .slider-tog::before { transform: translateX(18px); }

  /* ── İstatistikler ── */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stat-card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .stat-card .label { font-size: 0.68rem; color: #8b949e; margin-bottom: 4px; }
  .stat-card .value {
    font-size: 1.25rem;
    font-weight: 700;
    color: #e6edf3;
    font-variant-numeric: tabular-nums;
  }

  /* ── Nesne tablosu ── */
  .obj-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .obj-table th {
    text-align: left;
    padding: 6px 8px;
    color: #8b949e;
    border-bottom: 1px solid #21262d;
    font-weight: 500;
  }
  .obj-table td {
    padding: 7px 8px;
    border-bottom: 1px solid #21262d;
    font-variant-numeric: tabular-nums;
  }
  .obj-table tr:last-child td { border-bottom: none; }
  .obj-table tr:hover td { background: #161b22; }

  .angle-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 700;
    font-size: 0.78rem;
    background: #0d419d;
    color: #79c0ff;
  }

  .empty-msg {
    text-align: center;
    padding: 24px;
    color: #484f58;
    font-size: 0.82rem;
  }

  footer {
    background: #161b22;
    border-top: 1px solid #30363d;
    padding: 8px 24px;
    font-size: 0.72rem;
    color: #484f58;
    display: flex;
    gap: 16px;
  }
</style>
</head>
<body>

<header>
  <div id="status-dot"></div>
  <h1>Webcam Açı Tespiti</h1>
  <span class="badge">CANLI</span>
</header>

<main>
  <div class="video-panel">
    <img id="feed" src="/stream" alt="kamera">
    <div class="video-label">Kamera görüntüsü — yeşil kutu: bounding box &nbsp;|&nbsp; turuncu ok: açı yönü</div>
  </div>

  <div class="side-panel">

    <div class="section">
      <h2>Kamera Kaynağı</h2>

      <!-- Tara butonu -->
      <button onclick="scanCameras()" id="scan-btn"
        style="width:100%;background:#161b22;border:1px solid #30363d;
               border-radius:6px;padding:7px;color:#79c0ff;font-size:0.82rem;
               cursor:pointer;margin-bottom:10px;transition:.15s"
        onmouseover="this.style.borderColor='#388bfd'"
        onmouseout="this.style.borderColor='#30363d'">
        🔍 Kameraları Tara
      </button>

      <!-- Bulunan kameralar -->
      <div id="cam-buttons" style="display:flex;flex-wrap:wrap;gap:6px;
           margin-bottom:10px;min-height:28px">
        <span style="font-size:0.75rem;color:#484f58">
          Tara butonuna basın…
        </span>
      </div>

      <!-- Manuel kaynak -->
      <div style="display:flex;gap:6px;align-items:center">
        <input id="src-input" type="text" value="0"
          placeholder="0  veya  rtsp://..."
          style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;
                 padding:6px 10px;color:#e6edf3;font-size:0.82rem;outline:none">
        <button id="src-btn" onclick="applySource()"
          style="background:#238636;border:none;border-radius:6px;
                 padding:6px 12px;color:#fff;font-size:0.82rem;cursor:pointer;
                 white-space:nowrap">
          Bağlat
        </button>
      </div>

      <div id="cam-error" style="margin-top:6px;font-size:0.75rem;
           color:#f85149;display:none"></div>
    </div>

    <div class="section">
      <h2>Görüntü Ayarları</h2>

      <div class="control-row">
        <label>Eşik</label>
        <input type="range" id="thresh-slider" min="0" max="255" value="120">
        <span class="val-badge" id="thresh-val">120</span>
      </div>

      <div class="control-row">
        <label>Min Alan</label>
        <input type="range" id="area-slider" min="100" max="5000" step="100" value="600">
        <span class="val-badge" id="area-val">600</span>
      </div>

      <div class="control-row" style="margin-bottom:0">
        <label>Maks Alan</label>
        <input type="range" id="maxarea-slider" min="1000" max="200000" step="1000" value="80000">
        <span class="val-badge" id="maxarea-val">80k</span>
      </div>

      <div style="margin-top:12px">
        <label class="toggle-row">
          <span class="toggle">
            <input type="checkbox" id="mask-toggle">
            <span class="slider-tog"></span>
          </span>
          Maske görünümü
        </label>
      </div>
    </div>

    <div class="section">
      <h2>İstatistikler</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Nesne</div>
          <div class="value" id="stat-count">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Ort. Açı</div>
          <div class="value" id="stat-avg">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Min Açı</div>
          <div class="value" id="stat-min">—</div>
        </div>
        <div class="stat-card">
          <div class="label">Maks Açı</div>
          <div class="value" id="stat-max">—</div>
        </div>
      </div>
    </div>

    <div class="section" style="flex:1; border-bottom:none">
      <h2>Tespit Edilen Nesneler</h2>
      <div id="obj-list">
        <div class="empty-msg">Nesne bekleniyor…</div>
      </div>
    </div>

  </div>
</main>

<footer>
  <span>controlOS demo</span>
  <span id="fps-label">FPS: —</span>
  <span id="ts-label"></span>
</footer>

<script>
const threshSlider    = document.getElementById('thresh-slider');
const threshVal       = document.getElementById('thresh-val');
const areaSlider      = document.getElementById('area-slider');
const areaVal         = document.getElementById('area-val');
const maxAreaSlider   = document.getElementById('maxarea-slider');
const maxAreaVal      = document.getElementById('maxarea-val');
const maskToggle      = document.getElementById('mask-toggle');
const dot             = document.getElementById('status-dot');

let minArea = 600;
let maxArea = 80000;
let frameCount = 0, lastFpsTime = Date.now(), fps = 0;

// ── Kamera tarama ────────────────────────────────────────────────────────────
async function scanCameras() {
  const btn  = document.getElementById('scan-btn');
  const box  = document.getElementById('cam-buttons');
  btn.textContent = '⏳ Taranıyor…';
  btn.disabled = true;
  box.innerHTML = '<span style="font-size:.75rem;color:#8b949e">Lütfen bekleyin…</span>';

  try {
    const r = await fetch('/api/scan');
    const d = await r.json();

    if (d.cameras.length === 0) {
      box.innerHTML = '<span style="font-size:.75rem;color:#f85149">Hiç kamera bulunamadı</span>';
    } else {
      box.innerHTML = d.cameras.map(c => `
        <button onclick="selectCamera(${c.index})"
          style="background:${c.readable ? '#0d419d' : '#2d1c1c'};
                 border:1px solid ${c.readable ? '#388bfd' : '#6e2020'};
                 border-radius:6px;padding:5px 12px;
                 color:${c.readable ? '#79c0ff' : '#f85149'};
                 font-size:0.8rem;cursor:pointer">
          📷 Kamera ${c.index}
        </button>`).join('');
    }
  } catch(e) {
    box.innerHTML = '<span style="font-size:.75rem;color:#f85149">Tarama hatası</span>';
  }

  btn.textContent = '🔍 Kameraları Tara';
  btn.disabled = false;
}

function selectCamera(index) {
  document.getElementById('src-input').value = String(index);
  applySource();
  // Seçili butonu vurgula
  document.querySelectorAll('#cam-buttons button').forEach((b, i) => {
    b.style.background = b.textContent.includes('Kamera ' + index)
      ? '#1a4a1a' : (b.style.background.includes('0d419d') ? '#0d419d' : '#2d1c1c');
  });
}

// ── Kamera kaynağı ───────────────────────────────────────────────────────────
function applySource() {
  const src = document.getElementById('src-input').value.trim();
  if (!src) return;
  const btn = document.getElementById('src-btn');
  btn.textContent = '…';
  btn.disabled = true;
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: src })
  }).finally(() => {
    setTimeout(() => { btn.textContent = 'Bağlat'; btn.disabled = false; }, 1500);
  });
}

// Enter tuşu ile de bağlanabilsin
document.getElementById('src-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') applySource();
});

// Kamera durum polling
async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return;
    const d = await r.json();
    const errEl = document.getElementById('cam-error');
    if (d.error) {
      errEl.textContent = '⚠ ' + d.error;
      errEl.style.display = 'block';
      dot.classList.remove('live');
    } else {
      errEl.style.display = 'none';
    }
  } catch(_) {}
  setTimeout(pollStatus, 2000);
}
pollStatus();

// ── Görüntü ayarları ─────────────────────────────────────────────────────────
threshSlider.addEventListener('input', () => {
  threshVal.textContent = threshSlider.value;
  sendSettings();
});

areaSlider.addEventListener('input', () => {
  minArea = parseInt(areaSlider.value);
  areaVal.textContent = minArea;
  sendSettings();
});

maxAreaSlider.addEventListener('input', () => {
  maxArea = parseInt(maxAreaSlider.value);
  maxAreaVal.textContent = maxArea >= 1000 ? Math.round(maxArea/1000) + 'k' : maxArea;
  sendSettings();
});

maskToggle.addEventListener('change', sendSettings);

function sendSettings() {
  fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      thresh:    parseInt(threshSlider.value),
      min_area:  minArea,
      max_area:  maxArea,
      show_mask: maskToggle.checked,
    })
  });
}

// ── FPS sayacı (stream img yüklenince) ──────────────────────────────────────
document.getElementById('feed').addEventListener('load', () => {
  frameCount++;
  const now = Date.now();
  if (now - lastFpsTime >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
    frameCount = 0;
    lastFpsTime = now;
    document.getElementById('fps-label').textContent = `FPS: ${fps}`;
  }
  dot.classList.add('live');
});

// ── Nesne verisi polling ─────────────────────────────────────────────────────
function angleColor(a) {
  // 0°→kırmızı, 90°→yeşil, 180°→mavi tonlaması
  const h = Math.round(a * 2);
  return `hsl(${h},70%,55%)`;
}

function renderObjects(objects) {
  const filtered = objects.filter(o => o.area >= minArea);

  document.getElementById('stat-count').textContent = filtered.length;

  if (filtered.length === 0) {
    document.getElementById('stat-avg').textContent = '—';
    document.getElementById('stat-min').textContent = '—';
    document.getElementById('stat-max').textContent = '—';
    document.getElementById('obj-list').innerHTML =
      '<div class="empty-msg">Nesne bulunamadı — eşiği veya min. alanı ayarlayın</div>';
    return;
  }

  const angles = filtered.map(o => o.angle);
  const avg = (angles.reduce((a,b)=>a+b,0)/angles.length).toFixed(1);
  const min = Math.min(...angles).toFixed(1);
  const max = Math.max(...angles).toFixed(1);

  document.getElementById('stat-avg').textContent = avg + '°';
  document.getElementById('stat-min').textContent = min + '°';
  document.getElementById('stat-max').textContent = max + '°';

  const rows = filtered.map(o => `
    <tr>
      <td>#${o.id}</td>
      <td><span class="angle-pill" style="background:${angleColor(o.angle)}22;color:${angleColor(o.angle)}">${o.angle}°</span></td>
      <td>${o.cx}, ${o.cy}</td>
      <td>${Math.round(o.w)} × ${Math.round(o.h)}</td>
      <td>${o.area}</td>
    </tr>`).join('');

  document.getElementById('obj-list').innerHTML = `
    <table class="obj-table">
      <thead>
        <tr>
          <th>#</th><th>Açı</th><th>Merkez</th><th>Boyut</th><th>Alan px²</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function poll() {
  try {
    const res = await fetch('/api/objects');
    if (res.ok) renderObjects(await res.json());
  } catch(_) {}
  document.getElementById('ts-label').textContent =
    new Date().toLocaleTimeString('tr-TR');
  setTimeout(poll, 200);
}

poll();
</script>
</body>
</html>
"""


# ── Başlatma ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    t = threading.Thread(target=camera_loop, daemon=True)
    t.start()
    print("╔══════════════════════════════════════╗")
    print("║  Webcam Açı Tespiti  →  http://localhost:7070  ║")
    print("╚══════════════════════════════════════╝")
    app.run(host="0.0.0.0", port=7070, threaded=True)
