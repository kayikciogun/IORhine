#!/usr/bin/env python3
"""
webcam_angle_test.py — Gerçek zamanlı nesne açı tespiti
Kameradan görüntü alır, kontur bulur, her nesnenin dönme açısını gösterir.

Çalıştırma:
    pip install opencv-python numpy
    python3 vision/webcam_angle_test.py

Klavye kısayolları:
    q / ESC  — çıkış
    s        — ekran görüntüsü kaydet (frame_NNNN.png)
    SPACE    — dondur / devam
    r        — eşik değerini sıfırla
"""

import cv2 as cv
import numpy as np
import time
import sys


# ── Ayarlar ──────────────────────────────────────────────────────────────────

CAMERA_INDEX      = 0       # Mac: 0 (dahili), Linux: 0 ya da '/dev/video0'
WINDOW_NAME       = "Webcam Açı Testi"
MIN_CONTOUR_AREA  = 500     # px² — daha küçük konturları yoksay
BLUR_KERNEL       = 9       # Gauss bulanıklaştırma boyutu (tek sayı)
FONT              = cv.FONT_HERSHEY_SIMPLEX

# Renk paleti (BGR)
COL_BOX    = (0,   220, 120)   # döndürülmüş bounding box
COL_ANGLE  = (0,   200, 255)   # açı yazısı
COL_CENTER = (0,   80,  255)   # merkez nokta
COL_AXIS   = (255, 80,  0  )   # ana eksen çizgisi
COL_INFO   = (230, 230, 230)   # bilgi paneli yazısı
COL_PANEL  = (30,  30,  30 )   # bilgi paneli arka plan


# ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

def draw_rotated_box(img, rect):
    """minAreaRect çıktısını çizer; dört köşe noktaları arasına çizgiler koyar."""
    box = cv.boxPoints(rect).astype(np.int32)
    cv.drawContours(img, [box], 0, COL_BOX, 2)
    return box


def draw_angle_label(img, center, angle, index):
    """Merkeze açı etiketini yazar."""
    cx, cy = int(center[0]), int(center[1])

    # merkez nokta
    cv.circle(img, (cx, cy), 5, COL_CENTER, -1)

    # açı çizgisi (px cinsinden 50 piksel uzunluğunda)
    rad = np.deg2rad(angle)
    ex  = int(cx + 50 * np.cos(rad))
    ey  = int(cy + 50 * np.sin(rad))
    cv.arrowedLine(img, (cx, cy), (ex, ey), COL_AXIS, 2, tipLength=0.3)

    # etiket
    label = f"#{index}  {angle:.1f} deg"
    (tw, th), _ = cv.getTextSize(label, FONT, 0.55, 1)
    lx = cx - tw // 2
    ly = cy - 14
    cv.rectangle(img, (lx - 3, ly - th - 3), (lx + tw + 3, ly + 4),
                 (0, 0, 0), -1)
    cv.putText(img, label, (lx, ly), FONT, 0.55, COL_ANGLE, 1, cv.LINE_AA)


def draw_info_panel(img, fps, obj_count, thresh, paused):
    """Sol üstte yarı saydam bilgi paneli."""
    h, w = img.shape[:2]
    panel_h = 110
    overlay = img.copy()
    cv.rectangle(overlay, (0, 0), (280, panel_h), COL_PANEL, -1)
    cv.addWeighted(overlay, 0.65, img, 0.35, 0, img)

    lines = [
        f"FPS      : {fps:5.1f}",
        f"Nesne    : {obj_count}",
        f"Esik     : {thresh}",
        f"[S] kaydet  [SPACE] dondur" if not paused else ">>> DONDURULDU <<<",
        f"[r] sifirla  [q] cikis",
    ]
    for i, line in enumerate(lines):
        color = (80, 80, 255) if paused and i == 3 else COL_INFO
        cv.putText(img, line, (10, 22 + i * 20), FONT, 0.52, color, 1, cv.LINE_AA)


def draw_threshold_bar(img, thresh):
    """Sağ üstte eşik kaydırma çubuğu çizer."""
    h, w = img.shape[:2]
    bar_h    = 160
    bar_x    = w - 30
    bar_top  = 20
    bar_bot  = bar_top + bar_h
    filled   = int(bar_h * thresh / 255)

    cv.rectangle(img, (bar_x, bar_top), (bar_x + 18, bar_bot), (60, 60, 60), -1)
    cv.rectangle(img, (bar_x, bar_bot - filled), (bar_x + 18, bar_bot),
                 (60, 180, 60), -1)
    cv.putText(img, str(thresh), (bar_x - 5, bar_bot + 18), FONT, 0.48,
               COL_INFO, 1, cv.LINE_AA)
    cv.putText(img, "THR", (bar_x - 2, bar_top - 6), FONT, 0.42,
               COL_INFO, 1, cv.LINE_AA)


