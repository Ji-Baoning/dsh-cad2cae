"""装配源码发射 + 子进程装配编译测试（revolute 轴套-立柱）。"""
import json
import os
import pytest
from cad_codegen.assembly_gen import emit_assembly_source
from cad_codegen.compiler import compile_sources
from cad_codegen.part_gen import JointSpec, generate_part_source

PARTS = [
    {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
    {'id': 'ps1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'rectangle', 'width': 0.06, 'height': 0.06}]},
    {'id': 'pn1', 'type': 'extrude', 'sketch': 'ps1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.02},
]
ASSEMBLY = {
    'components': [
        {'id': 'c1', 'part_ref': 'hn1'},
        {'id': 'c2', 'part_ref': 'pn1'},
    ],
    'connections': [
        {'id': 'J1', 'type': 'kinematic', 'joint': 'revolute',
         'contact': [
             {'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0.03, 0, 0]}},
             {'part': 'c2', 'anchor': {'kind': 'plane', 'near': [0, 0, 0.02]}},
         ],
         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}},
    ],
}


def test_emit_assembly_source_imports_and_connects():
    src = emit_assembly_source(ASSEMBLY, ASSEMBLY['components'])
    assert "parts['c1'] = import_module('hn1').build()" in src
    assert "parts['c2'] = import_module('pn1').build()" in src
    assert "parts['c1'].joints['J1'].connect_to(parts['c2'].joints['J1'])" in src
    assert "assembly = Compound(children=list(parts.values()))" in src


def test_compile_revolute_assembly_end_to_end(tmp_path):
    # 零件关节束（与 orchestrator 将产出一致，label = 连接 id J1）：
    joints = {
        'hn1': [JointSpec(label='J1', cls='RevoluteJoint',
                          axis=((0.0, 0.0, 0.0), (0.0, 0.0, -1.0)))],
        'pn1': [JointSpec(label='J1', cls='RigidJoint',
                          location=((0.0, 0.0, 0.02), (0.0, 0.0, 0.0)))],
    }
    sources = {}
    for pref in ('hn1', 'pn1'):
        nodes = [n for n in PARTS if n['id'] in ('hs1', 'hn1')] if pref == 'hn1' \
            else [n for n in PARTS if n['id'] in ('ps1', 'pn1')]
        sources[pref] = generate_part_source(pref, nodes, joints[pref])
    sources['assembly'] = emit_assembly_source(ASSEMBLY, ASSEMBLY['components'])
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
    for name in ('hn1', 'pn1', 'assembly'):
        assert name in res.artifacts
    with open(res.artifacts['assembly'], 'r', encoding='utf-8') as f:
        assert f.read(13) == 'ISO-10303-21;'


def test_compile_assembly_writes_placements(tmp_path):
    # placements.json：装配定位矩阵，被移动侧非恒等；两 entry 各 16 个数。
    joints = {
        'hn1': [JointSpec(label='J1', cls='RevoluteJoint',
                          axis=((0.0, 0.0, 0.0), (0.0, 0.0, -1.0)))],
        'pn1': [JointSpec(label='J1', cls='RigidJoint',
                          location=((0.0, 0.0, 0.02), (0.0, 0.0, 0.0)))],
    }
    sources = {}
    for pref in ('hn1', 'pn1'):
        nodes = [n for n in PARTS if n['id'] in ('hs1', 'hn1')] if pref == 'hn1' \
            else [n for n in PARTS if n['id'] in ('ps1', 'pn1')]
        sources[pref] = generate_part_source(pref, nodes, joints[pref])
    sources['assembly'] = emit_assembly_source(ASSEMBLY, ASSEMBLY['components'])
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
    pl = json.loads((tmp_path / 'placements.json').read_text(encoding='utf-8'))
    assert set(pl) == {'c1', 'c2'}
    identity = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]
    for v in pl.values():
        assert len(v) == 16
    # connect_to 会把被移动零件重新定位 → 至少一个非恒等
    assert any(v != identity for v in pl.values())
