"""part 图拆解、确定性执行与源码发射。"""
import build123d as bd
from dataclasses import dataclass
from build123d import (GridLocations, Location, Mode,
    Plane, PolarLocations, Vector, chamfer, extrude, fillet, mirror)
from cad_codegen.profile import (
    DATUM_LOCATIONS, EDGE_TOL, MIRROR_PLANE_TUP, THROUGH_MARGIN, _fmt,
)


class CodegenError(ValueError):
    """代码生成错误（校验已通过但超出 v1 代码生成范围）。"""


@dataclass
class JointSpec:
    """零件上一个装配关节的发射参数。location/axis 均为 ((x,y,z),(...)) 元组。"""
    label: str
    cls: str
    location: tuple | None = None
    axis: tuple | None = None


def _refs_of(node):
    """节点引用的更早节点 id 集合（供 check_sketch_ref 之外的依赖判断）。"""
    refs = set()
    if node.get('type') == 'extrude':
        sk = node.get('sketch')
        if isinstance(sk, str):
            refs.add(sk)
    elif node.get('type') in ('fillet', 'chamfer'):
        feat = node.get('feature')
        if isinstance(feat, str):
            refs.add(feat)
    elif node.get('type') in ('linear_pattern', 'circular_pattern'):
        feat = node.get('feature')
        if isinstance(feat, str):
            refs.add(feat)
    elif node.get('type') == 'mirror':
        for f in node.get('features') or []:
            if isinstance(f, str):
                refs.add(f)
    return refs


def split_parts(parts, part_refs):
    """按零件边界把扁平 parts 数组切分为 {part_ref: [节点链]}。

    约定：各零件特征链在 parts 数组中连续排布，part_ref 为各链边界节点 id；
    每个节点归属它之后最近的 part_ref（节点 index ≤ part_ref index），
    越过最后一个 part_ref 的尾部节点不属于任何零件。返回 dict（按数组顺序）。
    """
    if not part_refs:
        return {}
    ref_pos = {}
    for pref in part_refs:
        pos = next((i for i, n in enumerate(parts)
                    if isinstance(n, dict) and n.get('id') == pref), -1)
        if pos < 0:
            raise CodegenError("part_ref '" + str(pref) + "' 未在 parts 中找到")
        ref_pos[pref] = pos
    order = sorted(ref_pos, key=lambda p: ref_pos[p])
    result = {pref: [] for pref in order}
    for i, node in enumerate(parts):
        if not isinstance(node, dict):
            continue
        owner = None
        for pref in order:
            if ref_pos[pref] >= i:
                owner = pref
                break
        if owner is not None:
            result[owner].append(node)
    return result


def _index_of(nodes, nid):
    for i, n in enumerate(nodes):
        if isinstance(n, dict) and n.get('id') == nid:
            return i
    return -1


def _build_plan(nodes):
    """展开执行/发射计划：普通节点 or 阵列块（吸收被阵列的 sketch+extrude）。

    0.11.1 中 Locations 上下文必须位于 BuildSketch 内部才生效（外层失效），
    故阵列特征（sketch+extrude）被吸收进一个带 GridLocations/PolarLocations
    的 BuildSketch，被吸收的 sketch 与原 extrude 不再独立发射。
    """
    by_id = {n['id']: n for n in nodes}
    absorbed = set()
    pattern_blocks = {}
    for i, node in enumerate(nodes):
        if node.get('type') not in ('linear_pattern', 'circular_pattern'):
            continue
        feat = node.get('feature')
        feat_node = by_id.get(feat)
        if not feat_node or feat_node.get('type') != 'extrude':
            raise CodegenError('v1 仅支持对 extrude 做阵列（' + str(node.get('type')) + '）')
        if _index_of(nodes, feat) != i - 1:
            raise CodegenError('阵列特征必须紧跟其后（' + str(feat) + '）')
        sk = nodes[i - 2]
        if sk.get('type') != 'sketch' or sk.get('id') != feat_node.get('sketch'):
            raise CodegenError('被阵列 extrude 缺少紧邻 sketch')
        absorbed.add(feat)
        absorbed.add(sk['id'])
        pattern_blocks[node['id']] = {'node': node, 'sketch': sk, 'extrude': feat_node}
    plan = []
    for node in nodes:
        nid = node['id']
        if nid in absorbed:
            continue
        if nid in pattern_blocks:
            plan.append({'op': 'pattern', **pattern_blocks[nid]})
        else:
            plan.append({'op': 'node', 'node': node})
    return plan


