# tests/test_cad_codegen/test_anchor_resolver.py
"""语义锚点 → Joint/Location/Axis 确定性解析测试。"""
import build123d as bd
import pytest
from cad_codegen.anchor_resolver import pick_face, resolve_anchor
from cad_codegen.part_gen import CodegenError


@pytest.fixture(scope='module')
def hub():
    with bd.BuildPart() as p:
        with bd.BuildSketch():
            bd.Circle(0.03)
        bd.extrude(amount=0.08)
    return p.part


def test_pick_face_cylinder_near(hub):
    f = pick_face(hub, 'cylinder', (0.03, 0, 0))
    assert f is not None
    assert f.geom_type == bd.GeomType.CYLINDER
    assert abs(f.axis_of_rotation.direction.length - 1.0) < 1e-9


def test_pick_face_plane_top(hub):
    f = pick_face(hub, 'plane', (0, 0, 0.08))
    assert f is not None
    assert f.geom_type == bd.GeomType.PLANE
    assert abs(f.center().Z - 0.08) < 1e-9


def test_pick_face_returns_none_when_absent(hub):
    assert pick_face(hub, 'cylinder', (1.0, 0, 0), tol=0.01) is None


def test_pick_face_unsupported_kind():
    with pytest.raises(CodegenError):
        pick_face(None, 'line', (0, 0, 0))


def test_resolve_cylinder_revolute(hub):
    ra = resolve_anchor(hub, 'cylinder', (0.03, 0, 0), 'RevoluteJoint', label='c1')
    assert ra.label == 'c1'
    assert ra.axis is not None
    px, d = ra.axis
    assert px == pytest.approx((0, 0, 0), abs=1e-6)
    assert abs(d[2]) == pytest.approx(1.0, abs=1e-6)  # ±Z 均可


def test_resolve_plane_rigid(hub):
    ra = resolve_anchor(hub, 'plane', (0, 0, 0.08), 'RigidJoint', label='c1')
    pos, ori = ra.location
    assert pos == pytest.approx((0, 0, 0.08), abs=1e-6)
    assert ori == pytest.approx((0, 0, 0), abs=1e-6)


def test_resolve_plane_prismatic_needs_direction(hub):
    with pytest.raises(CodegenError):
        resolve_anchor(hub, 'plane', (0, 0, 0.08), 'LinearJoint')
    ra = resolve_anchor(hub, 'plane', (0, 0, 0.08), 'LinearJoint',
                        direction={'axis': [0, 1, 0]}, label='c1')
    pos, d = ra.axis
    assert d == (0, 1, 0)
    assert pos[1] == pytest.approx(0.0, abs=1e-6)
