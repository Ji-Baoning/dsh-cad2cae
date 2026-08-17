"""schema.py 常量表测试"""
from cad_intent import schema


def test_part_vocabulary():
    assert 'sketch' in schema.NODE_TYPES
    assert 'extrude' in schema.NODE_TYPES
    assert 'fillet' in schema.NODE_TYPES
    assert 'revolve' not in schema.NODE_TYPES  # 受限子集排除
    assert 'sweep' not in schema.NODE_TYPES
    assert 'loft' not in schema.NODE_TYPES


def test_assembly_vocabulary():
    assert schema.ASSEMBLY_TYPES == frozenset({'component', 'connection'})


def test_joint_table_covers_six_joints():
    assert schema.JOINT_TYPES == frozenset(
        {'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical', 'helical'}
    )


def test_joint_dof_expected():
    assert schema.JOINT_DOF == {
        'revolute': 1, 'prismatic': 1, 'cylindrical': 2,
        'planar': 3, 'spherical': 3, 'helical': 1,
    }


def test_joint_contact_kinds():
    # 转动副要求圆柱接触；平面副要求平面接触
    assert schema.JOINT_CONTACT_KINDS['revolute'] == frozenset({'cylinder'})
    assert schema.JOINT_CONTACT_KINDS['planar'] == frozenset({'plane'})
    assert schema.JOINT_CONTACT_KINDS['prismatic'] == frozenset({'plane'})


def test_joint_direction_flags():
    # 机械原理：约束形式决定运动方向
    assert schema.JOINT_DIRECTION_FLAGS['revolute'] == (True, False)    # 只转不平动
    assert schema.JOINT_DIRECTION_FLAGS['prismatic'] == (False, True)   # 只平动不转
    assert schema.JOINT_DIRECTION_FLAGS['cylindrical'] == (True, True)  # 转动+平动
    assert schema.JOINT_DIRECTION_FLAGS['spherical'] == (True, False)   # 绕球心转


def test_static_methods():
    assert schema.STATIC_METHODS == frozenset({'weld', 'bond', 'bolt_fastening', 'rivet'})


def test_anchor_kinds():
    assert schema.ANCHOR_KINDS == frozenset({'plane', 'cylinder', 'cone', 'sphere', 'line', 'circle'})
