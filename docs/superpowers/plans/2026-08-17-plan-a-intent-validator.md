# Plan A: 意图层校验器（validateIntent）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `src/cad_intent/` 纯 Python 校验模块——校验意图层 JSON（part 图 + assembly 图 + Top-down 三层细化），返回错误列表。

**Architecture:** 仿 sample 项目 `preset/wlj-plugin.js` 的 `validateGraph` 思路（seen/checkSketchRef/顺序引用），扩展为两层：part 图校验 + assembly 图校验（装配四层：可达性/无环性/静连接完备性/动连接一致性）。纯 Python，零外部依赖（仅标准库），可独立 TDD。

**Tech Stack:** Python 3.11 标准库，pytest 9.1.1（仅测试）。

## Global Constraints

- 纯标准库，不 import build123d/OCP/任何第三方
- `validate_intent(intent: dict) -> list[str]`，返回错误列表（空 = 通过），风格同 sample `validateGraph`
- 所有常量（NODE_TYPES/运动副查表等）集中在 `schema.py`，其他模块从 `schema.py` 导入
- 单位强制 `meters`（违反即报错）
- 词法分离：part 词汇与 assembly 词汇不得混图
- 错误信息格式：`<location>: <message>`，location 用 `parts[i]` / `assembly.components[i]` / `assembly.connections[i]` 形式
- 代码中文注释（项目风格同 sample wlj-plugin.js）

---

### Task 1: 包骨架 + schema.py 常量表

**Files:**
- Create: `src/cad_intent/__init__.py`
- Create: `src/cad_intent/schema.py`
- Create: `tests/test_cad_intent/test_schema.py`

**Interfaces:**
- Consumes: 无（本任务自包含）
- Produces: `schema.py` 导出的常量（后续任务使用）：
  - `NODE_TYPES: frozenset[str]` — part 词汇
  - `ASSEMBLY_TYPES: frozenset[str]` — `{'component', 'connection'}`
  - `DATUMS: frozenset[str]` — `{'front', 'top', 'right'}`
  - `PROFILE_KINDS: frozenset[str]` — `{'rectangle','circle','line','arc','ellipse','spline'}`
  - `EXTRUDE_ENDS: frozenset[str]` — `{'blind','through_all','up_to_surface','mid_plane'}`
  - `PATTERN_DIRECTIONS: frozenset[str]` — `{'x','y','z'}`
  - `STATIC_METHODS: frozenset[str]` — `{'weld','bond','bolt_fastening','rivet'}`
  - `JOINT_TYPES: frozenset[str]` — 六种运动副
  - `JOINT_DOF: dict[str, int]` — 运动副剩余自由度数
  - `JOINT_CONTACT_KINDS: dict[str, frozenset[str]]` — 运动副要求的接触面 kind 集合
  - `ANCHOR_KINDS: frozenset[str]` — `{'plane','cylinder','cone','sphere','line','circle'}`
  - `JOINT_DIRECTION_FLAGS: dict[str, tuple[bool, bool]]` — 运动副运动方向标记 `(rotation, translation)`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_schema.py
"""schema.py 常量表测试"""
from cad_intent import schema


def test_part_vocabulary():
    assert 'sketch' in schema.NODE_TYPES
    assert 'extrude' in schema.NODE_TYPES
    assert 'fillet' in schema.NODE_TYPES
    assert 'revolve' not in schema.NODE_TYPES  # 受限子集排除
    assert 'sweep' not in schema.NODE_TYPES
    assert 'loft' not in schema.NODE_TYPES


def test_assembly_vocabulary():
    assert schema.ASSEMBLY_TYPES == frozenset({'component', 'connection'})


def test_joint_table_covers_six_joints():
    assert schema.JOINT_TYPES == frozenset(
        {'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical', 'helical'}
    )


def test_joint_dof_expected():
    assert schema.JOINT_DOF == {
        'revolute': 1, 'prismatic': 1, 'cylindrical': 2,
        'planar': 3, 'spherical': 3, 'helical': 1,
    }


def test_joint_contact_kinds():
    # 转动副要求圆柱接触；平面副要求平面接触
    assert schema.JOINT_CONTACT_KINDS['revolute'] == frozenset({'cylinder'})
    assert schema.JOINT_CONTACT_KINDS['planar'] == frozenset({'plane'})
    assert schema.JOINT_CONTACT_KINDS['prismatic'] == frozenset({'plane'})


def test_joint_direction_flags():
    # 机械原理：约束形式决定运动方向
    assert schema.JOINT_DIRECTION_FLAGS['revolute'] == (True, False)    # 只转不平动
    assert schema.JOINT_DIRECTION_FLAGS['prismatic'] == (False, True)   # 只平动不转
    assert schema.JOINT_DIRECTION_FLAGS['cylindrical'] == (True, True)  # 转动+平动
    assert schema.JOINT_DIRECTION_FLAGS['spherical'] == (True, False)   # 绕球心转


def test_static_methods():
    assert schema.STATIC_METHODS == frozenset({'weld', 'bond', 'bolt_fastening', 'rivet'})


def test_anchor_kinds():
    assert schema.ANCHOR_KINDS == frozenset({'plane', 'cylinder', 'cone', 'sphere', 'line', 'circle'})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_schema.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_intent'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/__init__.py
"""AI-CAD 意图层校验模块。纯标准库，无外部依赖。"""
from cad_intent.validate import validate_intent

__all__ = ['validate_intent']
```

```python
# src/cad_intent/schema.py
"""意图层 JSON 的常量表（受限特征子集 + 装配词汇）。"""

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

# 阵列方向
PATTERN_DIRECTIONS = frozenset({'x', 'y', 'z'})

# 静连接工艺
STATIC_METHODS = frozenset({'weld', 'bond', 'bolt_fastening', 'rivet'})

# 动连接运动副（机械原理六类）
JOINT_TYPES = frozenset({
    'revolute', 'prismatic', 'cylindrical', 'planar', 'spherical', 'helical',
})

