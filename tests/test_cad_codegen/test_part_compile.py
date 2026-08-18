"""子进程编译测试：交付物② STEP 文件从交付物①源码导出。"""
import os
import pytest
from cad_codegen import compile_sources
from cad_codegen.part_gen import CodegenError, generate_part_source

HUB_NODES = [
    {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
]


def test_compile_hub_step(tmp_path):
    src = generate_part_source('hub', HUB_NODES, [])
    res = compile_sources({'hub': src}, str(tmp_path))
    assert res.ok, res.steps
    assert res.artifacts['hub'] == os.path.join(str(tmp_path), 'hub.step')
    with open(res.artifacts['hub'], 'r', encoding='utf-8') as f:
        assert f.read(13) == 'ISO-10303-21;'


def test_compile_reports_failure(tmp_path):
    res = compile_sources({'bad': 'raise SyntaxError("x")\n'}, str(tmp_path))
    assert not res.ok
    assert res.steps[0][0] == 'bad'
    assert res.steps[0][1] is False
    assert 'SyntaxError' in res.steps[0][2]


def test_compile_rejects_non_identifier_module(tmp_path):
    # I1（最终审查）纵深防御：模块名直接用于 os.path.join(out_dir, name + '.py') 与
    # 子进程执行，含 '/'、'..' 的名称必须拒绝（否则写出 out_dir 之外或执行任意路径脚本）。
    with pytest.raises(CodegenError) as ei:
        compile_sources({'../evil': 'x = 1\n'}, str(tmp_path))
    assert '合法 Python 标识符' in str(ei.value)
