"""Top-down 三层细化：frozen 约束一致性校验。"""


def _part_ids(intent):
    ids = set()
    for node in intent.get('parts') or []:
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

    # 连接特征冻结：type/joint/method
    prev_conns = (previous.get('assembly') or {}).get('connections') or []
    next_conns = (next_intent.get('assembly') or {}).get('connections') or []
    if len(prev_conns) == len(next_conns):
        for pc, nc in zip(prev_conns, next_conns):
            if not (isinstance(pc, dict) and isinstance(nc, dict)):
                continue
            ps = _connection_signature(pc)
            ns = _connection_signature(nc)
            for k in ps:
                if k in ns and ps[k] != ns[k]:
                    errors.append("连接特征 '" + str(k) + "' 已冻结，细化不得修改（"
                                  + repr(ps[k]) + ' → ' + repr(ns[k]) + '）。')
