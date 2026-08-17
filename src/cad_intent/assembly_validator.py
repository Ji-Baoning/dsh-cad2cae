"""assembly 图校验：component 引用 + 静/动连接。"""

from cad_intent.schema import ANCHOR_KINDS, STATIC_METHODS


def _is_point3(v):
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(x, (int, float)) and x == x and abs(x) != float('inf') for x in v))


def _check_anchor(anchor, label, errors):
    """校验锚点 {kind, near, hint?}。"""
    if not isinstance(anchor, dict):
        errors.append(label + ' 必须是对象。')
        return
    kind = anchor.get('kind')
    if kind not in ANCHOR_KINDS:
        errors.append(label + ".kind '" + str(kind) + "' 不受支持（" + '|'.join(sorted(ANCHOR_KINDS)) + '）。')
    if not _is_point3(anchor.get('near')):
        errors.append(label + '.near 必须是 [x,y,z]（米）。')


def _check_contact(contact, label, comp_ids, errors):
    """校验 contact 元素：{part: comp_id, anchor: {...}}。"""
    if not isinstance(contact, dict):
        errors.append(label + ' 必须是对象。')
        return
    part = contact.get('part')
    if not (isinstance(part, str) and part):
        errors.append(label + ": 'part'（component id）必填。")
    elif part not in comp_ids:
        errors.append(label + ": 'part' '" + str(part) + "' 必须引用更早的 component 节点。")
    _check_anchor(contact.get('anchor'), label + '.anchor', errors)


def validate_assembly(assembly, parts_ids, errors):
    """校验 assembly 图。parts_ids: part 图节点 id 集合。"""
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
