"""装配源码发射（交付物①装配部分）。"""
from cad_codegen.part_gen import CodegenError


def emit_assembly_source(assembly, components):
    """发射装配建模语言源码：导入各零件 build()、按连接 connect_to、Compound 汇总。"""
    comp_ref = {}
    for c in components:
        if isinstance(c, dict) and c.get('id'):
            cid = c['id']
            pref = c.get('part_ref')
            if not pref:
                # 有 id 却缺 part_ref：上游校验应已拦截，此处兜底响亮报错，
                # 避免发射 import_module('None') 在子进程里失败得不明不白。
                raise CodegenError('component ' + str(cid) + ' 缺少 part_ref')
            comp_ref[cid] = pref
    lines = [
        '# 由 AI-CAD 生成（交付物①：装配建模语言源码）',
        'import json',
        'from importlib import import_module',
        'from build123d import Compound, Unit, export_step',
        '',
        '',
        'parts = {}',
    ]
    for cid, pref in comp_ref.items():
        lines.append("parts['%s'] = import_module('%s').build()" % (cid, pref))
    lines.append('')
    for conn in assembly.get('connections') or []:
        label = conn.get('id', '')
        contact = conn.get('contact') or []
        if len(contact) != 2:
            raise CodegenError('v1 仅支持 2 接触面连接（' + str(label) + '）')
        c0 = contact[0].get('part')
        c1 = contact[1].get('part')
        if c0 not in comp_ref or c1 not in comp_ref:
            raise CodegenError('连接接触零件未在 components 中定义')
        lines.append("parts['%s'].joints['%s'].connect_to(parts['%s'].joints['%s'])"
                     % (c0, label, c1, label))
    lines.append('')
    lines.append('assembly = Compound(children=list(parts.values()))')
    lines.append("export_step(assembly, 'assembly.step', unit=Unit.M)")
    lines.append('')
    lines.append('# 3D 预览辅助：写出装配定位（placements.json），查看器按零件高亮/显隐')
    lines.append('placements = {}')
    lines.append('for _cid in parts:')
    lines.append("    _loc = parts[_cid].location")
    lines.append('    _cx, _cy, _cz = _loc.x_axis.direction, _loc.y_axis.direction, _loc.z_axis.direction')
    lines.append('    _t = _loc.position')
    lines.append('    placements[_cid] = [_cx.X, _cy.X, _cz.X, _t.X,')
    lines.append('                        _cx.Y, _cy.Y, _cz.Y, _t.Y,')
    lines.append('                        _cx.Z, _cy.Z, _cz.Z, _t.Z,')
    lines.append('                        0.0, 0.0, 0.0, 1.0]')
    lines.append("with open('placements.json', 'w', encoding='utf-8') as _f:")
    lines.append('    json.dump(placements, _f, indent=2)')
    return '\n'.join(lines) + '\n'
