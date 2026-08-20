# preset/ai-cad-dsh/preset/python/viewer_manifest.py
# 查看器 manifest 构建：装配树 + 零件 STEP/变换/测量（单位米）。
# transform 契约：16 个 float，行主序 4×4；前三列 = 变换后 x/y/z 轴向量（旋转矩阵列），
# 第 4 列 = 平移，末行 0,0,0,1。来源见 assembly_gen 的 placements.json。
import json
import os

from measure import measure

_IDENTITY = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _measure_abs(step_abs):
    if not os.path.exists(step_abs):
        return {'error': 'STEP 缺失: ' + os.path.basename(step_abs)}
    try:
        return measure(step_abs)
    except Exception as e:  # OCP 不可用等 → 响亮带 error，不静默降级
        return {'error': str(e)}


def _load_placements(out_dir):
    path = os.path.join(out_dir, 'placements.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build_manifest(out_dir, intent, repo_root):
    assembly = intent.get('assembly') or {}
    components = assembly.get('components') or []
    placements = _load_placements(out_dir)
    parts = []

    for comp in components:
        cid = comp.get('id')
        pref = comp.get('part_ref')
        step_abs = os.path.join(out_dir, pref + '.step')
        parts.append({
            'id': cid,
            'part_ref': pref,
            'step': os.path.relpath(step_abs, repo_root),
            'transform': list(placements.get(cid, _IDENTITY)),
            'measure': _measure_abs(step_abs),
        })

    if not components:
        # 单零件工作流：out_dir 下非 assembly 的 *.step。
        steps = (sorted(n for n in os.listdir(out_dir)
                        if n.endswith('.step') and n != 'assembly.step')
                 if os.path.isdir(out_dir) else [])
        for name in steps:
            step_abs = os.path.join(out_dir, name)
            pref = name[:-5]
            parts.append({
                'id': pref, 'part_ref': pref,
                'step': os.path.relpath(step_abs, repo_root),
                'transform': list(_IDENTITY),
                'measure': _measure_abs(step_abs),
            })

    connections = []
    for conn in assembly.get('connections') or []:
        contact = conn.get('contact') or []
        if len(contact) == 2:
            connections.append({
                'id': conn.get('id', ''),
                'type': conn.get('type', 'static'),
                'a': contact[0].get('part'),
                'b': contact[1].get('part'),
            })

    return {
        'version': 1,
        'viewer': 'assembly' if components else 'single_part',
        'parts': parts,
        'connections': connections,
        'assembly_step': (os.path.relpath(os.path.join(out_dir, 'assembly.step'), repo_root)
                          if components else None),
    }
