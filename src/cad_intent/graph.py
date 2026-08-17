"""图结构与通用校验工具（顺序引用/草图图元/基准面）。"""

from cad_intent.schema import DATUMS, PROFILE_KINDS


def check_datum(ref, label, errors):
    """校验基准面引用。ref 需带 'datum'，可选 'offset'。"""
    if not ref or not isinstance(ref, dict):
        errors.append(label + ': ref 必须是一个对象。')
        return
    if 'datum' not in ref or ref['datum'] not in DATUMS:
        errors.append(label + ": ref.datum 必须是 " + '|'.join(sorted(DATUMS)) + '。')
    offset = ref.get('offset')
    if offset is not None and not (isinstance(offset, (int, float)) and _is_finite(offset)):
        errors.append(label + ': ref.offset 必须是米制的有符号数。')


def _is_finite(v):
    # bool 是 int 的子类，作为尺寸会被接收；净化器必须拒绝
    return (isinstance(v, (int, float)) and not isinstance(v, bool)
            and v == v and abs(v) != float('inf'))


def check_profile_prim(prim, label, errors):
    """校验草图图元。按 kind 检查必需数字字段。"""
    if not isinstance(prim, dict):
        errors.append(label + ' 必须是对象。')
        return
    kind = prim.get('kind')
    if kind not in PROFILE_KINDS:
        errors.append(label + ".kind '" + str(kind) + "' 不受支持（" + '|'.join(sorted(PROFILE_KINDS)) + '）。')
        return
    def need_num(k):
        if not (isinstance(prim.get(k), (int, float)) and _is_finite(prim[k])):
            errors.append(label + '.' + k + ' 必须是数字（米）。')
    if kind == 'rectangle':
        need_num('width'); need_num('height')
    elif kind == 'circle':
        need_num('diameter')
    elif kind == 'line':
        for k in ('x1', 'y1', 'x2', 'y2'): need_num(k)
    elif kind == 'arc':
        for k in ('cx', 'cy', 'x1', 'y1', 'x2', 'y2'): need_num(k)
        if prim.get('dir') not in (1, -1):
            errors.append(label + '.dir 必须是 1 (逆时针) 或 -1 (顺时针)。')
    elif kind == 'ellipse':
        for k in ('cx', 'cy', 'x1', 'y1', 'x2', 'y2'): need_num(k)
    elif kind == 'spline':
        pts = prim.get('points')
        if not (isinstance(pts, list) and len(pts) >= 4 and len(pts) % 2 == 0
                and all(isinstance(p, (int, float)) and _is_finite(p) for p in pts)):
            errors.append(label + '.points 必须是 [x1,y1,x2,y2,...] 扁平数组且至少 2 个点。')


def check_sketch_ref(node, nodes, i, seen, label, errors):
    """校验 'sketch' 引用：必须引用更早的 sketch 节点且紧跟其后。"""
    sk = node.get('sketch')
    prev = nodes[i - 1] if i > 0 else None
    if not (isinstance(sk, str) and sk):
        errors.append(label + ": 'sketch'（草图节点 id）必填。")
    elif seen.get(sk) != 'sketch':
        errors.append(label + ": 'sketch' 必须引用更早的 sketch 节点（got '" + str(sk) + "'）。")
    elif not (isinstance(prev, dict) and prev.get('id') == sk):
        errors.append(label + ": 必须紧跟在它的草图节点 '" + str(sk) + "' 之后。")