def _exec_profile(profile):
    """执行 profile 图元（line 段归组为 Polygon）。"""
    if not profile:
        raise CodegenError('profile 不能为空')
    if all(p.get('kind') == 'line' for p in profile):
        pts = _line_vertices(profile)
        if len(pts) < 3:
            raise CodegenError('line 轮廓至少需要 3 个顶点（闭合环）')
        bd.Polygon(*pts)
        return
    for p in profile:
        kind = p.get('kind')
        if kind == 'rectangle':
            bd.Rectangle(p['width'], p['height'])
        elif kind == 'circle':
            bd.Circle(p['diameter'] / 2.0)
        else:
            raise CodegenError('v1 不支持草图图元 ' + str(kind))


def _line_vertices(profile):
    """连续 line 段 → 去重端点后的多边形顶点（Polygon 自动闭合）。"""
    pts = []
    for p in profile:
        for v in ((p['x1'], p['y1']), (p['x2'], p['y2'])):
            if not pts or (round(v[0] - pts[-1][0], 9) != 0
                           or round(v[1] - pts[-1][1], 9) != 0):
                pts.append(v)
    if len(pts) > 1 and (round(pts[-1][0] - pts[0][0], 9) == 0
                         and round(pts[-1][1] - pts[0][1], 9) == 0):
        pts.pop()  # 闭合点由 Polygon 自动补，去掉与首点重合的尾点
    return pts


def _exec_sketch(node, part):
    ref = node.get('ref') or {}
    if ref.get('face') is not None:
        raise CodegenError('v1 不支持 ref.face 面上草图')
    datum = ref.get('datum', 'front')
    off = ref.get('offset', 0.0)
    if datum == 'front':
        loc = Location((0, 0, off))
    elif datum == 'top':
        loc = Location((0, off, 0), (0, 90, 0))
    elif datum == 'right':
        loc = Location((off, 0, 0), (0, 0, 90))
    else:
        raise CodegenError('未知基准面 ' + str(datum))
    with bd.BuildSketch(loc) as sk:
        _exec_profile(node.get('profile', []))
    # build123d 0.11 作用域限制：helper 帧内创建的 BuildSketch 不会自动挂到外层
    # BuildPart（builder_parent=None），手动把草图面并入 part 待拉伸面（等价于
    # 同作用域下 Builder.__exit__ 的 _add_to_context 转移）。
    if sk._obj is not None:
        part._add_to_context(sk._obj)


def _part_extent(part, datum, off):
    """当前 part 沿 datum 法向的最大范围（米），用于 through_all 切除深度。"""
    bbox = part.part.bounding_box()
    if datum == 'front':
        return bbox.max.Z - off
    if datum == 'top':
        return bbox.max.Y - off
    return bbox.max.X - off


def _exec_extrude(node, part, amounts, sketch=None):
    op = node.get('operation', 'boss')
    end = node.get('end', 'blind')
    depth = node.get('depth')
    if end == 'up_to_surface':
        raise CodegenError('v1 不支持 extrude end=up_to_surface')
    if end == 'mid_plane':
        if not depth:
            raise CodegenError('mid_plane 需要 depth')
        extrude(amount=depth, both=True)
        return
    if end == 'through_all':
        if op != 'cut':
            raise CodegenError('v1 不支持 boss through_all')
        ref = (sketch or {}).get('ref') or {}
        datum = ref.get('datum', 'front')
        off = ref.get('offset', 0.0)
        amount = _part_extent(part, datum, off) + THROUGH_MARGIN
        amounts[node['id']] = amount
        extrude(amount=amount, mode=Mode.SUBTRACT)
        return
    if not depth:
        raise CodegenError('blind 需要 depth')
    if op == 'cut':
        extrude(amount=depth, mode=Mode.SUBTRACT)
    else:
        extrude(amount=depth)