# 运动副剩余自由度
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/test_schema.py -v`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/__init__.py src/cad_intent/schema.py tests/test_cad_intent/test_schema.py
git commit -m "feat(cad-intent): schema 常量表与包骨架"
```

---

### Task 2: 顶层检查 + 词法分离

**Files:**
- Create: `src/cad_intent/validate.py`
- Test: `tests/test_cad_intent/test_top_level.py`

**Interfaces:**
- Consumes: `schema.py` 的 `NODE_TYPES`/`ASSEMBLY_TYPES`
- Produces: `validate_intent(intent: dict) -> list[str]` 主入口（顶层检查 + 词法分离 + 分派 part/assembly 校验；本任务实现顶层检查与词法分离部分，part/assembly 具体校验留待 Task 3-5，先用占位返回）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_top_level.py
"""validate_intent 顶层检查与词法分离测试"""
from cad_intent import validate_intent


def test_not_an_object():
    errs = validate_intent([1, 2])
    assert any('必须是一个 JSON 对象' in e for e in errs)


def test_units_must_be_meters():
    intent = {'schema_version': 2, 'units': 'mm', 'parts': [], 'assembly': None}
    errs = validate_intent(intent)
    assert any("units 必须为 'meters'" in e for e in errs)


def test_units_ok():
    intent = {'schema_version': 2, 'units': 'meters', 'parts': [], 'assembly': None}
    errs = validate_intent(intent)
    assert not any('units' in e for e in errs)


def test_parts_required():
    intent = {'schema_version': 2, 'units': 'meters'}
    errs = validate_intent(intent)
    assert any('parts' in e and '非空数组' in e for e in errs)


def test_parts_empty():
    intent = {'schema_version': 2, 'units': 'meters', 'parts': []}
    errs = validate_intent(intent)
    assert any('parts' in e and '非空数组' in e for e in errs)


def test_ground_must_reference_part():
    intent = {
        'schema_version': 2, 'units': 'meters', 'ground': 'ghost',
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [], 'connections': []},
    }
    errs = validate_intent(intent)
    assert any("ground 'ghost'" in e and 'parts' in e for e in errs)


def test_ground_ok():
    intent = {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [], 'connections': []},
    }
    errs = validate_intent(intent)
    assert not any('ground' in e for e in errs)


def test_material_part_only():
    # 含 assembly 词汇的图不允许 material（sample 规则）
    intent = {
        'schema_version': 2, 'units': 'meters',
        'material': {'name': '6061', 'library': 'default'},
        'parts': [{'id': 'hub', 'type': 'extrude'}],
        'assembly': {'components': [{'id': 'c1'}], 'connections': []},
    }
    errs = validate_intent(intent)
    assert any('material' in e and '装配' in e for e in errs)


def test_word_vocabulary_separation():
    # part 词汇与 assembly 词汇不得混图
    intent = {
        'schema_version': 2, 'units': 'meters',
        'parts': [{'id': 'hub', 'type': 'sketch'}],
        'assembly': {'components': [{'id': 'c1'}], 'connections': []},
    }
    errs = validate_intent(intent)
    assert not any('混图' in e for e in errs)  # 正确分离，无错误
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_top_level.py -v`
Expected: FAIL（validate_intent 未定义或实现不完整）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/validate.py
"""validate_intent 主入口。"""

from cad_intent.schema import ASSEMBLY_TYPES, NODE_TYPES


def _has_assembly_vocab(parts):
    """检查 parts 数组是否含装配词汇（component/connection）。"""
    for node in parts or []:
        if node and isinstance(node, dict) and node.get('type') in ASSEMBLY_TYPES:
            return True
    return False


def validate_intent(intent):
    """校验意图层 JSON，返回错误列表（空 = 通过）。"""
    errors = []

    # 顶层对象检查
    if not isinstance(intent, dict):
        return ['intent 必须是一个 JSON 对象。']

    # units
    if intent.get('units') != 'meters':
        errors.append("units 必须为 'meters'（got " + repr(intent.get('units')) + '）。')

    # parts 非空数组
    parts = intent.get('parts')
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append('parts 必须是包含至少一个节点的非空数组。')

    # ground 引用存在性（跳过空 parts 场景）
    parts_ids = set()
    for node in parts or []:
        if node and isinstance(node, dict) and isinstance(node.get('id'), str):
            parts_ids.add(node['id'])
    ground = intent.get('ground')
    if ground is not None and parts_ids and ground not in parts_ids:
        errors.append("ground '" + str(ground) + "' 未在 parts 中找到。")

    # 词法分离：parts 数组不得混入装配类型节点
    if _has_assembly_vocab(parts):
        errors.append('词法分离违规：parts 数组中混入装配类型节点（component/connection 仅可出现在 assembly 字段）。')

    # material 仅 part 图（装配意图不得指定 material）
    material = intent.get('material')
    assembly = intent.get('assembly')
    if material is not None and assembly is not None:
        errors.append('material 仅限 part 图：装配图不允许指定 material。')

    return errors
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/test_top_level.py -v`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/validate.py tests/test_cad_intent/test_top_level.py
git commit -m "feat(cad-intent): 顶层检查与词法分离"
```

---

### Task 3: part 图校验（含顺序引用）

**Files:**
- Create: `src/cad_intent/graph.py`
- Create: `src/cad_intent/part_validator.py`
- Test: `tests/test_cad_intent/test_part_validator.py`

**Interfaces:**
- Consumes: `schema.py` 常量；`validate.py` 的 `validate_intent`
- Produces:
  - `graph.py`:
    - `check_datum(ref, label, errors)` — 校验基准面引用（`front/top/right` + 可选 offset）
    - `check_profile_prim(prim, label, errors)` — 校验草图图元（按 kind 查必需数字字段）
    - `check_sketch_ref(node, nodes, i, seen, label, errors)` — 校验 extrude 紧跟其 sketch
  - `part_validator.py`:
    - `validate_part_graph(parts, errors)` — 遍历 part 节点，按 type 分派校验；维护 `seen`（id→type）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_part_validator.py
"""part 图节点校验测试"""
from cad_intent import validate_intent


def _intent(parts):
    return {'schema_version': 2, 'units': 'meters', 'parts': parts, 'assembly': None}


def test_empty_sketch_profile():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': []}])
    errs = validate_intent(intent)
    assert any('profile' in e and '非空数组' in e for e in errs)


def test_bad_profile_kind():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'triangle'}]}])
    errs = validate_intent(intent)
    assert any('kind' in e and 'triangle' in e for e in errs)


def test_rectangle_missing_dimensions():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.1}]}])
    errs = validate_intent(intent)
    assert any('.height' in e for e in errs)


def test_circle_missing_diameter():
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'cx': 0, 'cy': 0}]}])
    errs = validate_intent(intent)
    assert any('.diameter' in e for e in errs)


def test_extrude_must_follow_sketch():
    # extrude 的 sketch 引用必须在紧邻前一位
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert not any('immediately' in e or '紧' in e for e in errs)


def test_extrude_not_immediate():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 's2', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert any('紧' in e and 's1' in e for e in errs)


def test_extrude_bad_operation():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'twist', 'end': 'blind', 'depth': 0.05},
    ])
    errs = validate_intent(intent)
    assert any("'operation' 必须为 'boss' 或 'cut'" in e for e in errs)


def test_extrude_blind_requires_depth():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind'},
    ])
    errs = validate_intent(intent)
    assert any('.depth' in e for e in errs)


def test_pattern_must_reference_feature():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
        {'id': 'p1', 'type': 'linear_pattern', 'feature': 'ghost', 'direction': 'x', 'spacing': 0.02, 'count': 3},
    ])
    errs = validate_intent(intent)
    assert any("'feature'" in e and '更早' in e for e in errs)


def test_fillet_requires_edges():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
        {'id': 'x1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.05},
        {'id': 'f1', 'type': 'fillet', 'radius': 0.01},
    ])
    errs = validate_intent(intent)
    assert any('edges' in e and '非空数组' in e for e in errs)


def test_duplicate_id():
    intent = _intent([
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'rectangle', 'width': 0.2, 'height': 0.2}]},
    ])
    errs = validate_intent(intent)
    assert any('重复' in e and 's1' in e for e in errs)


def test_sketch_without_ref_defaults_front():
    # 无 ref → 默认 front 基准面，合法（否则 test_assembly_none 会误报）
    intent = _intent([{'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}])
    errs = validate_intent(intent)
    assert errs == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_part_validator.py -v`
