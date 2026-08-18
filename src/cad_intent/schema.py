"""意图层 JSON 的常量表（受限特征子集 + 装配词汇）。"""
import re

# 标识符格式：part/component/connection 的 id 会被无转义插值进生成的 Python 源码
# （字符串字面量、dict 键、import_module 模块名）与文件名，必须限定为合法 Python
# 标识符，否则可逃出字符串字面量注入任意语句、或借 ../ 写出 out_dir（路径穿越）。
IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def is_identifier(s):
    return bool(IDENTIFIER_RE.match(s))

# part 词汇（受限特征子集；revolve/sweep/loft/rib/钣金明确不支持）
NODE_TYPES = frozenset({
    'sketch', 'extrude', 'fillet', 'chamfer',
    'linear_pattern', 'circular_pattern', 'mirror',
})

# assembly 词汇
ASSEMBLY_TYPES = frozenset({'component', 'connection'})

# 基准面
DATUMS = frozenset({'front', 'top', 'right'})

# 草图图元
PROFILE_KINDS = frozenset({'rectangle', 'circle', 'line', 'arc', 'ellipse', 'spline'})

# 拉伸终止方式
EXTRUDE_ENDS = frozenset({'blind', 'through_all', 'up_to_surface', 'mid_plane'})

# 拉伸操作（受限子集）
EXTRUDE_OPERATIONS = frozenset({'boss', 'cut'})

# 特征生产节点（可供 array/mirror 引用为更早特征）
FEATURE_PRODUCERS = frozenset({'extrude', 'fillet', 'chamfer'})

# 阵列方向
PATTERN_DIRECTIONS = frozenset({'x', 'y', 'z'})

# 静连接工艺
STATIC_METHODS = frozenset({'weld', 'bond', 'bolt_fastening', 'rivet'})

# 连接类型
CONNECTION_TYPES = frozenset({'static', 'kinematic'})

# 动连接运动副（机械原理六类）
JOINT_TYPES = frozenset({
    'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical', 'helical',
})

# 运动副剩余自由度（信息性常量；动连接行为校验使用 JOINT_DIRECTION_FLAGS）
JOINT_DOF = {
    'revolute': 1, 'prismatic': 1, 'cylindrical': 2,
    'planar': 3, 'spherical': 3, 'helical': 1,
}

# 运动副要求的接触面 kind 集合（用于动连接一致性校验）
JOINT_CONTACT_KINDS = {
    'revolute': frozenset({'cylinder'}),
    'prismatic': frozenset({'plane'}),
    'cylindrical': frozenset({'cylinder'}),
    'planar': frozenset({'plane'}),
    'spherical': frozenset({'sphere', 'plane'}),  # 球面或点接触
    'helical': frozenset({'cylinder', 'cone'}),
}

# 运动副的运动方向标记（rotation, translation）——机械原理：约束形式决定运动方向
JOINT_DIRECTION_FLAGS = {
    'revolute': (True, False),
    'prismatic': (False, True),
    'cylindrical': (True, True),
    'planar': (True, True),
    'spherical': (True, False),
    'helical': (True, True),
}

# 锚点 kind
ANCHOR_KINDS = frozenset({'plane', 'cylinder', 'cone', 'sphere', 'line', 'circle'})
