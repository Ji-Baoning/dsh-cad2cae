"""代码生成层常量表。发射模板（字符串）与 in-process 执行（bd 对象）共用，严禁两处漂移。"""
import build123d as bd

STEP_UNIT = bd.Unit.M         # 导出 STEP 单位：米
EDGE_TOL = 0.005              # 边拾取容差（米）
FACE_TOL = 0.05               # 锚点面拾取容差（米）
THROUGH_MARGIN = 0.01         # through_all 切除深度富余（米）


def _fmt(v):
    """数值 → 字符串（米，最多 9 位小数，-0.0 → 0.0）。"""
    v = float(v)
    if abs(v) < 1e-12:
        return '0.0'
    s = repr(round(v, 9))
    return '0.0' if s == '-0.0' else s


# v1 代码生成不支持（校验器仍接受；此处仅作为自文档化清单，报错在调用点抛出）
V1_NOT_SUPPORTED = {
    'ref.face 面上草图': 'sketch.ref.face',
    'up_to_surface 拉伸': 'extrude.end',
    'boss through_all': 'extrude.end',
    'z 方向线性阵列': 'linear_pattern.direction',
    '阵列/镜像目标非 extrude': 'pattern/mirror.features',
    '圆弧/椭圆/样条/孤立 line 图元': 'profile.kind',
    'planar/helical 运动副': 'connection.joint.kind',
    'line/circle 锚点': 'anchor.kind',
}

def _fmt_coord(v):
    """坐标值 → 字符串：整数值输出为整数（镜像平面惯例），其余走 _fmt。"""
    v = float(v)
    return str(int(v)) if v.is_integer() else _fmt(v)


# 基准面 → (偏移轴索引, 旋转欧拉角)：单一来源，发射模板与执行 Location 共用
DATUM_LOCATION_TUP = {
    'front': (2, (0, 0, 0)),
    'top': (1, (0, 90, 0)),
    'right': (0, (0, 0, 90)),
}


def _location_expr(off_axis, orientation):
    """(偏移轴索引, 欧拉角) → 'Location(...)' 发射模板（{off} 占位符，欧拉角全零省略）。"""
    coords = ['0', '0', '0']
    coords[off_axis] = '{off}'
    s = 'Location((' + ', '.join(coords) + ')'
    if any(orientation):
        s += ', (' + ', '.join(_fmt_coord(o) for o in orientation) + ')'
    return s + ')'


# 基准面 → BuildSketch 的 Location 表达式模板（{off} = 沿法向偏移，米）
DATUM_LOCATIONS = {d: _location_expr(a, o) for d, (a, o) in DATUM_LOCATION_TUP.items()}


def _plane_expr(origin, x_dir, normal):
    """平面三元组 → 'Plane((...), (...), (...))' 表达式。"""
    def pt(t):
        return '(' + ', '.join(_fmt_coord(c) for c in t) + ')'
    return 'Plane(%s, %s, %s)' % (pt(origin), pt(x_dir), pt(normal))


# 基准面 → mirror 平面（发射用字符串 / 执行用三元组，二者同一来源）
MIRROR_PLANE_TUP = {
    'front': ((0, 0, 0), (1, 0, 0), (0, 0, 1)),   # 法向 +Z
    'top': ((0, 0, 0), (1, 0, 0), (0, 1, 0)),     # 法向 +Y
    'right': ((0, 0, 0), (0, 0, 1), (1, 0, 0)),   # 法向 +X
}
MIRROR_PLANES = {d: _plane_expr(o, x, n) for d, (o, x, n) in MIRROR_PLANE_TUP.items()}

# 运动副 kind → 代码层关节类（None = v1 不支持）
JOINT_CLASSES = {
    'revolute': 'RevoluteJoint',
    'prismatic': 'LinearJoint',
    'cylindrical': 'CylindricalJoint',
    'spherical': 'BallJoint',
    'planar': None,
    'helical': None,
}

# 运动副 kind + 锚点 kind → 关节类（未匹配锚点侧退化为 RigidJoint）
JOINT_ANCHOR_CLASS = {
    'revolute': {'cylinder': 'RevoluteJoint'},
    'prismatic': {'plane': 'LinearJoint'},
    'cylindrical': {'cylinder': 'CylindricalJoint'},
    'spherical': {'sphere': 'BallJoint'},
    'planar': {},
    'helical': {},
}
