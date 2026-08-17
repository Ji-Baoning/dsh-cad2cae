"""profile.py 常量表测试（保证发射模板与执行模式单一来源）。"""
from cad_codegen import profile


def test_fmt_cleans_floats():
    assert profile._fmt(0.05) == '0.05'
    assert profile._fmt(0.1) == '0.1'
    assert profile._fmt(1e-13) == '0.0'
    assert profile._fmt(-0.0) == '0.0'
    assert profile._fmt(0.1234567891) == '0.123456789'


def test_datum_locations_templates():
    assert '{off}' in profile.DATUM_LOCATIONS['front']
    assert profile.DATUM_LOCATIONS['top'] == 'Location((0, {off}, 0), (0, 90, 0))'
    assert profile.DATUM_LOCATIONS['right'] == 'Location(({off}, 0, 0), (0, 0, 90))'


def test_mirror_planes_cover_three_datums():
    assert profile.MIRROR_PLANES['front'] == 'Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))'
    assert set(profile.MIRROR_PLANES) == {'front', 'top', 'right'}
    assert set(profile.MIRROR_PLANE_TUP) == {'front', 'top', 'right'}


def test_joint_class_tables():
    assert profile.JOINT_CLASSES['revolute'] == 'RevoluteJoint'
    assert profile.JOINT_CLASSES['planar'] is None      # v1 不支持
    assert profile.JOINT_CLASSES['helical'] is None
    assert profile.JOINT_ANCHOR_CLASS['revolute'] == {'cylinder': 'RevoluteJoint'}
    assert profile.JOINT_ANCHOR_CLASS['prismatic'] == {'plane': 'LinearJoint'}
    # 未匹配锚点 kind 的侧退化为 RigidJoint（.get(kind, 'RigidJoint')）
    assert profile.JOINT_ANCHOR_CLASS['revolute'].get('plane', 'RigidJoint') == 'RigidJoint'
