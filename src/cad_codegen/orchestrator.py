# src/cad_codegen/orchestrator.py
"""generate_sources 编排：校验 → 切分 → 锚点解析 → 发射 → 装配。"""
from cad_codegen.part_gen import (
    CodegenError, JointSpec, build_part, generate_part_source, split_parts,
)
from cad_codegen.anchor_resolver import resolve_anchor
from cad_codegen.assembly_gen import emit_assembly_source
from cad_codegen.profile import JOINT_ANCHOR_CLASS, JOINT_CLASSES


def generate_sources(intent):
    """意图层 JSON → {模块名: 源码}（零件模块 + assembly 模块）。"""
    try:
        from cad_intent import validate_intent  # 惰性：Tasks 1-6 单测不依赖 Plan A
    except ImportError:
        raise CodegenError('cad_intent（Plan A）未就绪：请先执行 Plan A')
    errors = validate_intent(intent)
    if errors:
        raise CodegenError('意图校验未通过：' + '; '.join(errors[:5]))
    parts_list = intent.get('parts') or []
    assembly = intent.get('assembly')
    components = (assembly or {}).get('components') or []
    part_refs = [c['part_ref'] for c in components if c.get('part_ref')]
    if part_refs:
        chains = split_parts(parts_list, part_refs)
    else:
        # 纯 part 图：整个 parts 数组即一个零件
        pid = intent.get('ground') or 'part'
        chains = {pid: parts_list}
    joints_by_part = _collect_joints(assembly, chains) if assembly else {}
    sources = {}
    for pref, nodes in chains.items():
        sources[pref] = generate_part_source(pref, nodes, joints_by_part.get(pref, []))
    if assembly:
        sources['assembly'] = emit_assembly_source(assembly, components)
    return sources


def _part_ref_of(assembly, comp_id):
    for comp in assembly.get('components') or []:
        if comp.get('id') == comp_id:
            return comp.get('part_ref')
    raise CodegenError('component ' + str(comp_id) + ' 未找到')


def _collect_joints(assembly, chains):
    """遍历连接，为每个零件解析出关节束。返回 {part_ref: [JointSpec]}。"""
    by_part = {}
    for conn in assembly.get('connections') or []:
        ctype = conn.get('type')
        label = conn.get('id', '')
        contact = conn.get('contact') or []
        if ctype == 'kinematic':
            joint_kind = conn.get('joint')
            if joint_kind not in JOINT_CLASSES or JOINT_CLASSES[joint_kind] is None:
                raise CodegenError('v1 不支持运动副 ' + str(joint_kind))
            direction = conn.get('direction') or {}
        else:
            joint_kind = None
            direction = None
        if len(contact) != 2:
            raise CodegenError('v1 仅支持 2 接触面连接（' + str(label) + '）')
        for c in contact:
            comp_id = c.get('part')
            pref = _part_ref_of(assembly, comp_id)
            nodes = chains.get(pref)
            if nodes is None:
                raise CodegenError('component ' + str(comp_id) + ' 的 part_ref 无特征链')
            anchor = c.get('anchor') or {}
            kind = anchor.get('kind')
            # 仅基准侧（首个接触面）装运动副；被移动侧以 RigidJoint 承接
            # （build123d 0.11.1 的 connect_to 要求目标关节为 RigidJoint）
            cls = JOINT_ANCHOR_CLASS.get(joint_kind or '', {}).get(kind, 'RigidJoint')
            if c is not contact[0]:
                cls = 'RigidJoint'
            shape, _ = build_part(nodes)
            ra = resolve_anchor(shape, kind, anchor.get('near'), cls, direction, label)
            by_part.setdefault(pref, []).append(JointSpec(
                label=ra.label, cls=cls, location=ra.location, axis=ra.axis))
    return by_part
