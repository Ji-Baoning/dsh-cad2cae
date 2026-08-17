"""part 图节点校验。"""

from cad_intent.schema import (
    EXTRUDE_ENDS, NODE_TYPES, PATTERN_DIRECTIONS, PROFILE_KINDS,
)
from cad_intent.graph import check_datum, check_profile_prim, check_sketch_ref


def _is_pos(v):
    return isinstance(v, (int, float)) and _is_finite(v) and v > 0


def _is_finite(v):
    return isinstance(v, (int, float)) and v == v and abs(v) != float('inf')


def _is_int(v):
    return isinstance(v, int) or (isinstance(v, float) and v.is_integer())


def _is_bool(v):
    return isinstance(v, bool)


def validate_part_graph(parts, errors):
    """校验 part 节点数组。seen: id → type。"""
    seen = {}
    for i, node in enumerate(parts):
        where = 'parts[' + str(i) + ']'
        if not isinstance(node, dict):
            errors.append(where + ' 必须是对象。')
            continue
        nid = node.get('id')
        ntype = node.get('type')
        if not (isinstance(nid, str) and nid):
            errors.append(where + '.id 必填（非空字符串）。')
        elif nid in seen:
            errors.append(where + ".id '" + nid + "' 重复。")
        if ntype not in NODE_TYPES:
            errors.append(where + ".type '" + str(ntype) + "' 不是已注册的 part 类型（"
                          + '|'.join(sorted(NODE_TYPES)) + '）。')
            if isinstance(nid, str) and nid:
                seen[nid] = ntype
            continue
        label = where + " (" + ntype + " '" + str(nid) + "')"
        ref = node.get('ref') or {}
        if not isinstance(ref, dict):
            ref = {}

        if ntype == 'sketch':
            if ref.get('face') is not None:
                face = ref['face']
                if not (isinstance(face, dict) and _is_point3(face.get('near'))):
                    errors.append(label + ': ref.face 必须是 {near:[x,y,z], hint?}。')
            elif 'datum' in ref or 'offset' in ref:
                check_datum(ref, label, errors)
            # 无 ref（或 face 显式 null）→ 默认 front 基准面，合法
            profile = node.get('profile')
            if not (isinstance(profile, list) and len(profile) > 0):
                errors.append(label + ": 'profile' 必须是非空数组（图元）。")
            else:
                for j, prim in enumerate(profile):
                    check_profile_prim(prim, label + '.profile[' + str(j) + ']', errors)

        elif ntype == 'extrude':
            check_sketch_ref(node, parts, i, seen, label, errors)
            op = node.get('operation')
            if op not in ('boss', 'cut'):
                errors.append(label + ": 'operation' 必须为 'boss' 或 'cut'。")
            end = node.get('end') or 'blind'
            if end not in EXTRUDE_ENDS:
                errors.append(label + ": 'end' '" + str(end) + "' 不受支持（"
                              + '|'.join(sorted(EXTRUDE_ENDS)) + '）。')
            if end == 'blind' and not _is_pos(node.get('depth')):
                errors.append(label + '.depth 必须是正米数（blind 拉伸）。')
            if end == 'mid_plane' and not _is_pos(node.get('depth')):
                errors.append(label + '.depth 必须是正米数（mid_plane 拉伸总宽）。')

        elif ntype in ('fillet', 'chamfer'):
            if not _is_pos(node.get('radius' if ntype == 'fillet' else 'distance')):
                errors.append(label + ": '" + ('radius' if ntype == 'fillet' else 'distance')
                              + "' 必须是正米数。")
            edges = node.get('edges')
            if not (isinstance(edges, list) and len(edges) > 0):
                errors.append(label + ": 'edges' 必须是非空数组（边锚点）。")
            else:
                for j, e in enumerate(edges):
                    if not (isinstance(e, dict) and _is_point3(e.get('near'))):
                        errors.append(label + '.edges[' + str(j) + '] 必须是 {near:[x,y,z], hint?}。')

        elif ntype in ('linear_pattern', 'circular_pattern'):
            tgt = node.get('feature')
            if not (isinstance(tgt, str) and tgt):
                errors.append(label + ": 'feature'（更早特征节点 id）必填。")
            elif seen.get(tgt) not in ('extrude', 'fillet', 'chamfer'):
                errors.append(label + ": 'feature' '" + str(tgt) + "' 必须引用更早的特征生产节点。")
            if ntype == 'linear_pattern':
                if node.get('direction') not in PATTERN_DIRECTIONS:
                    errors.append(label + ": 'direction' 必须是 " + '|'.join(sorted(PATTERN_DIRECTIONS)) + '。')
                if not _is_pos(node.get('spacing')):
                    errors.append(label + ": 'spacing' 必须是正米数。")
            if not (_is_int(node.get('count')) and node['count'] >= 2):
                errors.append(label + ": 'count' 必须是 >= 2 的整数。")

        elif ntype == 'mirror':
            plane = node.get('plane')
            if not (isinstance(plane, dict) and plane.get('datum') in ('front', 'top', 'right')):
                errors.append(label + ": 'plane' 必须是 {datum: front|top|right}。")
            feats = node.get('features')
            if not (isinstance(feats, list) and len(feats) > 0):
                errors.append(label + ": 'features' 必须是非空数组。")
            else:
                for f in feats:
                    if seen.get(f) not in ('extrude', 'fillet', 'chamfer'):
                        errors.append(label + ".features '" + str(f) + "' 必须引用更早特征节点。")

        if isinstance(nid, str) and nid and nid not in seen:
            seen[nid] = ntype


def _is_point3(v):
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(x, (int, float)) and _is_finite(x) for x in v))
