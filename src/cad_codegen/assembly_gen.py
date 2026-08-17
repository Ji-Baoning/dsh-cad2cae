"""装配源码发射（交付物①装配部分）。"""
from cad_codegen.part_gen import CodegenError


def emit_assembly_source(assembly, components):
    """发射装配建模语言源码：导入各零件 build()、按连接 connect_to、Compound 汇总。"""
    comp_ref = {}
    for c in components:
        if isinstance(c, dict) and c.get('id'):
            comp_ref[c['id']] = c.get('part_ref')
    lines = [
        '# 由 AI-CAD 生成（交付物①：装配建模语言源码）',
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
    return '\n'.join(lines) + '\n'
