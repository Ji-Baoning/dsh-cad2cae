"""Top-down 三层细化：frozen 约束一致性测试"""
from cad_intent.validate import validate_intent
from cad_intent.refinement import validate_refinement


def _base_intent():
    return {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
                  {'id': 'x1', 'type': 'extrude', 'sketch': 'hub', 'operation': 'boss', 'end': 'blind', 'depth': 0.05}],
        'assembly': None,
    }


def test_units_frozen():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['units'] = 'mm'
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('units' in e and '冻结' in e for e in errs)


def test_ground_frozen():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['ground'] = 'other'
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('ground' in e and '冻结' in e for e in errs)


def test_material_frozen():
    prev = _base_intent()
    prev['material'] = {'name': '6061', 'library': 'default'}
    nxt = dict(_base_intent())
    nxt['material'] = {'name': 'ABS', 'library': 'default'}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('material' in e and '冻结' in e for e in errs)


def test_add_part_allowed():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['parts'] = prev['parts'] + [{'id': 'cap', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.12}]}]
    errs = []
    validate_refinement(prev, nxt, errs)
    assert not any('已冻结' in e and '删除' in e for e in errs)


def test_remove_part_blocked():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['parts'] = [prev['parts'][0]]  # 删掉了 x1
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('已冻结' in e and 'x1' in e for e in errs)


def test_connection_joint_frozen():
    conn = {'type': 'kinematic', 'joint': 'revolute',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                        {'part': 'c2', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
            'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}}
    prev = {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
        'assembly': {'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
                     'connections': [conn]},
    }
    nxt = {'schema_version': 2, 'units': 'meters', 'ground': 'hub',
           'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
           'assembly': {'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
                        'connections': [dict(conn, joint='prismatic')]}}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('joint' in e and '冻结' in e for e in errs)


def test_full_intent_still_validates():
    intent = _base_intent()
    assert validate_intent(intent) == []