Expected: FAIL（part 校验未实现）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/graph.py
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
    return isinstance(v, (int, float)) and v == v and abs(v) != float('inf')


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
    elif not (prev and prev.get('id') == sk):
        errors.append(label + ": 必须紧跟在它的草图节点 '" + str(sk) + "' 之后。")
```

```python
# src/cad_intent/part_validator.py
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
                errors.append(label + ": 'profile' 必须是非空图元数组。")
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
                errors.append(label + ": 'depth'（正米数）为 blind 拉伸所必需。")
            if end == 'mid_plane' and not _is_pos(node.get('depth')):
                errors.append(label + ": 'depth'（总宽，正米数）为 mid_plane 所必需。")

        elif ntype in ('fillet', 'chamfer'):
            if not _is_pos(node.get('radius' if ntype == 'fillet' else 'distance')):
                errors.append(label + ": '" + ('radius' if ntype == 'fillet' else 'distance')
                              + "' 必须是正米数。")
            edges = node.get('edges')
            if not (isinstance(edges, list) and len(edges) > 0):
                errors.append(label + ": 'edges' 必须是非空边锚点数组。")
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
```

```python
# src/cad_intent/validate.py（更新：累积 Task 2 检查 + part 图校验）
"""validate_intent 主入口。"""

from cad_intent.part_validator import validate_part_graph
from cad_intent.schema import ASSEMBLY_TYPES


def _has_assembly_vocab(parts):
    for node in parts or []:
        if node and isinstance(node, dict) and node.get('type') in ASSEMBLY_TYPES:
            return True
    return False


def validate_intent(intent):
    """校验意图层 JSON，返回错误列表（空 = 通过）。"""
    errors = []
    if not isinstance(intent, dict):
        return ['intent 必须是一个 JSON 对象。']

    if intent.get('units') != 'meters':
        errors.append("units 必须为 'meters'（got " + repr(intent.get('units')) + '）。')

    parts = intent.get('parts')
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append('parts 必须是包含至少一个节点的非空数组。')
        return errors

    # 词法分离：parts 数组不得混入装配类型节点
    if _has_assembly_vocab(parts):
        errors.append('词法分离违规：parts 数组中混入装配类型节点（component/connection 仅可出现在 assembly 字段）。')

    parts_ids = set()
    for node in parts:
        if isinstance(node, dict) and isinstance(node.get('id'), str):
            parts_ids.add(node['id'])
    ground = intent.get('ground')
    if ground is not None and ground not in parts_ids:
        errors.append("ground '" + str(ground) + "' 未在 parts 中找到。")

    # material 仅 part 图（装配意图不得指定 material）
    material = intent.get('material')
    assembly = intent.get('assembly')
    if material is not None and assembly is not None:
        errors.append('material 仅限 part 图：装配图不允许指定 material。')

    # part 图校验
    validate_part_graph(parts, errors)

    return errors
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/ -v`
Expected: 全部通过（含 Task 2 的 9 个，无回归）

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/graph.py src/cad_intent/part_validator.py src/cad_intent/validate.py tests/test_cad_intent/test_part_validator.py
git commit -m "feat(cad-intent): part 图校验与顺序引用"
```

---

### Task 4: assembly 图校验（component + 静连接）

**Files:**
- Create: `src/cad_intent/assembly_validator.py`
- Test: `tests/test_cad_intent/test_assembly_static.py`

**Interfaces:**
- Consumes: `schema.py`（STATIC_METHODS/ANCHOR_KINDS）；`validate.py` 的 `validate_intent`
- Produces: `assembly_validator.py`:
  - `validate_assembly(assembly, parts_ids, errors)` — 校验 component 引用 + connections（静/动连接）；本任务实现 component + 静连接，动连接留待 Task 5

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_assembly_static.py
"""assembly 图：component 与静连接校验测试"""
from cad_intent import validate_intent


