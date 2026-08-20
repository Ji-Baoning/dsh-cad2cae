# tests/test_cad_backend/test_viewer_manifest.py
# build_manifest：装配/单零件模式、placements 解析、缺失 STEP 响亮报缺。
import json
import os
from pathlib import Path

import build123d as bd
from viewer_manifest import build_manifest

ASSEMBLY = {
    'components': [{'id': 'c1', 'part_ref': 'hn1'}, {'id': 'c2', 'part_ref': 'pn1'}],
    'connections': [{'id': 'J1', 'type': 'kinematic',
                     'contact': [{'part': 'c1'}, {'part': 'c2'}]}],
}
INTENT = {'units': 'meters', 'parts': [], 'assembly': ASSEMBLY}
_ID = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _write_box_step(out_dir, name, size=0.05):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    p = Path(out_dir) / (name + '.step')
    bd.export_step(bd.Box(size, size, size), str(p), unit=bd.Unit.M)
    return str(p)


def test_build_manifest_assembly_mode(tmp_path):
    out = str(tmp_path / 'out')
    _write_box_step(out, 'hn1')
    _write_box_step(out, 'pn1')
    _write_box_step(out, 'assembly')
    m = build_manifest(out, INTENT, repo_root=str(tmp_path))
    assert m['viewer'] == 'assembly'
    assert [p['id'] for p in m['parts']] == ['c1', 'c2']
    assert m['parts'][0]['part_ref'] == 'hn1'
    assert m['parts'][0]['step'] == os.path.join('out', 'hn1.step')
    assert m['parts'][0]['transform'] == _ID
    assert m['parts'][0]['measure']['bodies'] == 1
    assert m['connections'] == [{'id': 'J1', 'type': 'kinematic', 'a': 'c1', 'b': 'c2'}]
    assert m['assembly_step'] == os.path.join('out', 'assembly.step')


def test_build_manifest_single_part(tmp_path):
    out = str(tmp_path / 'out')
    _write_box_step(out, 'part')
    m = build_manifest(out, {'units': 'meters', 'parts': []}, repo_root=str(tmp_path))
    assert m['viewer'] == 'single_part'
    assert len(m['parts']) == 1
    assert m['parts'][0]['id'] == 'part'
    assert m['parts'][0]['transform'] == _ID
    assert m['assembly_step'] is None


def test_build_manifest_uses_placements(tmp_path):
    out = str(tmp_path / 'out')
    for n in ('hn1', 'pn1', 'assembly'):
        _write_box_step(out, n)
    placements = {'c2': [0.0, -1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 1.0, 3.0, 0, 0, 0, 1]}
    Path(out, 'placements.json').write_text(json.dumps(placements), encoding='utf-8')
    m = build_manifest(out, INTENT, repo_root=str(tmp_path))
    assert m['parts'][0]['transform'] == _ID          # c1 缺省 → 恒等
    assert m['parts'][1]['transform'] == placements['c2']


def test_build_manifest_missing_step_reports_error(tmp_path):
    out = str(tmp_path / 'out')
    Path(out).mkdir(parents=True, exist_ok=True)
    m = build_manifest(out, INTENT, repo_root=str(tmp_path))
    assert m['parts'][0]['measure']['error']          # STEP 缺失不静默


from backend_cli import cmd_manifest


def test_cmd_manifest_wraps_workflow_id_and_repo_rel(tmp_path):
    out = str(tmp_path / 'out')
    for n in ('hn1', 'pn1', 'assembly'):
        _write_box_step(out, n)
    res = cmd_manifest(str(tmp_path / 'src'), {'workflow_id': 'wf1', 'intent': INTENT}, out)
    assert res['ok'] is True
    m = res['manifest']
    assert m['version'] == 1
    assert m['workflow_id'] == 'wf1'
    assert m['viewer'] == 'assembly'
    assert m['parts'][0]['step'] == os.path.join('out', 'hn1.step')  # 相对 repo_root=tmp_path
    assert m['assembly_step'] == os.path.join('out', 'assembly.step')
