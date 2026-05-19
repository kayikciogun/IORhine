from app.runtime.csv_loader import (
    parse_placement_csv,
    resolve_template_shape_id,
    validate_single_shape,
)

CSV = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,ABC
1,11,21,45,ABC
"""

MULTI = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,432_seg_0
1,11,21,45,432_seg_4
"""


def test_parse_and_validate():
    rows = parse_placement_csv(CSV)
    assert len(rows) == 2
    assert validate_single_shape(rows) == "ABC"


def test_resolve_template_multi_shape():
    rows = parse_placement_csv(MULTI)
    assert resolve_template_shape_id(rows) == "432_seg_0"