def normalize_angle(angle):
    """
    cv2.minAreaRect açısı [-90, 0) aralığında döner.
    Bunu [0, 180) aralığına taşıyarak daha sezgisel yapalım.
    """
    if angle < -45:
        angle += 90
    return angle + 90 if angle < 0 else angle


def detect_objects(frame, thresh_val):
    """
    Gri → bulanıklaştır → eşikle → kontur bul.
    Her konturu (merkez, açı, boyut) tuple'ı olarak döndür.
    """
    gray  = cv.cvtColor(frame, cv.COLOR_BGR2GRAY)
    blur  = cv.GaussianBlur(gray, (BLUR_KERNEL, BLUR_KERNEL), 0)
    _, bw = cv.threshold(blur, thresh_val, 255, cv.THRESH_BINARY_INV)

    contours, _ = cv.findContours(bw, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    objects = []
    for c in contours:
        if cv.contourArea(c) < MIN_CONTOUR_AREA:
            continue
        rect  = cv.minAreaRect(c)          # (merkez, (w,h), açı)
        angle = normalize_angle(rect[2])
        objects.append({
            "rect"  : rect,
            "angle" : angle,
            "center": rect[0],
            "size"  : rect[1],
        })

    return objects, bw


# ── Trackbar callback (pencere oluştuktan sonra bağlanır) ─────────────────────

_thresh_val = [120]

def on_thresh(val):
    _thresh_val[0] = val


# ── Ana döngü ─────────────────────────────────────────────────────────────────

def main():
    cap = cv.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"HATA: kamera {CAMERA_INDEX} açılamadı.")
        sys.exit(1)

    # Pencere + trackbar
    cv.namedWindow(WINDOW_NAME, cv.WINDOW_NORMAL)
    cv.resizeWindow(WINDOW_NAME, 960, 640)
    cv.createTrackbar("Esik", WINDOW_NAME, _thresh_val[0], 255, on_thresh)

    paused     = False
    frame_no   = 0
    frozen     = None
    prev_time  = time.time()
    fps        = 0.0

    print(f"Kamera açıldı. [q]=çıkış  [s]=kaydet  [SPACE]=dondur  [r]=sıfırla")

    while True:
        key = cv.waitKey(1) & 0xFF

        if key in (ord('q'), 27):          # q veya ESC
            break
        if key == ord(' '):
            paused = not paused
        if key == ord('r'):
            _thresh_val[0] = 120
            cv.setTrackbarPos("Esik", WINDOW_NAME, 120)
        if key == ord('s'):
            fname = f"frame_{frame_no:04d}.png"
            cv.imwrite(fname, display)
            print(f"Kaydedildi: {fname}")

        # ── Kare al ──
        if not paused:
            ret, frame = cap.read()
            if not ret:
                print("HATA: kare okunamadı.")
                break
            frozen = frame.copy()
        else:
            frame = frozen.copy() if frozen is not None else None
            if frame is None:
                continue

        # ── FPS hesapla ──
        now       = time.time()
        fps       = 0.9 * fps + 0.1 * (1.0 / max(now - prev_time, 1e-6))
        prev_time = now

        # ── Nesne tespiti ──
        thresh = _thresh_val[0]
        objects, bw = detect_objects(frame, thresh)

        # ── Çizim ──
        display = frame.copy()

        for i, obj in enumerate(objects, 1):
            draw_rotated_box(display, obj["rect"])
            draw_angle_label(display, obj["center"], obj["angle"], i)

        draw_info_panel(display, fps, len(objects), thresh, paused)
        draw_threshold_bar(display, thresh)

        # Küçük ikincil pencere: eşiklenmiş görüntü
        bw_colored = cv.cvtColor(bw, cv.COLOR_GRAY2BGR)
        bw_small   = cv.resize(bw_colored, (display.shape[1] // 4,
                                             display.shape[0] // 4))
        h, w       = display.shape[:2]
        bh, bw2    = bw_small.shape[:2]
        display[h - bh - 10 : h - 10, w - bw2 - 10 : w - 10] = bw_small
        cv.rectangle(display,
                     (w - bw2 - 11, h - bh - 11),
                     (w - 9,        h - 9),
                     COL_BOX, 1)
        cv.putText(display, "esik", (w - bw2 - 5, h - bh - 14),
                   FONT, 0.42, COL_INFO, 1)

        cv.imshow(WINDOW_NAME, display)
        frame_no += 1

    cap.release()
    cv.destroyAllWindows()
    print("Kapandı.")


if __name__ == "__main__":
    main()
