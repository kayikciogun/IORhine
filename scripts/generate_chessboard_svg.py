#!/usr/bin/env python3
"""Generate a printable chessboard calibration target as SVG.

Usage:
    python3 scripts/generate_chessboard_svg.py --cols 10 --rows 7 --square 20 -o chessboard.svg

Open the SVG in a browser, print at 100% scale (no scaling/fit-to-page).
The printed square size MUST match the mm value entered in the UI calibration panel.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def generate_svg(cols: int, rows: int, square_mm: float, margin_mm: float = 10.0) -> str:
    board_w = cols * square_mm
    board_h = rows * square_mm
    width = board_w + 2 * margin_mm
    height = board_h + 2 * margin_mm

    inner_cols = cols - 1
    inner_rows = rows - 1

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{width}mm" height="{height}mm" viewBox="0 0 {width} {height}">
  <rect width="100%" height="100%" fill="white"/>
  <g transform="translate({margin_mm},{margin_mm})">
'''

    for r in range(rows):
        for c in range(cols):
            if (r + c) % 2 == 0:
                continue
            x = c * square_mm
            y = r * square_mm
            svg += f'    <rect x="{x}" y="{y}" width="{square_mm}" height="{square_mm}" fill="black"/>\n'

    svg += f'''  </g>
  <text x="{width/2}" y="{height - 2}" text-anchor="middle" font-size="3" fill="black" font-family="monospace">
    {cols}x{rows} squares | {square_mm}mm | inner corners: {inner_cols}x{inner_rows}
  </text>
</svg>
'''
    return svg


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate printable chessboard SVG")
    parser.add_argument("--cols", type=int, default=10, help="Square columns (default 10)")
    parser.add_argument("--rows", type=int, default=7, help="Square rows (default 7)")
    parser.add_argument("--square", type=float, default=20.0, help="Square size mm (default 20)")
    parser.add_argument("--margin", type=float, default=10.0, help="Margin mm (default 10)")
    parser.add_argument("-o", "--output", type=str, default="chessboard.svg", help="Output file")
    args = parser.parse_args()

    # P3-H46: negatif/sıfır arg validation.
    if args.cols <= 0:
        parser.error(f"--cols must be > 0, got {args.cols}")
    if args.rows <= 0:
        parser.error(f"--rows must be > 0, got {args.rows}")
    if args.square <= 0:
        parser.error(f"--square must be > 0, got {args.square}")
    if args.margin < 0:
        parser.error(f"--margin must be >= 0, got {args.margin}")

    svg = generate_svg(args.cols, args.rows, args.square, args.margin)
    out = Path(args.output)
    out.write_text(svg, encoding="utf-8")

    inner_corners_cols = args.cols - 1
    inner_corners_rows = args.rows - 1

    print(f"Saved: {out.resolve()}")
    print(f"  Board: {args.cols} x {args.rows} squares")
    print(f"  Square size: {args.square} mm")
    print(f"  OpenCV inner corners: {inner_corners_cols} x {inner_corners_rows}")
    print(f"  → Enter in UI: chessboard_cols={inner_corners_cols}, chessboard_rows={inner_corners_rows}, square_size_mm={args.square}")
    print(f"  Print at 100% scale (no fit-to-page)")


if __name__ == "__main__":
    main()
