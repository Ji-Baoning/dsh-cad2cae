# src/cad_codegen/anchor_resolver.py
"""语义锚点 → 几何 Joint/Location/Axis 的确定性解析。"""
import build123d as bd
from dataclasses import dataclass
from cad_codegen.part_gen import CodegenError
from cad_codegen.profile import FACE_TOL


@dataclass
class ResolvedAnchor:
    """解析出的关节参数。location/axis 均为 ((x,y,z),(...)) 元组。"""
    label: str
    kind: str
    location: tuple | None = None
    axis: tuple | None = None
    face: 'bd.Face | None' = None


ANCHOR_GEOM = {
    'plane': bd.GeomType.PLANE,
    'cylinder': bd.GeomType.CYLINDER,
    'cone': bd.GeomType.CONE,
    'sphere': bd.GeomType.SPHERE,
}


def pick_face(shape, kind, near, tol=FACE_TOL):
    """按 kind + near 确定性拾取锚点面（取距 near 最近的面）。"""
    gt = ANCHOR_GEOM.get(kind)
    if gt is None:
        raise CodegenError('v1 不支持锚点 kind ' + str(kind))
    near = bd.Vector(*near)
    cands = [f for f in shape.faces() if f.geom_type == gt]
    if not cands:
        return None
    best = min(cands, key=lambda f: f.distance_to(near))
    if best.distance_to(near) > tol:
        return None
    return best


def _ser_loc(loc):
    p = loc.position
    return ((p.X, p.Y, p.Z), tuple(loc.orientation))


def resolve_anchor(shape, kind, near, cls, direction=None, label=''):
    """解析一个锚点为关节参数。cls 已由 orchestrator 确定（JointSpec 来源）。"""
    face = pick_face(shape, kind, near)
    if face is None:
        raise CodegenError('锚点 ' + str(kind) + ' 在 near ' + str(near) + ' 处未找到面')
    if cls == 'RigidJoint':
        return ResolvedAnchor(label, kind, location=_ser_loc(face.center_location), face=face)
    if cls == 'BallJoint':
        return ResolvedAnchor(label, kind, location=_ser_loc(bd.Location(face.center())), face=face)
    if cls == 'LinearJoint':
        if direction is None or not direction.get('axis'):
            raise CodegenError('prismatic 需要 direction.axis')
        c = face.center()
        return ResolvedAnchor(label, kind,
                              axis=((c.X, c.Y, c.Z), tuple(direction['axis'])), face=face)
    if cls in ('RevoluteJoint', 'CylindricalJoint'):
        ax = face.axis_of_rotation
        return ResolvedAnchor(label, kind, axis=(
            (ax.position.X, ax.position.Y, ax.position.Z),
            (ax.direction.X, ax.direction.Y, ax.direction.Z)), face=face)
    raise CodegenError('v1 不支持关节类 ' + cls)