def pick_edges(shape, near, tol):
    """在 shape 中按 near 拾取唯一边（取距 near 最近、等距取最长）。"""
    near = Vector(*near)
    cands = [e for e in shape.edges() if e.distance_to(near) < tol]
    if not cands:
        raise CodegenError('未找到边（near ' + str(tuple(near)) + '）')
    return max(cands, key=lambda e: e.length)


def _exec_round(node, part):
    ntype = node['type']
    r = node.get('radius' if ntype == 'fillet' else 'distance')
    edges = node.get('edges', [])
    if len(edges) != 1:
        raise CodegenError('v1 仅支持单个边锚点（' + ntype + '）')
    e = pick_edges(part.part, edges[0]['near'], EDGE_TOL)
    if ntype == 'fillet':
        fillet([e], radius=r)
    else:
        chamfer([e], length=r)


def _exec_mirror(node, part):
    plane = node.get('plane') or {}
    datum = plane.get('datum', 'front')
    tup = MIRROR_PLANE_TUP.get(datum)
    if tup is None:
        raise CodegenError('未知镜像基准 ' + str(datum))
    mirror(about=Plane(*tup))


def _exec_pattern_block(item, part, amounts):
    node = item['node']
    sk = item['sketch']
    ex = item['extrude']
    ref = sk.get('ref') or {}
    if ref.get('face') is not None:
        raise CodegenError('v1 不支持 ref.face 面上草图')
    datum = ref.get('datum', 'front')
    off = ref.get('offset', 0.0)
    if datum == 'front':
        loc = Location((0, 0, off))
    elif datum == 'top':
        loc = Location((0, off, 0), (0, 90, 0))
    else:
        loc = Location((off, 0, 0), (0, 0, 90))
    with bd.BuildSketch(loc) as bs:
        if node['type'] == 'linear_pattern':
            direction = node.get('direction', 'x')
            if direction == 'z':
                raise CodegenError('v1 不支持 z 方向线性阵列')
            spacing, count = node['spacing'], node['count']
            if direction == 'x':
                with GridLocations(spacing, 1, count, 1):
                    _exec_profile(sk.get('profile', []))
            else:
                with GridLocations(1, spacing, 1, count):
                    _exec_profile(sk.get('profile', []))
        else:
            if node.get('radius') is None:
                raise CodegenError('circular_pattern 需要 radius')
            with PolarLocations(node['radius'], node['count']):
                _exec_profile(sk.get('profile', []))
    # 同上：helper 帧内 BuildSketch 手动挂到 part（阵列多面并入待拉伸面）
    if bs._obj is not None:
        part._add_to_context(bs._obj)
    _exec_extrude(ex, part, amounts, sketch=sk)


def _exec_node(node, part, amounts):
    ntype = node['type']
    if ntype == 'sketch':
        _exec_sketch(node, part)
    elif ntype == 'extrude':
        _exec_extrude(node, part, amounts)
    elif ntype in ('fillet', 'chamfer'):
        _exec_round(node, part)
    elif ntype == 'mirror':
        _exec_mirror(node, part)
    else:
        raise CodegenError('未知节点类型 ' + str(ntype))


def build_part(nodes):
    """按顺序确定性执行 nodes（含阵列块），返回 (part, through_amounts)。

    through_amounts: {节点 id: 通过孔深度（米）}，供发射器复用同一数值。
    """
    if not nodes:
        raise CodegenError('零件无特征节点')
    amounts = {}
    prev_sketch = None
    with bd.BuildPart() as part:
        for item in _build_plan(nodes):
            if item['op'] == 'node':
                n = item['node']
                if n['type'] == 'sketch':
                    _exec_sketch(n, part)
                    prev_sketch = n
                elif n['type'] == 'extrude':
                    _exec_extrude(n, part, amounts, sketch=prev_sketch)
                    prev_sketch = None
                else:
                    _exec_node(n, part, amounts)
                    prev_sketch = None
            else:
                _exec_pattern_block(item, part, amounts)
                prev_sketch = None
    return part.part, amounts
