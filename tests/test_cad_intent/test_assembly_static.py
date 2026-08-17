"""assembly 图：component 与静连接校验测试"""
from cad_intent import validate_intent


def _intent(assembly):
    return {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
        'assembly': assembly,
    }


def test_component_must_reference_part():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'ghost'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert any('part_ref' in e and 'ghost' in e for e in errs)


def test_component_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert not any('part_ref' in e for e in errs)


def test_connection_requires_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'method': 'weld'}],
    })
    errs = validate_intent(intent)
    assert any('type' in e and 'static|kinematic' in e for e in errs)


def test_bad_connection_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'magic'}],
    })
    errs = validate_intent(intent)
    assert any("type" in e and "static|kinematic" in e for e in errs)


def test_static_requires_method():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static'}],
    })
    errs = validate_intent(intent)
    assert any('method' in e for e in errs)


def test_static_bad_method():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static', 'method': 'glue_gun'}],
    })
    errs = validate_intent(intent)
    assert any('method' in e and 'glue_gun' in e for e in errs)


def test_static_requires_contact_and_position_and_fasteners():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static', 'method': 'weld'}],
    })
    errs = validate_intent(intent)
    assert any('contact' in e for e in errs)
    assert any('position' in e for e in errs)


def test_static_bolt_requires_fastener_holes():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'bolt_fastening',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('fasteners' in e and 'holes' in e for e in errs)


def test_static_contact_anchor_kind():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'blob', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('anchor' in e and 'blob' in e for e in errs)


def test_static_weld_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_contact_part_must_reference_component():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'ghost_comp', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('part' in e and 'ghost_comp' in e for e in errs)
