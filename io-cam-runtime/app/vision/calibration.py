from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np


class HomographyCalibrationError(Exception):
    pass


def homography_path(cal_dir: Path) -> Path:
    return cal_dir / "homography.npy"


def fabric_offset_path(cal_dir: Path) -> Path:
    return cal_dir / "fabric_offset.json"


def load_homography(cal_dir: Path) -> np.ndarray | None:
    p = homography_path(cal_dir)
    if not p.is_file():
        return None
    return np.load(p)


def save_homography(cal_dir: Path, matrix: np.ndarray) -> None:
    cal_dir.mkdir(parents=True, exist_ok=True)
    np.save(homography_path(cal_dir), matrix)


def load_fabric_offset(cal_dir: Path) -> tuple[float, float]:
    p = fabric_offset_path(cal_dir)
    if not p.is_file():
        return 0.0, 0.0
    data = json.loads(p.read_text(encoding="utf-8"))
    return float(data.get("dx", 0)), float(data.get("dy", 0))


def save_fabric_offset(cal_dir: Path, dx: float, dy: float) -> None:
    cal_dir.mkdir(parents=True, exist_ok=True)
    fabric_offset_path(cal_dir).write_text(
        json.dumps({"dx": dx, "dy": dy}, indent=2),
        encoding="utf-8",
    )


def pixel_to_robot(u: float, v: float, H: np.ndarray) -> tuple[float, float]:
    pt = np.array([[[u, v]]], dtype=np.float32)
    mapped = cv2.perspectiveTransform(pt, H)[0]
    return float(mapped[0][0]), float(mapped[0][1])


def calibrate_homography_from_frame(
    frame: np.ndarray,
    chessboard_cols: int,
    chessboard_rows: int,
    square_size_mm: float,
) -> tuple[np.ndarray, float]:
    """
    Detect chessboard inner corners and compute pixel→robot (mm) homography.

    chessboard_cols / chessboard_rows: inner corner counts (OpenCV patternSize).
    Returns (H, mean_reprojection_error_mm).
    """
    if frame.ndim == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    else:
        gray = frame

    pattern_size = (chessboard_cols, chessboard_rows)
    flags = cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE
    found, corners = cv2.findChessboardCorners(gray, pattern_size, flags)
    if not found or corners is None:
        raise HomographyCalibrationError(
            f"Chessboard {chessboard_cols}x{chessboard_rows} not found in frame"
        )

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    corners = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)

    objp = np.zeros((chessboard_rows * chessboard_cols, 3), np.float32)
    grid = np.mgrid[0:chessboard_cols, 0:chessboard_rows].T.reshape(-1, 2)
    objp[:, :2] = grid * square_size_mm

    H, mask = cv2.findHomography(corners.reshape(-1, 2), objp[:, :2], cv2.RANSAC, 5.0)
    if H is None:
        raise HomographyCalibrationError("findHomography failed")

    projected = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), H)
    errors = np.linalg.norm(projected.reshape(-1, 2) - objp[:, :2], axis=1)
    mean_err = float(np.mean(errors))
    return H, mean_err