def _intent(assembly):
    return {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
        'assembly': assembly,
    }


def test_component_must_reference_part():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'ghost'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert any('part_ref' in e and 'ghost' in e for e in errs)


def test_component_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert not any('part_ref' in e for e in errs)


def test_connection_requires_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'method': 'weld'}],
    })
    errs = validate_intent(intent)
    assert any('type' in e and 'static|kinematic' in e for e in errs)


def test_bad_connection_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'magic'}],
    })
    errs = validate_intent(intent)
    assert any("type" in e and "static|kinematic" in e for e in errs)


def test_static_requires_method():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static'}],
    })
    errs = validate_intent(intent)
    assert any('method' in e for e in errs)


def test_static_bad_method():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static', 'method': 'glue_gun'}],
    })
    errs = validate_intent(intent)
    assert any('method' in e and 'glue_gun' in e for e in errs)


def test_static_requires_contact_and_position_and_fasteners():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'static', 'method': 'weld'}],
    })
    errs = validate_intent(intent)
    assert any('contact' in e for e in errs)
    assert any('position' in e for e in errs)


def test_static_bolt_requires_fastener_holes():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'bolt_fastening',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('fasteners' in e and 'holes' in e for e in errs)


def test_static_contact_anchor_kind():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'blob', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('anchor' in e and 'blob' in e for e in errs)


def test_static_weld_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_contact_part_must_reference_component():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{
            'type': 'static', 'method': 'weld',
            'contact': [{'part': 'ghost_comp', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
            'position': {'normal_axis': [0, 0, -1]},
        }],
    })
    errs = validate_intent(intent)
    assert any('part' in e and 'ghost_comp' in e for e in errs)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_assembly_static.py -v`
Expected: FAIL（assembly 校验未实现）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/assembly_validator.py
"""assembly 图校验：component 引用 + 静/动连接。"""

from cad_intent.schema import ANCHOR_KINDS, STATIC_METHODS


def _is_point3(v):
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(x, (int, float)) and x == x and abs(x) != float('inf') for x in v))


def _check_anchor(anchor, label, errors):
    """校验锚点 {kind, near, hint?}。"""
    if not isinstance(anchor, dict):
        errors.append(label + ' 必须是对象。')
        return
    kind = anchor.get('kind')
    if kind not in ANCHOR_KINDS:
        errors.append(label + ".kind '" + str(kind) + "' 不受支持（" + '|'.join(sorted(ANCHOR_KINDS)) + '）。')
    if not _is_point3(anchor.get('near')):
        errors.append(label + '.near 必须是 [x,y,z]（米）。')


def _check_contact(contact, label, comp_ids, errors):
    """校验 contact 元素：{part: comp_id, anchor: {...}}。"""
    if not isinstance(contact, dict):
        errors.append(label + ' 必须是对象。')
        return
    part = contact.get('part')
    if not (isinstance(part, str) and part):
        errors.append(label + ": 'part'（component id）必填。")
    elif part not in comp_ids:
        errors.append(label + ": 'part' '" + str(part) + "' 必须引用更早的 component 节点。")
    _check_anchor(contact.get('anchor'), label + '.anchor', errors)


def validate_assembly(assembly, parts_ids, errors):
    """校验 assembly 图。parts_ids: part 图节点 id 集合。"""
    if not isinstance(assembly, dict):
        errors.append('assembly 必须是对象。')
        return

    comp_ids = set()
    for j, comp in enumerate(assembly.get('components') or []):
        where = 'assembly.components[' + str(j) + ']'
        if not isinstance(comp, dict):
            errors.append(where + ' 必须是对象。')
            continue
        cid = comp.get('id')
        if not (isinstance(cid, str) and cid):
            errors.append(where + '.id 必填（非空字符串）。')
            continue
        comp_ids.add(cid)
        pref = comp.get('part_ref')
        if not (isinstance(pref, str) and pref):
            errors.append(where + ".part_ref（part 图节点 id）必填。")
        elif pref not in parts_ids:
            errors.append(where + ".part_ref '" + str(pref) + "' 未在 parts 中找到。")

    for k, conn in enumerate(assembly.get('connections') or []):
        where = 'assembly.connections[' + str(k) + ']'
        if not isinstance(conn, dict):
            errors.append(where + ' 必须是对象。')
            continue
        ctype = conn.get('type')
        if ctype not in ('static', 'kinematic'):
            errors.append(where + ": 'type' 必须是 static|kinematic（got '" + str(ctype) + "'）。")
            continue

        contact = conn.get('contact')
        if not (isinstance(contact, list) and len(contact) >= 1):
            errors.append(where + ": 'contact' 必须是非空接触面对数组。")
        else:
            for j, c in enumerate(contact):
                _check_contact(c, where + '.contact[' + str(j) + ']', comp_ids, errors)

        position = conn.get('position')
        if ctype == 'static':
            if not isinstance(position, dict):
                errors.append(where + ": 静连接必须携带 'position'（零件位置方向）。")
            method = conn.get('method')
            if not (isinstance(method, str) and method):
                errors.append(where + ": 静连接必须携带 'method'（工艺）。")
            elif method not in STATIC_METHODS:
                errors.append(where + ": 'method' '" + str(method) + "' 不受支持（"
                              + '|'.join(sorted(STATIC_METHODS)) + '）。')
            if method == 'bolt_fastening':
                fasteners = conn.get('fasteners')
                holes = fasteners.get('holes') if isinstance(fasteners, dict) else None
                if not (isinstance(holes, list) and len(holes) >= 1):
                    errors.append(where + ": bolt_fastening 必须携带 'fasteners.holes'（孔位锚点数组）。")
                else:
                    for j, h in enumerate(holes):
                        anchor = h.get('anchor') if isinstance(h, dict) else None
                        _check_anchor(anchor if anchor is not None else h,
                                      where + '.fasteners.holes[' + str(j) + ']', errors)
```

