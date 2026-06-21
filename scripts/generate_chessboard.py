#!/usr/bin/env python3
"""Generate a printable chessboard calibration target (checkerboard).

Usage:
    python scripts/generate_chessboard.py --cols 10 --rows 7 --square 20 --output chessboard.png

The printed square size MUST match the mm value entered in the UI calibration panel.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def generate_chessboard(
    cols: int,
    rows: int,
    square_mm: float,
    dpi: float = 300.0,
    margin_mm: float = 10.0,
) -> np.ndarray:
    """Render a checkerboard pattern at print resolution.

    Args:
        cols: number of black+white squares horizontally.
        rows: number of black+white squares vertically.
        square_mm: edge length of one square in millimeters.
        dpi: printer resolution (default 300).
        margin_mm: quiet zone around the board in millimeters.

    Returns:
        BGR image ready to save/print.
    """
    # 1 inch = 25.4 mm
    px_per_mm = dpi / 25.4
    square_px = int(round(square_mm * px_per_mm))
    margin_px = int(round(margin_mm * px_per_mm))

    # Inner corner count for OpenCV = (cols - 1) x (rows - 1)
    # The board itself is cols x rows squares.
    board_w = cols * square_px
    board_h = rows * square_px
    img_w = board_w + 2 * margin_px
    img_h = board_h + 2 * margin_px

    # White background
    img = np.full((img_h, img_w, 3), 255, dtype=np.uint8)

    for r in range(rows):
        for c in range(cols):
            if (r + c) % 2 == 0:
                continue  # keep white
            x1 = margin_px + c * square_px
            y1 = margin_px + r * square_px
            x2 = x1 + square_px
            y2 = y1 + square_px
            img[y1:y2, x1:x2] = 0  # black

    return img


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate printable chessboard target")
    parser.add_argument("--cols", type=int, default=10, help="Square columns (default 10)")
    parser.add_argument("--rows", type=int, default=7, help="Square rows (default 7)")
    parser.add_argument("--square", type=float, default=20.0, help="Square size mm (default 20)")
    parser.add_argument("--dpi", type=float, default=300.0, help="Print DPI (default 300)")
    parser.add_argument("--margin", type=float, default=10.0, help="Margin mm (default 10)")
    parser.add_argument("-o", "--output", type=str, default="chessboard.png", help="Output file")
    args = parser.parse_args()

    # P3-H46: negatif/sıfır arg validation — negatif ``--cols`` veya ``--square``
    # bozuk PNG üretir (np.full negatif boyut → ValueError). Erken açık hata ver.
    if args.cols <= 0:
        parser.error(f"--cols must be > 0, got {args.cols}")
    if args.rows <= 0:
        parser.error(f"--rows must be > 0, got {args.rows}")
    if args.square <== 0:
        parser.error(f"--square must be > 0, got {args.square}")
    if args.dpi <= 0:
        parser.error(f"--dpi must be > 0, got {args.dpi}")
    if args.margin < 0:
        parser.error(f"--margin must be >= 0, got {args.margin}")

    img = generate_chessboard(args.cols, args.rows, args.square, args.dpi, args.margin)
    out = Path(args.output)
    cv2.imwrite(str(out), img)

    inner_corners_cols = args.cols - 1
    inner_corners_rows = args.rows - 1

    print(f"Saved: {out.resolve()}")
    print(f"  Board: {args.cols} x {args.rows} squares")
    print(f"  Square size: {args.square} mm")
    print(f"  OpenCV inner corners: {inner_corners_cols} x {inner_corners_rows}")
    print(f"  → Enter in UI: chessboard_cols={inner_corners_cols}, chessboard_rows={inner_corners_rows}, square_size_mm={args.square}")
    print(f"  Print at {args.dpi} DPI for correct physical size")


if __name__ == "__main__":
    main()
