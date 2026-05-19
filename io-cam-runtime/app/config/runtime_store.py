from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from app.config.settings import settings


@dataclass
class VisionConfig:
    blur_kernel: int = 9
    fast_detect_threshold: int = 120  # web_angle varsayılan; 0 = Otsu
    min_contour_area: int = 600
    max_contour_area: int = 80000
    show_mask: bool = False
    match_threshold: float = 0.15


def _vision_path(cal_dir: Path) -> Path:
    return cal_dir / "vision.json"


def load_vision_config(cal_dir: Path | None = None) -> VisionConfig:
    cal = cal_dir or settings.calibration_dir
    p = _vision_path(cal)
    if not p.is_file():
        return VisionConfig(
            blur_kernel=settings.blur_kernel,
            fast_detect_threshold=settings.fast_detect_threshold,
            min_contour_area=settings.min_contour_area,
            max_contour_area=getattr(settings, "max_contour_area", 80000),
            show_mask=getattr(settings, "show_mask", False),
            match_threshold=settings.match_threshold,
        )
    data = json.loads(p.read_text(encoding="utf-8"))
    return VisionConfig(
        blur_kernel=int(data.get("blur_kernel", 9)),
        fast_detect_threshold=int(data.get("fast_detect_threshold", 120)),
        min_contour_area=int(data.get("min_contour_area", 600)),
        max_contour_area=int(data.get("max_contour_area", 80000)),
        show_mask=bool(data.get("show_mask", False)),
        match_threshold=float(data.get("match_threshold", 0.15)),
    )


def save_vision_config(cfg: VisionConfig, cal_dir: Path | None = None) -> None:
    cal = cal_dir or settings.calibration_dir
    cal.mkdir(parents=True, exist_ok=True)
    _vision_path(cal).write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")
    apply_vision_to_settings(cfg)


def apply_vision_to_settings(cfg: VisionConfig) -> None:
    settings.blur_kernel = cfg.blur_kernel
    settings.fast_detect_threshold = cfg.fast_detect_threshold
    settings.min_contour_area = cfg.min_contour_area
    settings.max_contour_area = cfg.max_contour_area
    settings.show_mask = cfg.show_mask
    settings.match_threshold = cfg.match_threshold


# Module-level cache (reloaded on save / startup)
_vision: VisionConfig | None = None


def get_vision() -> VisionConfig:
    global _vision
    if _vision is None:
        _vision = load_vision_config()
        apply_vision_to_settings(_vision)
    return _vision


def set_vision(cfg: VisionConfig) -> None:
    global _vision
    _vision = cfg
    save_vision_config(cfg)
    apply_vision_to_settings(cfg)


def init_runtime_store() -> None:
    """Load persisted configs at app startup."""
    get_vision()