```python
# src/cad_intent/validate.py（更新：装配校验分派）
"""validate_intent 主入口。"""

from cad_intent.part_validator import validate_part_graph
from cad_intent.assembly_validator import validate_assembly
from cad_intent.schema import ASSEMBLY_TYPES


def _has_assembly_vocab(parts):
    for node in parts or []:
        if node and isinstance(node, dict) and node.get('type') in ASSEMBLY_TYPES:
            return True
    return False


def validate_intent(intent):
    """校验意图层 JSON，返回错误列表（空 = 通过）。"""
    errors = []
    if not isinstance(intent, dict):
        return ['intent 必须是一个 JSON 对象。']

    if intent.get('units') != 'meters':
        errors.append("units 必须为 'meters'（got " + repr(intent.get('units')) + '）。')

    parts = intent.get('parts')
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append('parts 必须是包含至少一个节点的非空数组。')
        return errors

    parts_ids = set()
    for node in parts:
        if isinstance(node, dict) and isinstance(node.get('id'), str):
            parts_ids.add(node['id'])
    ground = intent.get('ground')
    if ground is not None and ground not in parts_ids:
        errors.append("ground '" + str(ground) + "' 未在 parts 中找到。")

    # 词法分离：parts 数组不得混入装配类型节点
    if _has_assembly_vocab(parts):
        errors.append('词法分离违规：parts 数组中混入装配类型节点（component/connection 仅可出现在 assembly 字段）。')

    # material 仅 part 图（装配意图不得指定 material）
    material = intent.get('material')
    assembly = intent.get('assembly')
    if material is not None and assembly is not None:
        errors.append('material 仅限 part 图：装配图不允许指定 material。')

    validate_part_graph(parts, errors)

    if assembly is not None:
        validate_assembly(assembly, parts_ids, errors)

    return errors
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/ -v`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/assembly_validator.py src/cad_intent/validate.py tests/test_cad_intent/test_assembly_static.py
git commit -m "feat(cad-intent): component 与静连接校验"
```

---

### Task 5: 动连接校验（运动副查表 + 四层装配校验）

**Files:**
- Modify: `src/cad_intent/assembly_validator.py`
- Create: `src/cad_intent/assembly_graph.py`
- Test: `tests/test_cad_intent/test_assembly_kinematic.py`

**Interfaces:**
- Consumes: `schema.py`（JOINT_TYPES/JOINT_DOF/JOINT_CONTACT_KINDS）；`assembly_validator.py` 的 `_check_contact`
- Produces:
  - `assembly_graph.py`:
    - `check_connectivity(assembly, ground_component_id, errors)` — 可达性 + 无环性（从基准 component BFS）
  - `assembly_validator.py` 更新：动连接校验（joint 合法性 + DOF 匹配 + 接触面 kind 匹配）+ 装配四层校验分派

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_assembly_kinematic.py
"""assembly 图：动连接校验与四层装配校验测试"""
from cad_intent import validate_intent


def _intent(assembly, parts=None, ground='hub'):
    parts = parts or [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}]
    return {'schema_version': 2, 'units': 'meters', 'ground': ground, 'parts': parts, 'assembly': assembly}


def _cylin_conn(part_a, part_b):
    return {'type': 'kinematic', 'joint': 'cylindrical',
            'contact': [
                {'part': part_a, 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                {'part': part_b, 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0.02]}},
            ],
            'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}


def test_bad_joint_type():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'turbo_gear'}],
    })
    errs = validate_intent(intent)
    assert any('joint' in e and 'turbo_gear' in e for e in errs)


def test_kinematic_requires_joint():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic'}],
    })
    errs = validate_intent(intent)
    assert any('joint' in e and '运动副' in e for e in errs)


def test_kinematic_requires_direction():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute'}],
    })
    errs = validate_intent(intent)
    assert any('direction' in e for e in errs)


def test_revolute_contact_kind_mismatch():
    # 转动副要求圆柱接触，但给了平面
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'plane', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}}],
    })
    errs = validate_intent(intent)
    assert any('接触面' in e and 'cylinder' in e for e in errs)


def test_cylindrical_ok():
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [_cylin_conn('c1', 'c2')],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_revolute_wrong_direction_flags():
    # 转动副只允许旋转，不允许平动标记（机械原理：约束形式决定运动方向）
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'revolute',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}],
    })
    errs = validate_intent(intent)
    assert any('rotation' in e and 'translation' in e for e in errs)


def test_dof_translation_flag_matches_helical():
    # 螺旋副剩余 1 DOF（旋转+平移联动），direction 需标记
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [{'type': 'kinematic', 'joint': 'helical',
                         'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                                     {'part': 'c2', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
                         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': True}}],
    })
    errs = validate_intent(intent)
    assert not any('connection' in e for e in errs)


def test_ground_unreachable_component():
    # 两个 component 无连接，一个不可达
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert any('可达' in e and 'c2' in e for e in errs)


def test_connection_cycle_detected():
    # 连接图有环（3 个 component 成环），无环性检测
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}, {'id': 'c3', 'part_ref': 'hub'}],
        'connections': [_cylin_conn('c1', 'c2'), _cylin_conn('c2', 'c3'), _cylin_conn('c3', 'c1')],
    })
    errs = validate_intent(intent)
    assert any('环' in e for e in errs)


def test_ground_with_no_connections_ok_for_single():
    # 单零件无装配连接：可达性不报错（ground 自身可达）
    intent = _intent({
        'components': [{'id': 'c1', 'part_ref': 'hub'}],
        'connections': [],
    })
    errs = validate_intent(intent)
    assert not any('可达' in e for e in errs)


def test_assembly_none_is_part_only():
    # assembly 为 None 表示纯 part 图
    intent = {'schema_version': 2, 'units': 'meters', 'ground': 'hub',
              'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
              'assembly': None}
    errs = validate_intent(intent)
    assert errs == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_assembly_kinematic.py -v`
Expected: FAIL（动连接校验未实现）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/assembly_graph.py
"""装配连接图分析：可达性 + 无环性。"""


