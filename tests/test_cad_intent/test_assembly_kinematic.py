"""assembly 图：动连接校验与四层装配校验测试"""
from cad_intent import validate_intent


def _intent(assembly, parts=None, ground='hub'):
    parts = parts or [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}]
    return {'schema_version': 2, 'units': 'meters', 'ground': ground, 'parts': parts, 'assembly': assembly}


def _cylin_conn(part_a, part_b):
    return {'type': 'kinematic', 'joint': 'cylindrical',
            'contact': [
                {'part': part_a, 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                {'part': part_b, 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0.02]}},
            ],
            'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}


def test_bad_joint_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'turbo_gear'}],
    })
    errs = validate_intent(intent)
    assert any('joint' in e and 'turbo_gear' in e for e in errs)


def test_kinematic_requires_joint():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic'}],
    })
    errs = validate_intent(intent)
    assert any('joint' in e and '运动副' in e for e in errs)


def test_kinematic_requires_direction():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute'}],
    })
    errs = validate_intent(intent)
    assert any('direction' in e for e in errs)


def test_revolute_contact_kind_mismatch():
    # 转动副要求圆柱接触，但给了平面
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}}],
    })
    errs = validate_intent(intent)
    assert any('接触面' in e and 'cylinder' in e for e in errs)


def test_cylindrical_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [_cylin_conn('c1', 'c2')],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_revolute_wrong_direction_flags():
    # 转动副只允许旋转，不允许平动标记（机械原理：约束形式决定运动方向）
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}],
    })
    errs = validate_intent(intent)
    assert any('rotation' in e and 'translation' in e for e in errs)


def test_dof_translation_flag_matches_helical():
    # 螺旋副剩余 1 DOF（旋转+平移联动），direction 需标记
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'helical',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                                     {'part': 'c2', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_ground_unreachable_component():
    # 两个 component 无连接，一个不可达
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert any('可达' in e and 'c2' in e for e in errs)


def test_connection_cycle_detected():
    # 连接图有环（3 个 component 成环），无环性检测
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}, {'id': 'c3', 'part_ref': 'hub'}],
        'connections': [_cylin_conn('c1', 'c2'), _cylin_conn('c2', 'c3'), _cylin_conn('c3', 'c1')],
    })
    errs = validate_intent(intent)
    assert any('环' in e for e in errs)


def test_ground_with_no_connections_ok_for_single():
    # 单零件无装配连接：可达性不报错（ground 自身可达）
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert not any('可达' in e for e in errs)


def test_assembly_none_is_part_only():
    # assembly 为 None 表示纯 part 图
    intent = {'schema_version': 2, 'units': 'meters', 'ground': 'hub',
              'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
              'assembly': None}
    errs = validate_intent(intent)
    assert errs == []
