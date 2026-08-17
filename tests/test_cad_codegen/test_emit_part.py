"""零件源码发射测试：发射串与已验证的执行模板逐字一致。"""
from cad_codegen.part_gen import (
    JointSpec, build_part, emit_part_source, generate_part_source,
)

# 轴套零件（单零件意图）
HUB_NODES = [
    {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
]


def test_emit_hub_source_roundtrips_build():
    src = generate_part_source('hub', HUB_NODES, [])
    assert 'def build():' in src
    assert 'Circle(0.03)' in src            # diameter/2 → 半径
    assert 'extrude(amount=0.08)' in src
    assert "export_step(build(), 'hub.step', unit=Unit.M)" in src
    # 发射串必须能 in-process 再执行（与子进程编译一致）
    ns = {'export_step': lambda s, p, unit: None}
    exec(compile(src.replace('if __name__', 'if 0 and __name__'), '<gen>', 'exec'), ns)
    part = ns['build']()
    import build123d as bd
    assert len([f for f in part.faces() if f.geom_type == bd.GeomType.CYLINDER]) == 1


def test_emit_joint_revolute_and_rigid():
    joints = [
        JointSpec(label='c1', cls='RevoluteJoint',
                  axis=((0.0, 0.0, 0.0), (0.0, 0.0, -1.0))),
        JointSpec(label='c2', cls='RigidJoint',
                  location=((0.0, 0.0, 0.08), (0.0, 0.0, 0.0))),
    ]
    src = emit_part_source('hub', HUB_NODES, joints)
    assert "RevoluteJoint('c1', part_b.part, axis=Axis((0.0, 0.0, 0.0), (0.0, 0.0, -1.0)))" in src
    assert "RigidJoint('c2', part_b.part, Location((0.0, 0.0, 0.08), (0.0, 0.0, 0.0)))" in src


def test_emit_through_all_uses_precomputed_amount():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'b1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 's2', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.03}]},
        {'id': 'c1', 'type': 'extrude', 'sketch': 's2', 'operation': 'cut',
         'end': 'through_all'},
    ]
    src = generate_part_source('bracket', nodes, [])
    assert 'extrude(amount=0.03, mode=Mode.SUBTRACT)' in src


def test_emit_pattern_absorbed_into_sketch_locations():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'b1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 's2', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.03}]},
        {'id': 'c1', 'type': 'extrude', 'sketch': 's2', 'operation': 'cut',
         'end': 'through_all'},
        {'id': 'p1', 'type': 'linear_pattern', 'feature': 'c1',
         'direction': 'x', 'spacing': 0.05, 'count': 2},
    ]
    src = emit_part_source('bracket', nodes, [], amounts={'c1': 0.03})
    # 关键：GridLocations 必须位于 BuildSketch 内部（0.11.1 唯一生效写法）
    assert ('with BuildSketch(Location((0, 0, 0.0))):\n'
            '            with GridLocations(0.05, 1, 2, 1):\n'
            '                Circle(0.015)') in src
    # 被阵列的 sketch/extrude 不再独立发射
    assert src.count('Circle(0.015)') == 1
    # 阵列后的 extrude 回到 part 级缩进
    assert '\n        extrude(amount=0.03, mode=Mode.SUBTRACT)\n' in src


def test_emit_line_profile_becomes_polygon():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [
             {'kind': 'line', 'x1': 0, 'y1': 0, 'x2': 0.1, 'y2': 0},
             {'kind': 'line', 'x1': 0.1, 'y1': 0, 'x2': 0.1, 'y2': 0.05},
             {'kind': 'line', 'x1': 0.1, 'y1': 0.05, 'x2': 0, 'y2': 0.05},
             {'kind': 'line', 'x1': 0, 'y1': 0.05, 'x2': 0, 'y2': 0},
         ]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.01},
    ]
    src = emit_part_source('plate', nodes, [])
    assert 'Polygon((0.0, 0.0), (0.1, 0.0), (0.1, 0.05), (0.0, 0.05))' in src
    assert 'Line(' not in src


def test_emit_mirror_about_plane():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 'm1', 'type': 'mirror', 'plane': {'datum': 'front'},
         'features': ['n1']},
    ]
    src = emit_part_source('sym', nodes, [])
    assert 'mirror(about=Plane((0, 0, 0), (1, 0, 0), (0, 0, 1)))' in src