def check_connectivity(assembly, ground_component_id, errors):
    """可达性 + 无环性：从基准 component 出发遍历连接图。"""
    if not isinstance(assembly, dict):
        return
    comp_ids = set()
    for comp in assembly.get('components') or []:
        if isinstance(comp, dict) and isinstance(comp.get('id'), str):
            comp_ids.add(comp['id'])
    if not comp_ids:
        return

    # 邻接表：每个 connection 视为一条边（contact 第一零件连其余，多接触面不产生多条边）
    adj = {cid: set() for cid in comp_ids}
    edge_count = 0
    for conn in assembly.get('connections') or []:
        if not isinstance(conn, dict):
            continue
        parts_in = []
        for c in conn.get('contact') or []:
            if isinstance(c, dict) and isinstance(c.get('part'), str):
                parts_in.append(c['part'])
        if len(parts_in) < 2:
            continue
        a = parts_in[0]
        for b in parts_in[1:]:
            if a in adj and b in adj and b not in adj[a]:
                adj[a].add(b)
                adj[b].add(a)
        edge_count += 1

    # 无环性：无环装配的连接图为森林，边数 < 节点数
    if edge_count >= len(comp_ids):
        errors.append('连接图存在环：无环装配要求连接图为树（边数 ' + str(edge_count)
                      + ' >= 节点数 ' + str(len(comp_ids)) + '）。')

    # 可达性：从基准零件对应 component BFS
    if ground_component_id not in adj:
        if comp_ids:
            errors.append("基准 component '" + str(ground_component_id) + "' 未在 components 中找到。")
        return
    visited = set()
    stack = [ground_component_id]
    while stack:
        cur = stack.pop()
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in adj[cur]:
            if nxt not in visited:
                stack.append(nxt)
    for cid in comp_ids:
        if cid not in visited:
            errors.append("component '" + str(cid) + "' 不可达：未通过任何连接与基准零件连通。")
```

```python
# src/cad_intent/assembly_validator.py（更新：动连接 + 四层分派）
"""assembly 图校验：component 引用 + 静/动连接 + 四层装配校验。"""

from cad_intent.schema import (
    ANCHOR_KINDS, JOINT_CONTACT_KINDS, JOINT_DIRECTION_FLAGS, JOINT_TYPES, STATIC_METHODS,
)
from cad_intent.assembly_graph import check_connectivity


def _is_point3(v):
    return (isinstance(v, list) and len(v) == 3
            and all(isinstance(x, (int, float)) and x == x and abs(x) != float('inf') for x in v))


def _check_anchor(anchor, label, errors):
    if not isinstance(anchor, dict):
        errors.append(label + ' 必须是对象。')
        return
    kind = anchor.get('kind')
    if kind not in ANCHOR_KINDS:
        errors.append(label + ".kind '" + str(kind) + "' 不受支持（" + '|'.join(sorted(ANCHOR_KINDS)) + '）。')
    if not _is_point3(anchor.get('near')):
        errors.append(label + '.near 必须是 [x,y,z]（米）。')


def _check_contact(contact, label, comp_ids, errors):
    if not isinstance(contact, dict):
        errors.append(label + ' 必须是对象。')
        return
    part = contact.get('part')
    if not (isinstance(part, str) and part):
        errors.append(label + ": 'part'（component id）必填。")
    elif part not in comp_ids:
        errors.append(label + ": 'part' '" + str(part) + "' 必须引用更早的 component 节点。")
    _check_anchor(contact.get('anchor'), label + '.anchor', errors)


def _check_kinematic(conn, where, comp_ids, errors):
    """动连接校验：joint 合法性 + 运动方向与运动副匹配 + 接触面 kind 匹配。"""
    joint = conn.get('joint')
    if not (isinstance(joint, str) and joint):
        errors.append(where + ": 动连接必须携带 'joint'（运动副）。")
        return
    if joint not in JOINT_TYPES:
        errors.append(where + ": 'joint' '" + str(joint) + "' 不受支持（"
                      + '|'.join(sorted(JOINT_TYPES)) + '）。')
        return
    direction = conn.get('direction')
    if not isinstance(direction, dict):
        errors.append(where + ": 动连接必须携带 'direction'（运动方向）。")
        return
    # 接触面 kind 匹配运动副要求
    contact = conn.get('contact') or []
    required_kinds = JOINT_CONTACT_KINDS.get(joint, frozenset())
    for j, c in enumerate(contact):
        anchor = c.get('anchor') if isinstance(c, dict) else None
        kind = anchor.get('kind') if isinstance(anchor, dict) else None
        if kind is not None and kind not in required_kinds:
            errors.append(where + '.contact[' + str(j) + ']: 运动副 ' + str(joint)
                          + ' 要求接触面 kind ∈ ' + '|'.join(sorted(required_kinds))
                          + "（got '" + str(kind) + "'）。")
    # 运动方向与运动副查表匹配（机械原理：约束形式决定运动方向）
    rotation = direction.get('rotation')
    translation = direction.get('translation')
    exp_rot, exp_trans = JOINT_DIRECTION_FLAGS.get(joint, (True, True))
    if not (isinstance(rotation, bool) and isinstance(translation, bool)):
        errors.append(where + ': direction.rotation 与 direction.translation 必须是布尔值。')
    elif (rotation, translation) != (exp_rot, exp_trans):
        errors.append(where + ': 运动副 ' + str(joint) + ' 的运动方向应为 rotation='
                      + str(exp_rot) + ', translation=' + str(exp_trans) + '。')


