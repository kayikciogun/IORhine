import ezdxf
import numpy as np

from app.vision.template_loader import (
    build_template_from_dxf_bytes,
    extract_contour_from_dxf_bytes,
)


def _minimal_lwpolyline_dxf() -> tuple[bytes, str]:
    doc = ezdxf.new()
    msp = doc.modelspace()
    entity = msp.add_lwpolyline([(0, 0), (10, 0), (10, 5), (0, 5)], close=True)
    handle = entity.dxf.handle
    from io import StringIO

    buf = StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8"), handle


def test_extract_contour_lwpolyline():
    dxf, handle = _minimal_lwpolyline_dxf()
    contour = extract_contour_from_dxf_bytes(handle, dxf)
    assert contour is not None
    assert contour.shape[0] >= 3


def test_build_template_from_dxf():
    dxf, handle = _minimal_lwpolyline_dxf()
    tpl = build_template_from_dxf_bytes(handle, dxf)
    assert tpl is not None
    assert tpl.shape_id == handle
    assert tpl.contour.dtype == np.float32
