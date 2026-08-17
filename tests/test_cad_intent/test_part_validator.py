"""part 图节点校验测试"""
from cad_intent import validate_intent


def _intent(parts):
    return {'schema_version': 2, 'units': 'meters', 'parts': parts, 'assembly': None}


def test_empty_sketch_profile():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': []}])
    errs = validate_intent(intent)
    assert any('profile' in e and '非空数组' in e for e in errs)


def test_bad_profile_kind():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'triangle'}]}])
    errs = validate_intent(intent)
    assert any('kind' in e and 'triangle' in e for e in errs)


def test_rectangle_missing_dimensions():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.1}]}])
    errs = validate_intent(intent)
    assert any('.height' in e for e in errs)


def test_circle_missing_diameter():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'cx': 0, 'cy': 0}]}])
    errs = validate_intent(intent)
    assert any('.diameter' in e for e in errs)


def test_extrude_must_follow_sketch():
    # extrude 的 sketch 引用必须在紧邻前一位
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert not any('immediately' in e or '紧' in e for e in errs)


def test_extrude_not_immediate():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 's2', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert any('紧' in e and 's1' in e for e in errs)


def test_extrude_bad_operation():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'twist', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert any("'operation' 必须为 'boss' 或 'cut'" in e for e in errs)


def test_extrude_blind_requires_depth():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind'},
    ])
    errs = validate_intent(intent)
    assert any('.depth' in e for e in errs)


def test_pattern_must_reference_feature():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
        {'id': 'p1', 'type': 'linear_pattern', 'feature': 'ghost', 'direction': 'x', 'spacing': 0.02, 'count': 3},
    ])
    errs = validate_intent(intent)
    assert any("'feature'" in e and '更早' in e for e in errs)


def test_fillet_requires_edges():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
        {'id': 'f1', 'type': 'fillet', 'radius': 0.01},
    ])
    errs = validate_intent(intent)
    assert any('edges' in e and '非空数组' in e for e in errs)


def test_duplicate_id():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
    ])
    errs = validate_intent(intent)
    assert any('重复' in e and 's1' in e for e in errs)


def test_sketch_without_ref_defaults_front():
    # 无 ref → 默认 front 基准面，合法（否则 test_assembly_none 会误报）
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}])
    errs = validate_intent(intent)
    assert errs == []