def validate_assembly(assembly, parts_ids, ground_part, errors):
    """校验 assembly 图。parts_ids: part id 集合；ground_part: 顶层基准零件 id。"""
    if not isinstance(assembly, dict):
        errors.append('assembly 必须是对象。')
        return

    comp_ids = set()
    for j, comp in enumerate(assembly.get('components') or []):
        where = 'assembly.components[' + str(j) + ']'
        if not isinstance(comp, dict):
            errors.append(where + ' 必须是对象。')
            continue
        cid = comp.get('id')
        if not (isinstance(cid, str) and cid):
            errors.append(where + '.id 必填（非空字符串）。')
            continue
        comp_ids.add(cid)
        pref = comp.get('part_ref')
        if not (isinstance(pref, str) and pref):
            errors.append(where + ".part_ref（part 图节点 id）必填。")
        elif pref not in parts_ids:
            errors.append(where + ".part_ref '" + str(pref) + "' 未在 parts 中找到。")

    for k, conn in enumerate(assembly.get('connections') or []):
        where = 'assembly.connections[' + str(k) + ']'
        if not isinstance(conn, dict):
            errors.append(where + ' 必须是对象。')
            continue
        ctype = conn.get('type')
        if ctype not in ('static', 'kinematic'):
            errors.append(where + ": 'type' 必须是 static|kinematic（got '" + str(ctype) + "'）。")
            continue

        contact = conn.get('contact')
        if not (isinstance(contact, list) and len(contact) >= 1):
            errors.append(where + ": 'contact' 必须是非空接触面对数组。")
        else:
            for j, c in enumerate(contact):
                _check_contact(c, where + '.contact[' + str(j) + ']', comp_ids, errors)

        position = conn.get('position')
        if ctype == 'static':
            if not isinstance(position, dict):
                errors.append(where + ": 静连接必须携带 'position'（零件位置方向）。")
            method = conn.get('method')
            if not (isinstance(method, str) and method):
                errors.append(where + ": 静连接必须携带 'method'（工艺）。")
            elif method not in STATIC_METHODS:
                errors.append(where + ": 'method' '" + str(method) + "' 不受支持（"
                              + '|'.join(sorted(STATIC_METHODS)) + '）。')
            if method == 'bolt_fastening':
                fasteners = conn.get('fasteners')
                holes = fasteners.get('holes') if isinstance(fasteners, dict) else None
                if not (isinstance(holes, list) and len(holes) >= 1):
                    errors.append(where + ": bolt_fastening 必须携带 'fasteners.holes'（孔位锚点数组）。")
                else:
                    for j, h in enumerate(holes):
                        anchor = h.get('anchor') if isinstance(h, dict) else None
                        _check_anchor(anchor if anchor is not None else h,
                                      where + '.fasteners.holes[' + str(j) + ']', errors)
        else:  # kinematic
            _check_kinematic(conn, where, comp_ids, errors)

    # 四层校验：可达性 + 无环性
    ground_comp = None
    for comp in assembly.get('components') or []:
        if isinstance(comp, dict) and comp.get('part_ref') == ground_part:
            ground_comp = comp.get('id')
            break
    if ground_comp is None:
        comps = assembly.get('components') or []
        if comps and isinstance(comps[0], dict):
            ground_comp = comps[0].get('id')
    check_connectivity(assembly, ground_comp, errors)
```

```python
# src/cad_intent/validate.py（更新：传 ground 给装配校验）
"""validate_intent 主入口。"""

from cad_intent.part_validator import validate_part_graph
from cad_intent.assembly_validator import validate_assembly
from cad_intent.schema import ASSEMBLY_TYPES


def _has_assembly_vocab(parts):
    for node in parts or []:
        if node and isinstance(node, dict) and node.get('type') in ASSEMBLY_TYPES:
            return True
    return False


def validate_intent(intent):
    """校验意图层 JSON，返回错误列表（空 = 通过）。"""
    errors = []
    if not isinstance(intent, dict):
        return ['intent 必须是一个 JSON 对象。']

    if intent.get('units') != 'meters':
        errors.append("units 必须为 'meters'（got " + repr(intent.get('units')) + '）。')

    parts = intent.get('parts')
    if not isinstance(parts, list) or len(parts) == 0:
        errors.append('parts 必须是包含至少一个节点的非空数组。')
        return errors

    parts_ids = set()
    for node in parts:
        if isinstance(node, dict) and isinstance(node.get('id'), str):
            parts_ids.add(node['id'])
    ground = intent.get('ground')
    if ground is not None and ground not in parts_ids:
        errors.append("ground '" + str(ground) + "' 未在 parts 中找到。")

    # 词法分离：parts 数组不得混入装配类型节点
    if _has_assembly_vocab(parts):
        errors.append('词法分离违规：parts 数组中混入装配类型节点（component/connection 仅可出现在 assembly 字段）。')

    # material 仅 part 图（装配意图不得指定 material）
    material = intent.get('material')
    assembly = intent.get('assembly')
    if material is not None and assembly is not None:
        errors.append('material 仅限 part 图：装配图不允许指定 material。')

    validate_part_graph(parts, errors)

    if assembly is not None:
        validate_assembly(assembly, parts_ids, ground, errors)

    return errors
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/ -v`
Expected: 全部通过（含 Task 2-4，无回归）

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/assembly_validator.py src/cad_intent/assembly_graph.py src/cad_intent/validate.py tests/test_cad_intent/test_assembly_kinematic.py
git commit -m "feat(cad-intent): 动连接校验与装配四层校验"
```

---

### Task 6: Top-down 三层细化校验（refine_of + frozen 一致性）

**Files:**
- Create: `src/cad_intent/refinement.py`
- Modify: `src/cad_intent/validate.py`
- Test: `tests/test_cad_intent/test_refinement.py`

**Interfaces:**
- Consumes: `validate_intent`
- Produces:
  - `refinement.py`:
    - `validate_refinement(previous: dict, next_intent: dict, errors)` — 校验细化提交不违反冻结约束
    - `frozen_constraints(intent) -> dict` — 提取 Level 0/1 冻结约束（ground、units、material、part 顶层尺寸、装配拓扑）
    - `check_frozen_consistency(prev, next_, errors)` — 比对冻结约束是否被修改

**细化规则**（本任务实现的基础版）：
- `next_intent` 的 `units`/`ground`/`material` 必须与 `previous` 一致（已冻结）
- part 图：已有节点 id 集合不得缩减（细化只能加节点，不能删已定义零件）
- 装配拓扑：connections 中已有的连接不得改变 type/joint/method（frozen）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_intent/test_refinement.py
"""Top-down 三层细化：frozen 约束一致性测试"""
from cad_intent.validate import validate_intent
from cad_intent.refinement import validate_refinement


