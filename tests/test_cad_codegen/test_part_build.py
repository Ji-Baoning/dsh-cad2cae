"""零件边界切分 + 确定性执行测试。"""
import math
import pytest
from cad_codegen.part_gen import CodegenError, build_part, pick_edges, split_parts

# hub（轴套）+ post（立柱）的扁平 parts 数组（各链连续排布）
PARTS = [
    {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
    {'id': 'ps1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'rectangle', 'width': 0.06, 'height': 0.06}]},
    {'id': 'pn1', 'type': 'extrude', 'sketch': 'ps1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.02},
]


def test_split_parts_by_boundary():
    chains = split_parts(PARTS, ['hn1', 'pn1'])
    assert [n['id'] for n in chains['hn1']] == ['hs1', 'hn1']
    assert [n['id'] for n in chains['pn1']] == ['ps1', 'pn1']


def test_split_parts_unknown_ref():
    with pytest.raises(CodegenError):
        split_parts(PARTS, ['ghost'])


def _split_cross_chain_parts():
    """含跨链引用的 parts：f1(fillet 引用 n1) 位于 n1 之后、n2 之前。"""
    return [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.06}]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.08},
        {'id': 'f1', 'type': 'fillet', 'feature': 'n1',
         'edges': [{'near': [0.03, 0.03, 0.08]}], 'radius': 0.005},
        {'id': 's2', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.06, 'height': 0.06}]},
        {'id': 'n2', 'type': 'extrude', 'sketch': 's2', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
    ]


def test_split_parts_rejects_cross_chain_ref():
    # f1 位于 n1 之后，按“归属其后最近 part_ref”会被切进 n2 的链，但其引用 n1
    # 属上一零件链 → 必须响亮报错，而非静默生成错误几何。
    parts = _split_cross_chain_parts()
    with pytest.raises(CodegenError) as ei:
        split_parts(parts, ['n1', 'n2'])
    assert '不在同一零件链' in str(ei.value)


def test_split_parts_tail_ref_no_cross_chain():
    # 负向对照：part_ref 取各链末节点（f1、n2），引用全在链内 → 不报错。
    parts = _split_cross_chain_parts()
    chains = split_parts(parts, ['f1', 'n2'])
    assert [n['id'] for n in chains['f1']] == ['s1', 'n1', 'f1']
    assert [n['id'] for n in chains['n2']] == ['s2', 'n2']


def test_build_part_hub_cylinder_volume():
    nodes = split_parts(PARTS, ['hn1'])['hn1']
    part, amounts = build_part(nodes)
    expected = math.pi * 0.03 ** 2 * 0.08
    assert part.volume == pytest.approx(expected, rel=1e-3)


def test_build_part_through_all_cut_computes_amount():
    # 基体 0.02 厚 + through_all 切除：深度 = 0.02 + margin
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'b1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 's2', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.03}]},
        {'id': 'c1', 'type': 'extrude', 'sketch': 's2', 'operation': 'cut',
         'end': 'through_all'},
    ]
    part, amounts = build_part(nodes)
    assert amounts['c1'] == pytest.approx(0.03, abs=1e-9)  # 0.02 + 0.01
    # 通孔：内壁为 1 个圆柱面，体积 = 基体 - 通孔
    import build123d as bd
    cyls = [f for f in part.faces() if f.geom_type == bd.GeomType.CYLINDER]
    assert len(cyls) == 1
    assert part.volume == pytest.approx(0.1 * 0.1 * 0.02 - math.pi * 0.015 ** 2 * 0.02, rel=1e-3)


def test_pick_edges_returns_longest_near():
    import build123d as bd
    with bd.BuildPart() as bp:
        with bd.BuildSketch():
            bd.Rectangle(0.1, 0.1)
        bd.extrude(amount=0.02)
    e = pick_edges(bp.part, (0.05, 0.05, 0.02), 0.005)
    assert abs(e.length - 0.1) < 1e-9
    with pytest.raises(CodegenError):
        pick_edges(bp.part, (99.0, 99.0, 99.0), 0.005)
