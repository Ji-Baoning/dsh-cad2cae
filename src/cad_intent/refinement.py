"""Top-down 三层细化：frozen 约束一致性校验。"""


def _part_ids(intent):
    ids = set()
    parts = intent.get('parts')
    if not isinstance(parts, list):
        return ids
    for node in parts:
        if isinstance(node, dict) and isinstance(node.get('id'), str):
            ids.add(node['id'])
    return ids


def _connection_signature(conn):
    """连接的核心冻结特征：type/joint/method。"""
    sig = {'type': conn.get('type')}
    if conn.get('type') == 'kinematic':
        sig['joint'] = conn.get('joint')
    elif conn.get('type') == 'static':
        sig['method'] = conn.get('method')
    return sig


def _conn_key(conn):
    """连接的稳定标识：接触零件 part id 的有序元组（非 dict/非字符串 part 则跳过）。"""
    if not isinstance(conn, dict):
        return None
    parts = []
    contact = conn.get('contact')
    if isinstance(contact, list):
        for c in contact:
            if isinstance(c, dict) and isinstance(c.get('part'), str):
                parts.append(c['part'])
    return tuple(sorted(parts)) if parts else None


def _sig_tuple(conn):
    """连接签名的可哈希形式（type/joint/method 指纹），便于按 key 分组比对。"""
    sig = _connection_signature(conn)
    return tuple(sorted(sig.items()))


def _group_by_key(conns):
    """按连接 key 分组签名列表；同 key 多条连接（同零件对的多个约束）保留为多重集。"""
    groups = {}
    for c in conns:
        k = _conn_key(c)
        if k is None:
            continue
        groups.setdefault(k, []).append(_sig_tuple(c))
    return {k: sorted(v) for k, v in groups.items()}


def validate_refinement(previous, next_intent, errors):
    """校验细化提交不违反冻结约束（units/ground/material/零件集合/连接特征）。"""
    if not isinstance(previous, dict) or not isinstance(next_intent, dict):
        errors.append('细化提交必须都是 JSON 对象。')
        return

    # 顶层冻结字段
    for key in ('units', 'ground', 'material'):
        if previous.get(key) != next_intent.get(key):
            errors.append("'" + key + "' 已冻结，细化不得修改（" + repr(previous.get(key))
                          + ' → ' + repr(next_intent.get(key)) + '）。')

    # part 节点集合：细化只能新增，不能删除
    prev_ids = _part_ids(previous)
    next_ids = _part_ids(next_intent)
    for pid in prev_ids:
        if pid not in next_ids:
            errors.append("part 节点 '" + str(pid) + "' 已冻结，细化不得删除。")

    # 连接特征冻结：type/joint/method（按稳定 key 双向比对，顺序无关）
    prev_asm = previous.get('assembly')
    next_asm = next_intent.get('assembly')
    prev_conns = prev_asm.get('connections') if isinstance(prev_asm, dict) else []
    next_conns = next_asm.get('connections') if isinstance(next_asm, dict) else []
    if not isinstance(prev_conns, list):
        prev_conns = []
    if not isinstance(next_conns, list):
        next_conns = []
    prev_groups = _group_by_key(prev_conns)
    next_groups = _group_by_key(next_conns)
    for k, psigs in prev_groups.items():
        if k not in next_groups:
            errors.append('连接 ' + str(k) + ' 已冻结，细化不得删除。')
            continue
        nsigs = next_groups[k]
        if psigs != nsigs:
            for p, n in zip(psigs, nsigs):
                if p == n:
                    continue
                pdc = dict(p)
                ndc = dict(n)
                for fk in pdc:
                    if fk in ndc and pdc[fk] != ndc[fk]:
                        errors.append("连接特征 '" + str(fk) + "' 已冻结，细化不得修改（"
                                      + repr(pdc[fk]) + ' → ' + repr(ndc[fk]) + '）。')
                break
