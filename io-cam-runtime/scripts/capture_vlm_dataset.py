#!/usr/bin/env python3
"""VLM dataset seri çekim — orijinal kamera çözünürlüğü JPEG.

Kullanım (runtime venv içinde, kamera bağlı):

  cd io-cam-runtime
  source .venv/bin/activate
  python scripts/capture_vlm_dataset.py --count 200 --out ./datasets/stones_vlm512

İsteğe bağlı küçültme:
  python scripts/capture_vlm_dataset.py --count 200 --max-dim 512 --out ./datasets/stones_vlm512

Ortam:
  IO_CAM_* ayarları (settings) — kayıtlı kamera ``calibration/camera_source.json``
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Proje kökü import için
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.vision.dataset_capture import capture_vlm_dataset  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(
        description="Taş fotoğrafları — varsayılan orijinal çözünürlükte seri kayıt",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("datasets") / "vlm_512",
        help="Çıktı klasörü (varsayılan: datasets/vlm_512)",
    )
    p.add_argument("--count", type=int, default=200, help="Kayıt sayısı (varsayılan 200)")
    p.add_argument(
        "--interval",
        type=float,
        default=0.25,
        help="Kareler arası saniye (varsayılan 0.25)",
    )
    p.add_argument(
        "--max-dim",
        type=int,
        default=None,
        help="Verilirse uzun kenarı bu px'e küçült (varsayılan: yok, olduğu gibi)",
    )
    p.add_argument("--prefix", type=str, default="new1", help="Dosya öneki")
    p.add_argument("--jpeg-quality", type=int, default=95)
    p.add_argument("--wait-frame", type=float, default=8.0, help="İlk kare bekleme (sn)")
    args = p.parse_args()

    if os.getenv("IO_CAM_MOCK_HARDWARE", "").lower() in ("1", "true", "yes"):
        print("Hata: IO_CAM_MOCK_HARDWARE=1 — gerçek kamera gerekli.", file=sys.stderr)
        return 1

    print(f"Çekim başlıyor: {args.count} kare → {args.out.resolve()}")
    max_dim_txt = args.max_dim if args.max_dim is not None else "yok (orijinal)"
    print(f"  max_dim={max_dim_txt}  interval={args.interval}s  prefix={args.prefix}")
    print("  dosya adı: {prefix}_{YYYYMMDD_HHMMSS}_{index}.jpg")

    try:
        result = capture_vlm_dataset(
            args.out,
            count=args.count,
            interval_s=args.interval,
            max_dim=args.max_dim,
            prefix=args.prefix,
            jpeg_quality=args.jpeg_quality,
            wait_first_frame_s=args.wait_frame,
        )
    except Exception as e:
        print(f"Hata: {e}", file=sys.stderr)
        return 1

    print(f"Tamam: {result.saved}/{result.requested} kaydedildi")
    print(f"Manifest: {result.manifest_path}")
    if result.errors:
        print(f"Uyarı: {len(result.errors)} kare başarısız (manifest.errors)")
        for err in result.errors[:5]:
            print(f"  - {err}")
        if len(result.errors) > 5:
            print(f"  ... +{len(result.errors) - 5} daha")
    return 0 if result.saved == result.requested else 2


if __name__ == "__main__":
    raise SystemExit(main())
