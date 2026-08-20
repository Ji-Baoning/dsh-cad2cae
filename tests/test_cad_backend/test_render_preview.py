# tests/test_cad_backend/test_render_preview.py
# build_preview：静态预览 PNG（show_image 的前置物）。装配/单零件渲染成功、缺 STEP 跳过、
# 全部无可渲染 → {ok:False} 响亮报错。验证 PNG 合法性（magic + IHDR 尺寸）。
import json
import os
import struct
import zlib
from pathlib import Path

import build123d as bd
from viewer_manifest import build_preview

ASSEMBLY = {
    'components': [{'id': 'c1', 'part_ref': 'hn1'}, {'id': 'c2', 'part_ref': 'pn1'}],
    'connections': [],
}
INTENT = {'units': 'meters', 'parts': [], 'assembly': ASSEMBLY}
_ID = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _write_box_step(out_dir, name, size=0.05):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    p = Path(out_dir) / (name + '.step')
    bd.export_step(bd.Box(size, size, size), str(p), unit=bd.Unit.M)
    return str(p)


def _read_png(path):
    data = Path(path).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'PNG magic 缺失'
    # IHDR：长度4 + 'IHDR' + 宽4 + 高4 + bitdepth1 + colortype1
    assert data[12:16] == b'IHDR'
    w, h = struct.unpack('>II', data[16:24])
    assert data[24] == 8, 'bit depth 应为 8'
    assert data[25] in (2, 6), 'colortype 应为 RGB(2) 或 RGBA(6)'
    # 单张 IDAT 即可解出 → 流合法（zlib 解压不抛）。
    zlib.decompress(data[data.index(b'IDAT') + 4:data.index(b'IEND')])
    return w, h


def test_build_preview_assembly_produces_png(tmp_path):
    out = str(tmp_path / 'out')
    for n in ('hn1', 'pn1', 'assembly'):
        _write_box_step(out, n)
    r = build_preview(out, INTENT, repo_root=str(tmp_path))
    assert r['ok'] is True
    assert r['preview'] == os.path.join('out', 'preview.png')
    assert r['parts_rendered'] == 2
    assert r['skipped'] == []
    assert r['triangles'] >= 12            # 两个 box 各 12 三角形
    assert r['size'] == [640, 480]         # 默认尺寸
    w, h = _read_png(os.path.join(out, 'preview.png'))
    assert (w, h) == (640, 480)
    assert r['preview'] == os.path.join('out', 'preview.png')  # 仓库相对路径（show_image 直接可解析）


def test_build_preview_uses_placements(tmp_path):
    # 有 transform 的零件也渲染：变换只影响投影位置，不改变三角面数与 PNG 合法性。
    out = str(tmp_path / 'out')
    for n in ('hn1', 'pn1', 'assembly'):
        _write_box_step(out, n)
    placements = {'c2': [0.0, -1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 1.0, 3.0, 0, 0, 0, 1]}
    Path(out, 'placements.json').write_text(json.dumps(placements), encoding='utf-8')
    r = build_preview(out, INTENT, repo_root=str(tmp_path))
    assert r['ok'] is True
    assert r['triangles'] >= 12
    _read_png(os.path.join(out, 'preview.png'))


def test_build_preview_single_part(tmp_path):
    out = str(tmp_path / 'out')
    _write_box_step(out, 'part')
    r = build_preview(out, {'units': 'meters', 'parts': []}, repo_root=str(tmp_path))
    assert r['ok'] is True
    assert r['parts_rendered'] == 1
    assert r['preview'] == os.path.join('out', 'preview.png')
    _read_png(os.path.join(out, 'preview.png'))


def test_build_preview_custom_size(tmp_path):
    out = str(tmp_path / 'out')
    _write_box_step(out, 'part')
    r = build_preview(out, {'units': 'meters', 'parts': []}, repo_root=str(tmp_path), size=(320, 240))
    assert r['size'] == [320, 240]
    w, h = _read_png(os.path.join(out, 'preview.png'))
    assert (w, h) == (320, 240)


def test_build_preview_missing_step_skipped(tmp_path):
    # hn1 有 STEP、pn1 缺失 → 跳过缺失件但仍出 PNG（预览不因单件缺而整废）。
    # 注意：build_preview 只渲染组件 STEP（part_ref），assembly.step 不在预览范围内。
    out = str(tmp_path / 'out')
    _write_box_step(out, 'hn1')
    _write_box_step(out, 'assembly')
    r = build_preview(out, INTENT, repo_root=str(tmp_path))
    assert r['ok'] is True
    assert r['parts_rendered'] == 1
    assert len(r['skipped']) == 1
    assert 'pn1.step: STEP 缺失' in r['skipped'][0]
    _read_png(os.path.join(out, 'preview.png'))


def test_build_preview_all_components_missing_ok_false(tmp_path):
    # 组件 STEP 全缺 → 无可渲染 → {ok:False} 且 error 带每个缺失件（响亮不静默）。
    out = str(tmp_path / 'out')
    Path(out).mkdir(parents=True, exist_ok=True)
    r = build_preview(out, INTENT, repo_root=str(tmp_path))
    assert r['ok'] is False
    assert 'preview 渲染失败' in r['error']
    assert 'hn1.step: STEP 缺失' in r['error']
    assert 'pn1.step: STEP 缺失' in r['error']
    assert not Path(out, 'preview.png').exists()


def test_build_preview_single_part_empty_dir_ok_false(tmp_path):
    # 无组件 + 空目录（单零件发现逻辑找不到 .step）→ '无 STEP 可渲染'。
    out = str(tmp_path / 'out')
    Path(out).mkdir(parents=True, exist_ok=True)
    r = build_preview(out, {'units': 'meters', 'parts': []}, repo_root=str(tmp_path))
    assert r['ok'] is False
    assert '无 STEP 可渲染' in r['error']
    assert not Path(out, 'preview.png').exists()
