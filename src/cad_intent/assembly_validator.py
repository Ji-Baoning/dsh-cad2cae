"""assembly 图校验：component 引用 + 静/动连接 + 四层装配校验。"""

from cad_intent.schema import (
    ANCHOR_KINDS, JOINT_CONTACT_KINDS, JOINT_DIRECTION_FLAGS, JOINT_TYPES, STATIC_METHODS,
)
from cad_intent.assembly_graph import check_connectivity


def _is_point3(v):
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(x, (int, float)) and x == x and abs(x) != float('inf') for x in v))


def _check_anchor(anchor, label, errors):
    if not isinstance(anchor, dict):
        errors.append(label + ' 必须是对象。')
        return
    kind = anchor.get('kind')
    if kind not in ANCHOR_KINDS:
        errors.append(label + ".kind '" + str(kind) + "' 不受支持（" + '|'.join(sorted(ANCHOR_KINDS)) + '）。')
    if not _is_point3(anchor.get('near')):
        errors.append(label + '.near 必须是 [x,y,z]（米）。')


def _check_contact(contact, label, comp_ids, errors):
    if not isinstance(contact, dict):
        errors.append(label + ' 必须是对象。')
        return
    part = contact.get('part')
    if not (isinstance(part, str) and part):
        errors.append(label + ": 'part'（component id）必填。")
    elif part not in comp_ids:
        errors.append(label + ": 'part' '" + str(part) + "' 必须引用更早的 component 节点。")
    _check_anchor(contact.get('anchor'), label + '.anchor', errors)


def _check_kinematic(conn, where, comp_ids, errors):
    """动连接校验：joint 合法性 + 运动方向与运动副匹配 + 接触面 kind 匹配。"""
    joint = conn.get('joint')
    if not (isinstance(joint, str) and joint):
        errors.append(where + ": 动连接必须携带 'joint'（运动副）。")
        return
    if joint not in JOINT_TYPES:
        errors.append(where + ": 'joint' '" + str(joint) + "' 不受支持（"
                      + '|'.join(sorted(JOINT_TYPES)) + '）。')
        return
    direction = conn.get('direction')
    if not isinstance(direction, dict):
        errors.append(where + ": 动连接必须携带 'direction'（运动方向）。")
        return
    # 接触面 kind 匹配运动副要求
    contact = conn.get('contact') or []
    required_kinds = JOINT_CONTACT_KINDS.get(joint, frozenset())
    for j, c in enumerate(contact):
        anchor = c.get('anchor') if isinstance(c, dict) else None
        kind = anchor.get('kind') if isinstance(anchor, dict) else None
        if kind is not None and kind not in required_kinds:
            errors.append(where + '.contact[' + str(j) + ']: 运动副 ' + str(joint)
                          + ' 要求接触面 kind ∈ ' + '|'.join(sorted(required_kinds))
                          + "（got '" + str(kind) + "'）。")
    # 运动方向与运动副查表匹配（机械原理：约束形式决定运动方向）
    rotation = direction.get('rotation')
    translation = direction.get('translation')
    exp_rot, exp_trans = JOINT_DIRECTION_FLAGS.get(joint, (True, True))
    if not (isinstance(rotation, bool) and isinstance(translation, bool)):
        errors.append(where + ': direction.rotation 与 direction.translation 必须是布尔值。')
    elif (rotation, translation) != (exp_rot, exp_trans):
        errors.append(where + ': 运动副 ' + str(joint) + ' 的运动方向应为 rotation='
                      + str(exp_rot) + ', translation=' + str(exp_trans) + '。')


def validate_assembly(assembly, parts_ids, ground_part, errors):
    """校验 assembly 图。parts_ids: part id 集合；ground_part: 顶层基准零件 id。"""
    if not isinstance(assembly, dict):
        errors.append('assembly 必须是对象。')
        return

    comp_ids = set()
    for j, comp in enumerate(assembly.get('components') or []):
        where = 'assembly.components[' + str(j) + ']'
        if not isinstance(comp, dict):
            errors.append(where + ' 必须是对象。')
            continue
        cid = comp.get('id')
        if not (isinstance(cid, str) and cid):
            errors.append(where + '.id 必填（非空字符串）。')
            continue
        comp_ids.add(cid)
        pref = comp.get('part_ref')
        if not (isinstance(pref, str) and pref):
            errors.append(where + ".part_ref（part 图节点 id）必填。")
        elif pref not in parts_ids:
            errors.append(where + ".part_ref '" + str(pref) + "' 未在 parts 中找到。")

    for k, conn in enumerate(assembly.get('connections') or []):
        where = 'assembly.connections[' + str(k) + ']'
        if not isinstance(conn, dict):
            errors.append(where + ' 必须是对象。')
            continue
        ctype = conn.get('type')
        if ctype not in ('static', 'kinematic'):
            errors.append(where + ": 'type' 必须是 static|kinematic（got '" + str(ctype) + "'）。")
            continue

        contact = conn.get('contact')
        if not (isinstance(contact, list) and len(contact) >= 1):
            errors.append(where + ": 'contact' 必须是非空接触面对数组。")
        else:
            for j, c in enumerate(contact):
                _check_contact(c, where + '.contact[' + str(j) + ']', comp_ids, errors)

        position = conn.get('position')
        if ctype == 'static':
            if not isinstance(position, dict):
                errors.append(where + ": 静连接必须携带 'position'（零件位置方向）。")
            method = conn.get('method')
            if not (isinstance(method, str) and method):
                errors.append(where + ": 静连接必须携带 'method'（工艺）。")
            elif method not in STATIC_METHODS:
                errors.append(where + ": 'method' '" + str(method) + "' 不受支持（"
                              + '|'.join(sorted(STATIC_METHODS)) + '）。')
            if method == 'bolt_fastening':
                fasteners = conn.get('fasteners')
                holes = fasteners.get('holes') if isinstance(fasteners, dict) else None
                if not (isinstance(holes, list) and len(holes) >= 1):
                    errors.append(where + ": bolt_fastening 必须携带 'fasteners.holes'（孔位锚点数组）。")
                else:
                    for j, h in enumerate(holes):
                        anchor = h.get('anchor') if isinstance(h, dict) else None
                        _check_anchor(anchor if anchor is not None else h,
                                      where + '.fasteners.holes[' + str(j) + ']', errors)
        else:  # kinematic
            _check_kinematic(conn, where, comp_ids, errors)

    # 四层校验：可达性 + 无环性
    ground_comp = None
    for comp in assembly.get('components') or []:
        if isinstance(comp, dict) and comp.get('part_ref') == ground_part:
            ground_comp = comp.get('id')
            break
    if ground_comp is None:
        comps = assembly.get('components') or []
        if comps and isinstance(comps[0], dict):
            ground_comp = comps[0].get('id')
    check_connectivity(assembly, ground_comp, errors)
