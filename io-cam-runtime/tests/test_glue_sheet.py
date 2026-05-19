import tempfile
from pathlib import Path

from app.glue_sheet.controller import GlueSheet, GlueSheetExhausted


def test_next_cell_and_reset():
    with tempfile.TemporaryDirectory() as td:
        state = Path(td) / "glue_sheet_state.json"
        gs = GlueSheet(2, 2, (0, 0), 20.0, 0.5, state_path=state)
        x, y, z = gs.next_cell()
        assert (x, y) == (10.0, 10.0)  # cell center (20mm cell, origin 0,0)
        assert z == 0.5
        assert gs.remaining() == 3

        x2, y2, z2 = gs.next_cell()
        assert (x2, y2) == (30.0, 10.0)
        gs.reset()
        assert gs.remaining() == 4


def test_exhausted():
    gs = GlueSheet(1, 1, (0, 0), 20.0, 0.5)
    gs.next_cell()
    try:
        gs.next_cell()
        assert False
    except GlueSheetExhausted:
        pass
