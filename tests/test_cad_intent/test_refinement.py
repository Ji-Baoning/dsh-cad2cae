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


def test_refinement_parts_scalar_does_not_crash():
    # parts 为非迭代标量：不得崩溃，零件集合检查静默跳过
    prev = {'schema_version': 2, 'units': 'meters', 'parts': 5}
    nxt = {'schema_version': 2, 'units': 'meters', 'parts': []}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert isinstance(errs, list)


def test_refinement_assembly_scalar_does_not_crash():
    # assembly 为真值非 dict：不得崩溃，静默视为无连接
    prev = {'schema_version': 2, 'units': 'meters', 'assembly': 'foo'}
    nxt = {'schema_version': 2, 'units': 'meters'}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert isinstance(errs, list)


def _conn(joint, part_a='c1', part_b='c2', kind='cylinder'):
    return {'type': 'kinematic', 'joint': joint,
            'contact': [{'part': part_a, 'anchor': {'kind': kind, 'near': [0, 0, 0]}},
                        {'part': part_b, 'anchor': {'kind': kind, 'near': [0, 0, 0]}}],
            'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}


def _ref_intent(connections, components):
    return {'schema_version': 2, 'units': 'meters', 'ground': 'hub',
            'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
            'assembly': {'components': components, 'connections': connections}}


def test_connection_deletion_frozen():
    # 删除既有连接 = 修改冻结拓扑，必须报冻结错误
    comps = [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}]
    prev = _ref_intent([_conn('revolute')], comps)
    nxt = _ref_intent([], comps)
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('冻结' in e and '连接' in e for e in errs)


def test_connection_reorder_no_spurious_error():
    # 同一零件对上的两个不同 joint 连接整体重排：按稳定 key 比对，不得误报已冻结
    comps = [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}]
    rev = _conn('revolute')
    pri = _conn('prismatic', kind='plane')
    prev = _ref_intent([rev, pri], comps)
    nxt = _ref_intent([pri, rev], comps)
    errs = []
    validate_refinement(prev, nxt, errs)
    assert not any('已冻结' in e for e in errs)


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
