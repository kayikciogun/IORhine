from app.runtime.csv_loader import (
    parse_placement_csv,
    resolve_template_shape_id,
)

CSV = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,ABC
1,11,21,45,ABC
"""

MULTI = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,432_seg_0
1,11,21,45,432_seg_4
"""

CSV_WITH_THICKNESS = """id,target_x,target_y,target_angle,shape_id,thickness
0,10,20,0,ABC,2.5
1,11,21,45,ABC,0.0
2,12,22,90,ABC,1.75
"""

CSV_PARTIAL_THICKNESS = """id,target_x,target_y,target_angle,shape_id,thickness
0,10,20,0,ABC,2.5
1,11,21,45,ABC,
"""

CSV_NO_THICKNESS_COLUMN = """id,target_x,target_y,target_angle,shape_id
0,10,20,0,ABC
1,11,21,45,ABC
"""


def test_parse_and_validate():
    rows = parse_placement_csv(CSV)
    assert len(rows) == 2
    # P3-D29: validate_single_shape kaldırıldı — resolve_template_shape_id kullan
    assert resolve_template_shape_id(rows, strict=True) == "ABC"


def test_resolve_template_multi_shape():
    rows = parse_placement_csv(MULTI)
    assert resolve_template_shape_id(rows) == "432_seg_0"


def test_parse_with_thickness():
    """thickness kolonu başarıyla okunmalı."""
    rows = parse_placement_csv(CSV_WITH_THICKNESS)
    assert len(rows) == 3
    assert rows[0].thickness == 2.5
    assert rows[1].thickness == 0.0
    assert rows[2].thickness == 1.75


def test_parse_with_missing_thickness_value():
    """thickness kolonu var ama hücre boş → 0.0."""
    rows = parse_placement_csv(CSV_PARTIAL_THICKNESS)
    assert len(rows) == 2
    assert rows[0].thickness == 2.5
    assert rows[1].thickness == 0.0


def test_parse_without_thickness_column():
    """Eski 5-sütun CSV'ler (thickness kolonu yok) → 0.0 default."""
    rows = parse_placement_csv(CSV_NO_THICKNESS_COLUMN)
    assert len(rows) == 2
    assert rows[0].thickness == 0.0
    assert rows[1].thickness == 0.0