def _base_intent():
    return {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]},
                  {'id': 'x1', 'type': 'extrude', 'sketch': 'hub', 'operation': 'boss', 'end': 'blind', 'depth': 0.05}],
        'assembly': None,
    }


def test_units_frozen():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['units'] = 'mm'
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('units' in e and '冻结' in e for e in errs)


def test_ground_frozen():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['ground'] = 'other'
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('ground' in e and '冻结' in e for e in errs)


def test_material_frozen():
    prev = _base_intent()
    prev['material'] = {'name': '6061', 'library': 'default'}
    nxt = dict(_base_intent())
    nxt['material'] = {'name': 'ABS', 'library': 'default'}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('material' in e and '冻结' in e for e in errs)


def test_add_part_allowed():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['parts'] = prev['parts'] + [{'id': 'cap', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.12}]}]
    errs = []
    validate_refinement(prev, nxt, errs)
    assert not any('已冻结' in e and '删除' in e for e in errs)


def test_remove_part_blocked():
    prev = _base_intent()
    nxt = dict(_base_intent())
    nxt['parts'] = [prev['parts'][0]]  # 删掉了 x1
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('已冻结' in e and 'x1' in e for e in errs)


def test_connection_joint_frozen():
    conn = {'type': 'kinematic', 'joint': 'revolute',
            'contact': [{'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}},
                        {'part': 'c2', 'anchor': {'kind': 'cylinder', 'near': [0, 0, 0]}}],
            'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}}
    prev = {
        'schema_version': 2, 'units': 'meters', 'ground': 'hub',
        'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
        'assembly': {'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
                     'connections': [conn]},
    }
    nxt = {'schema_version': 2, 'units': 'meters', 'ground': 'hub',
           'parts': [{'id': 'hub', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.1}]}],
           'assembly': {'components': [{'id': 'c1', 'part_ref': 'hub'}, {'id': 'c2', 'part_ref': 'hub'}],
                        'connections': [dict(conn, joint='prismatic')]}}
    errs = []
    validate_refinement(prev, nxt, errs)
    assert any('joint' in e and '冻结' in e for e in errs)


def test_full_intent_still_validates():
    intent = _base_intent()
    assert validate_intent(intent) == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_intent/test_refinement.py -v`
Expected: FAIL（refinement 未实现）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_intent/refinement.py
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
```

```python
# src/cad_intent/__init__.py（更新：导出 refinement）
"""AI-CAD 意图层校验模块。纯标准库，无外部依赖。"""
from cad_intent.validate import validate_intent
from cad_intent.refinement import validate_refinement

__all__ = ['validate_intent', 'validate_refinement']
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_intent/ -v`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/cad_intent/refinement.py src/cad_intent/__init__.py tests/test_cad_intent/test_refinement.py
git commit -m "feat(cad-intent): Top-down 三层细化 frozen 约束校验"
```

---

### Task 7: 全量回归 + 收尾

**Files:**
- Create: `src/cad_intent/__init__.py`（已存在，无改动）
- Create: `pytest.ini`（配置测试路径）
- Create: `README.md`（模块说明，可选）

**Interfaces:**
- 无新接口

- [ ] **Step 1: 写全量回归运行配置**

```ini
# pytest.ini
[pytest]
testpaths = tests
python_files = test_*.py
```

- [ ] **Step 2: 全量运行**

Run: `python3 -m pytest -v`
Expected: 全部通过（约 59 个测试：schema 9 + top_level 9 + part 12 + assembly_static 11 + assembly_kinematic 11 + refinement 7）

- [ ] **Step 3: 统计覆盖断言**

Run: `python3 -m pytest --cov=cad_intent 2>&1 | tail -5`
Expected: 报告显示覆盖；若无 pytest-cov 则跳过此步，用 `python3 -m pytest -v` 结果即可

- [ ] **Step 4: 提交**

```bash
git add pytest.ini
git commit -m "chore(cad-intent): 测试配置与收尾"
```

---

## Self-Review

**1. Spec coverage（对照设计文档）：**
- §4.1 顶层检查（units/ground/material）→ Task 2 ✅
- §4.2 part 词汇表 + 顺序引用 → Task 3 ✅
- §4.3 assembly 词汇（component/静动连接）→ Task 4-5 ✅
- §4.4 装配约束机制（锚点格式/运动副查表/词法分离）→ Task 1（schema）+ Task 5 ✅
- §4.5 校验器四层（可达/无环/静完备/动一致）→ Task 5 ✅
- §4.6 Top-down 三层细化（refine_of + frozen）→ Task 6 ✅

**2. Placeholder scan：** 无 TBD/TODO；所有步骤含完整代码。

**3. Type consistency：**
- `validate_intent(intent) -> list[str]` 全计划一致 ✅
- `validate_assembly(assembly, parts_ids, ground_part, errors)` 在 Task 4/5 签名一致（Task 5 加了 ground_part 参数，Task 4 的调用在 Task 5 中一并更新）✅
- `_check_contact(contact, label, comp_ids, errors)` 一致 ✅
- `JOINT_DOF`/`JOINT_CONTACT_KINDS`/`JOINT_DIRECTION_FLAGS` 在 schema.py 定义、Task 5 使用，键名一致 ✅
- `check_connectivity(assembly, ground_component_id, errors)` 定义于 Task 5 assembly_graph.py，validate_assembly 内联查找基准 component 后调用 ✅

**注意点（已知有意为之）：** `validate.py` 在 Task 2/3/4/5 逐步演进（先顶层→加 part→加 assembly→加 ground 传递），**每次演进必须保留词法分离与 material 检查**（cumulative 演进），执行时按序完成，勿跳步。`check_connectivity` 的环检测为启发式（`边数 >= 节点数` 即报环），静连接一个连接多个接触面不会产生假阳性。

---

## Execution Handoff

Plan A 已保存到 `docs/superpowers/plans/2026-08-17-plan-a-intent-validator.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个任务派发独立 subagent，任务间审查，迭代快
2. **Inline Execution** — 本会话内用 executing-plans 批量执行，带检查点

选择哪种？
