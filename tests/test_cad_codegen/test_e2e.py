# tests/test_cad_codegen/test_e2e.py
"""端到端：意图 JSON → 交付物①②。"""
import os
import pytest
from cad_codegen import compile_sources, generate_sources

# hub(轴套) + post(立柱)，double-cylinder revolute 装配
# （Plan A 校验器：revolute 仅接受 cylinder 锚点，故两接触面均为圆柱）
INTENT_ASM = {
    'schema_version': 2,
    'units': 'meters',
    'ground': 'hn1',
    'parts': [
        {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.06}]},
        {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.08},
        {'id': 'ps1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.04}]},
        {'id': 'pn1', 'type': 'extrude', 'sketch': 'ps1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
    ],
    'assembly': {
        'components': [
            {'id': 'c1', 'part_ref': 'hn1'},
            {'id': 'c2', 'part_ref': 'pn1'},
        ],
        'connections': [
            {'id': 'J1', 'type': 'kinematic', 'joint': 'revolute',
             'contact': [
                 {'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0.03, 0, 0]}},
                 {'part': 'c2', 'anchor': {'kind': 'cylinder', 'near': [0.02, 0, 0.01]}},
             ],
             'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}},
        ],
    },
}


def test_generate_sources_key_set():
    sources = generate_sources(INTENT_ASM)
    assert set(sources) == {'hn1', 'pn1', 'assembly'}
    assert 'def build():' in sources['hn1']
    assert 'connect_to' in sources['assembly']


def test_end_to_end_compile_steps(tmp_path):
    sources = generate_sources(INTENT_ASM)
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
    for name in ('hn1', 'pn1', 'assembly'):
        with open(res.artifacts[name], 'r', encoding='utf-8') as f:
            assert f.read(13) == 'ISO-10303-21;'
    # 装配 STEP 体积 > 任一零件（两个零件已合并）
    asm_size = os.path.getsize(res.artifacts['assembly'])
    assert asm_size > os.path.getsize(res.artifacts['hn1'])


def test_generate_sources_rejects_invalid_intent():
    bad = dict(INTENT_ASM, units='inches')
    with pytest.raises(ValueError) as exc:
        generate_sources(bad)
    try:
        from cad_intent import validate_intent
        assert 'units' in str(exc.value)   # Plan A 就绪：校验错误透出
    except ImportError:
        assert str(exc.value)              # Plan A 未执行：仍抛 CodegenError（不静默）


def test_part_only_intent(tmp_path):
    intent = {
        'schema_version': 2,
        'units': 'meters',
        'ground': 'hn1',
        'parts': [
            {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
             'profile': [{'kind': 'circle', 'diameter': 0.06}]},
            {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
             'end': 'blind', 'depth': 0.08},
        ],
        'assembly': None,
    }
    sources = generate_sources(intent)
    assert set(sources) == {'hn1'}
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
