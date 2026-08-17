# Plan B: build123d 代码生成 + OCCT 编译管线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把校验通过的意图层 JSON（Plan A 产出）编译为 Plan B 的双交付物：① build123d 建模语言 Python 源码（可编辑，类比 Zoo 的 KCL）+ ② 由源码编译的可编辑 STEP 文件。

**Architecture:** 三阶段：零件边界切分 + 确定性执行（`split_parts` + `build_part`，用真实 build123d 建几何以计算 through_all 深度与解析锚点）→ 锚点解析（`anchor_resolver` 用几何启发式把语义锚点映射为 Joint/Location/Axis）→ 源码发射与子进程编译（`emit_*` 生成交付物①，`compile_sources` 以子进程 `python3 xxx.py` 导出交付物②）。装配用 `connect_to` + `Compound`。**发射字符串与 in-process 执行走同一份 `_build_plan`，保证两侧语义一致。**

**Tech Stack:** Python 3.10（miniconda，`python3` 已在 PATH）+ build123d 0.11.1 + cadquery-ocp-novtk 7.9.3.1.1 + OCCT，pytest 9.1.1。依赖已安装并实测。

## Global Constraints

- `cad_codegen` 可依赖 build123d 与 OCCT（不同于 Plan A 的纯标准库约束）；但**不依赖 Plan A 运行时**——`generate_sources` 内对 `cad_intent.validate_intent` 做惰性导入（Tasks 1-6 全部测试不依赖 Plan A；Task 7 端到端测试需 Plan A 已执行并含前置修订）
- 单位强制米（`STEP_UNIT = Unit.M`），与 Plan A 一致
- **v1 代码生成范围外一律抛 `CodegenError`（明确报错），不得静默降级**；校验器仍接受、代码生成显式拒绝的项见 `V1_NOT_SUPPORTED` 注释
- 错误信息格式：`CodegenError('...')`，中文，指出节点 id 或特性名
- 所有常量集中在 `profile.py`；发射模板（字符串）与执行（bd 对象）从同一常量取，严禁两处各自硬编码漂移
- 代码中文注释（项目风格同 Plan A）
- 提交粒度：每任务一步一提交

## 前置修订：Plan A 唯一 schema 增补（执行 Plan B 前先做，1 次提交）

**背景：** 零件归属改用「零件边界切分法」（各零件特征链连续排布、`part_ref` 为链首节点 id、每节点归属它之前最近的 part_ref），**不再需要**为 fillet/chamfer 增加 `feature` 引用（原设计讨论中的可达性归属方案已放弃，见 Self-Review）。代码生成需要且仅需要一处 Plan A 增补：**`circular_pattern` 增加 `radius` 字段**（发射 `PolarLocations(radius, count)` 需要，Plan A 校验器当前不校验该字段）。

- [ ] **Step 1: 修改校验器**

```python
# src/cad_intent/part_validator.py —— 在 circular_pattern 分支（现第 650-662 行附近）补 radius 校验
# 现代码（Plan A 已提交）：
#         elif ntype in ('linear_pattern', 'circular_pattern'):
#             tgt = node.get('feature')
#             ...
#             if ntype == 'linear_pattern':
#                 ...
#             if not (_is_int(node.get('count')) and node['count'] >= 2):
#                 errors.append(label + ": 'count' 必须是 >= 2 的整数。")
#
# 在 `if ntype == 'linear_pattern':` 块之后、count 检查之前，追加：
            if ntype == 'circular_pattern':
                if not _is_pos(node.get('radius')):
                    errors.append(label + ": 'radius'（阵列半径，米）为 circular_pattern 所必需。")
```

- [ ] **Step 2: 新增测试**

```python
# tests/test_cad_intent/test_part_validator.py —— 文件末尾追加
def test_circular_pattern_requires_radius():
    parts = [
        {'id': 's1', 'type': 'sketch', 'profile': [{'kind': 'circle', 'diameter': 0.01}]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss', 'end': 'blind', 'depth': 0.02},
        {'id': 'p1', 'type': 'circular_pattern', 'feature': 'n1', 'count': 4},
    ]
    errs = validate_intent({'schema_version': 2, 'units': 'meters', 'parts': parts})
    assert any("'radius'" in e and 'array' in e for e in errs)

    parts[-1]['radius'] = 0.05
    errs = validate_intent({'schema_version': 2, 'units': 'meters', 'parts': parts})
    assert not any("'radius'" in e for e in errs)
```

- [ ] **Step 3: 运行测试**

Run: `python3 -m pytest tests/test_cad_intent/test_part_validator.py -v`
Expected: 全部通过（新增 1 个 + 既有）

- [ ] **Step 4: 提交**

```bash
git add src/cad_intent/part_validator.py tests/test_cad_intent/test_part_validator.py
git commit -m "feat(cad-intent): circular_pattern 增加 radius 校验（Plan B 前置）"
```

## 已实测验证的 build123d 0.11.1 API 表（executor 不必再踩坑）

以下每条都经过真实 build123d 执行验证，直接照用。

| 用途 | 已验证 API | 备注 |
|---|---|---|
| 导出单位 | `export_step(shape, path, unit=bd.Unit.M)` | STEP 头为 `ISO-10303-21;` |
| 草图上下文 | `with BuildSketch(Location((0,0,0.0))):` | 显式 Location 形式可打印、可执行 |
| 图元 | `Rectangle(w, h)`、`Circle(radius)` | Circle 传**半径**（= diameter/2） |
| **多段线轮廓** | `Polygon((x1,y1), (x2,y2), ...)` | **自动闭合**；`line` 图元序列归组为一个 Polygon |
| 拉伸 | `extrude(amount=0.02)`、`extrude(amount=0.02, both=True)` | mid_plane |
| 切除 | `extrude(amount=d, mode=bd.Mode.SUBTRACT)` | 负深度、through_all 用计算深度 |
| 圆角/倒角 | `fillet([e], radius=0.01)`、`chamfer([e], length=0.01)` | **模块级函数**，第一个参数传 Edge 列表；chamfer 的 kwarg 名是 `length` |
| **线性阵列（0.11.1 关键）** | `with BuildSketch(loc): with GridLocations(x_sp, y_sp, x_cnt, y_cnt): Circle(...)` 后 `extrude(...)` | **Locations 上下文必须在 BuildSketch 内部**才生效；外层 `with GridLocations(): with BuildSketch():` 在 0.11.1 失效（仅 1 个副本，boss 甚至静默消失） |
| 圆形阵列 | 同上，`with PolarLocations(radius, count):` | 同约束 |
| 镜像 | `mirror(about=Plane((0,0,0),(1,0,0),(0,0,1)))` | `mirror(objects=None, about=Plane, mode=ADD)`；第一个参数是要镜像的对象（默认当前实体），`about` 才是平面——**传 Face 当平面是错的**（无操作/替换） |
| 关节类 | `RevoluteJoint('a', part, axis=Axis((p),(d)))`、`LinearJoint('a', part, axis=Axis(...))`、`CylindricalJoint('a', part, axis=Axis(...))`、`RigidJoint('a', part, Location((p),(o)))`、`BallJoint('a', part, Location(...))` | axis 系关节用 `axis=` 关键字；Location 系关节第三个位置参数 |
| 后置关节 | `part.part.joints['a0'] = RevoluteJoint('a0', part.part, axis=...)` | `with BuildPart()` 退出后仍可写 |
| 装配 | `a.joints['c1'].connect_to(b.joints['c1'])`；`Compound(children=[a, b])` | connect_to 以第一个零件为基准移动第二个 |
| 面几何 | `face.geom_type`（枚举）、`face.center_location`、`face.axis_of_rotation`（.position/.direction）、`face.center()`、`face.distance_to(Vector)` | 圆柱轴方向可能为 ±Z（revolute 无方向敏感性） |
| 边拾取 | `[e for e in part.edges() if e.distance_to(near) < tol]` 后 `max(key=length)` | `sort_by_distance()[0]` 不可靠 |
| 基准面旋转 | front 无旋转；top=`Location((0,0,0),(0,90,0))`；right=`Location((0,0,0),(0,0,90))` | 法向分别为 +Z/+Y/+X |
| 数值序列化 | `Location(position, orientation)` 往返一致；`loc.orientation` 是 3 元组 | |
| in-process 多 build | 每个 `with BuildPart()` 独立；`part.bounding_box()` 在 builder 上可用 | through_all 深度用 |

**0.11.1 验证结论（影响发射模板）：**
1. **阵列 = 吸收被阵列的 sketch+extrude**：`linear_pattern`/`circular_pattern` 的 `feature`（必须是 extrude，且紧跟其后）与其 sketch 被吸收进一个带 `GridLocations`/`PolarLocations` 的 `BuildSketch`，然后原 extrude 紧随其后：
   ```python
   with BuildSketch(Location((0, 0, 0.0))):
       with GridLocations(0.05, 1, 2, 1):
           Circle(0.015)
   extrude(amount=0.03, mode=Mode.SUBTRACT)
   ```
2. `line` 图元：连续 line 段去重端点后归组为 `Polygon(*pts)`；单条 line 或与圆/矩形混用 → `CodegenError`。
3. `mirror`：整实体镜像，`mirror(about=Plane(...))`，基准面与 `MIRROR_PLANES` 表一致。

## 文件结构

```
pytest.ini                      # Task 1 创建：pythonpath = src（Plan A 的 import 也靠它）
src/cad_codegen/
├── __init__.py                 # 惰性导出 generate_sources / compile_sources / CompileResult
├── profile.py                  # 常量表：_fmt、DATUM_LOCATIONS、MIRROR_PLANES、JOINT_CLASSES 等
├── part_gen.py                 # CodegenError、_build_plan、split_parts、build_part(+exec)、
│                               #   emit_part_source(+emit)、generate_part_source、pick_edges、JointSpec
├── anchor_resolver.py          # ResolvedAnchor、pick_face、resolve_anchor
├── compiler.py                 # CompileResult、compile_sources（子进程编译）
├── assembly_gen.py             # emit_assembly_source
└── orchestrator.py             # generate_sources（校验→切分→锚点→发射）
tests/test_cad_codegen/
├── test_profile.py             # Task 1
├── test_part_build.py          # Task 2
├── test_emit_part.py           # Task 3
├── test_anchor_resolver.py     # Task 4
├── test_part_compile.py        # Task 5
├── test_assembly_gen.py        # Task 6
└── test_e2e.py                 # Task 7
```

**跨任务接口契约（先读后写，避免签名漂移）：**
- `profile.py`: `_fmt(v) -> str`；`DATUM_LOCATIONS: dict[str, str]`（含 `{off}`）；`MIRROR_PLANES: dict[str, str]`；`MIRROR_PLANE_TUP: dict[str, tuple]`；`JOINT_CLASSES / JOINT_ANCHOR_CLASS: dict`；`STEP_UNIT / EDGE_TOL / FACE_TOL / THROUGH_MARGIN: float`
- `part_gen.py`:
  - `CodegenError(ValueError)`
  - `split_parts(parts: list, part_refs: list[str]) -> dict[str, list]` — 按零件边界切分
  - `_build_plan(nodes) -> list[{'op': 'node', 'node': ...} | {'op': 'pattern', 'node', 'sketch', 'extrude'}]`
  - `build_part(nodes) -> tuple[bd.Part, dict[str, float]]` — (实体, through 深度表)
  - `emit_part_source(part_id, nodes, joint_specs, amounts=None) -> str`
  - `generate_part_source(part_id, nodes, joint_specs) -> str`
  - `pick_edges(shape, near, tol) -> bd.Edge`
  - `JointSpec(label: str, cls: str, location: tuple|None, axis: tuple|None)`
- `anchor_resolver.py`: `ResolvedAnchor(label, kind, location, axis, face)`；`pick_face(shape, kind, near, tol=FACE_TOL) -> bd.Face|None`；`resolve_anchor(shape, kind, near, cls, direction=None, label='') -> ResolvedAnchor`
- `compiler.py`: `compile_sources(sources: dict[str, str], out_dir, python='python3') -> CompileResult`；`CompileResult(ok, steps, artifacts)`
- `assembly_gen.py`: `emit_assembly_source(assembly, components) -> str`
- `orchestrator.py`: `generate_sources(intent: dict) -> dict[str, str]`
- `cad_codegen.__init__`: 惰性导出（模块级 `__getattr__`）`generate_sources`/`compile_sources`/`CompileResult`；Task 1 即可 `from cad_codegen import profile`（不触发 orchestrator 导入）

---

### Task 1: 包骨架 + pytest 路径 + profile.py 常量表

**Files:**
- Create: `pytest.ini`
- Create: `src/cad_codegen/__init__.py`
- Create: `src/cad_codegen/profile.py`
- Test: `tests/test_cad_codegen/test_profile.py`

**Interfaces:**
- Consumes: 无
- Produces: 后续任务使用的常量与 `_fmt`（见上文契约）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_profile.py
"""profile.py 常量表测试（保证发射模板与执行模式单一来源）。"""
from cad_codegen import profile


def test_fmt_cleans_floats():
    assert profile._fmt(0.05) == '0.05'
    assert profile._fmt(0.1) == '0.1'
    assert profile._fmt(1e-13) == '0.0'
    assert profile._fmt(-0.0) == '0.0'
    assert profile._fmt(0.1234567891) == '0.123456789'


def test_datum_locations_templates():
    assert '{off}' in profile.DATUM_LOCATIONS['front']
    assert profile.DATUM_LOCATIONS['top'] == 'Location((0, {off}, 0), (0, 90, 0))'
    assert profile.DATUM_LOCATIONS['right'] == 'Location(({off}, 0, 0), (0, 0, 90))'


def test_mirror_planes_cover_three_datums():
    assert profile.MIRROR_PLANES['front'] == 'Plane((0, 0, 0), (1, 0, 0), (0, 0, 1))'
    assert set(profile.MIRROR_PLANES) == {'front', 'top', 'right'}
    assert set(profile.MIRROR_PLANE_TUP) == {'front', 'top', 'right'}


def test_joint_class_tables():
    assert profile.JOINT_CLASSES['revolute'] == 'RevoluteJoint'
    assert profile.JOINT_CLASSES['planar'] is None      # v1 不支持
    assert profile.JOINT_CLASSES['helical'] is None
    assert profile.JOINT_ANCHOR_CLASS['revolute'] == {'cylinder': 'RevoluteJoint'}
    assert profile.JOINT_ANCHOR_CLASS['prismatic'] == {'plane': 'LinearJoint'}
    # 未匹配锚点 kind 的侧退化为 RigidJoint（.get(kind, 'RigidJoint')）
    assert profile.JOINT_ANCHOR_CLASS['revolute'].get('plane', 'RigidJoint') == 'RigidJoint'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_profile.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen'`（FAIL）

- [ ] **Step 3: 写最小实现**

```ini
# pytest.ini（若 Plan A 已创建则合并该行）
[pytest]
testpaths = tests
python_files = test_*.py
pythonpath = src
```

```python
# src/cad_codegen/__init__.py
"""AI-CAD 代码生成层：意图层 JSON → ① build123d 建模语言源码 + ② 可编辑 STEP。"""
# 惰性导出：Task 1 尚无 orchestrator/compiler，模块级 __getattr__ 保证
# `from cad_codegen import compile_sources` 等在各模块就绪后可用。
def __getattr__(name):
    if name == 'generate_sources':
        from cad_codegen.orchestrator import generate_sources
        return generate_sources
    if name == 'compile_sources':
        from cad_codegen.compiler import compile_sources
        return compile_sources
    if name == 'CompileResult':
        from cad_codegen.compiler import CompileResult
        return CompileResult
    raise AttributeError(name)


__all__ = ['generate_sources', 'compile_sources', 'CompileResult']
```

```python
# src/cad_codegen/profile.py
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

# 基准面 → BuildSketch 的 Location 表达式模板（{off} = 沿法向偏移，米）
DATUM_LOCATIONS = {
    'front': 'Location((0, 0, {off}))',
    'top': 'Location((0, {off}, 0), (0, 90, 0))',
    'right': 'Location(({off}, 0, 0), (0, 0, 90))',
}


def _plane_expr(origin, x_dir, normal):
    """平面三元组 → 'Plane((...), (...), (...))' 表达式。"""
    def pt(t):
        return '(' + ', '.join(_fmt(c) for c in t) + ')'
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_profile.py -v`
Expected: 全部通过（4 个）

- [ ] **Step 5: 提交**

```bash
git add pytest.ini src/cad_codegen/__init__.py src/cad_codegen/profile.py tests/test_cad_codegen/test_profile.py
git commit -m "feat(cad-codegen): 包骨架与常量表（Plan B Task 1）"
```

---

### Task 2: 零件切分 + 确定性执行（split_parts + build_part）

**Files:**
- Create: `src/cad_codegen/part_gen.py`（本任务写 `CodegenError/_fmt引用/split_parts/_build_plan/build_part` 与执行侧，发射侧留到 Task 3）
- Test: `tests/test_cad_codegen/test_part_build.py`

**Interfaces:**
- Consumes: `profile.py`（`DATUM_LOCATIONS`/`MIRROR_PLANES`/`MIRROR_PLANE_TUP`/`EDGE_TOL`/`THROUGH_MARGIN`/`_fmt`）
- Produces: `split_parts(parts, part_refs)`、`_build_plan(nodes)`、`build_part(nodes) -> (Part, amounts)`、`pick_edges(shape, near, tol)`、`JointSpec` dataclass

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_part_build.py
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_part_build.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen.part_gen'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_codegen/part_gen.py
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

    约定：各零件特征链在 parts 数组中连续排布，part_ref 为每链首节点 id；
    每个节点归属它之前最近的 part_ref。返回 dict（按数组顺序）。
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
    current = order[0]
    for i, node in enumerate(parts):
        if not isinstance(node, dict):
            continue
        for pref in order:
            if ref_pos[pref] == i:
                current = pref
                break
        result[current].append(node)
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
    with bd.BuildSketch(loc):
        _exec_profile(node.get('profile', []))


def _part_extent(part, datum, off):
    """当前 part 沿 datum 法向的最大范围（米），用于 through_all 切除深度。"""
    bbox = part.bounding_box()
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
    with bd.BuildSketch(loc):
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_part_build.py -v`
Expected: 全部通过（5 个）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/part_gen.py tests/test_cad_codegen/test_part_build.py
git commit -m "feat(cad-codegen): 零件切分与确定性执行（Plan B Task 2）"
```

---

### Task 3: 源码发射（emit_part_source + 全部 emit 函数）

**Files:**
- Modify: `src/cad_codegen/part_gen.py`（追加发射侧）
- Test: `tests/test_cad_codegen/test_emit_part.py`

**Interfaces:**
- Consumes: Task 2 的 `_build_plan`、`_line_vertices`、`JointSpec`；`profile.py`
- Produces: `emit_part_source(part_id, nodes, joint_specs, amounts=None) -> str`、`generate_part_source(part_id, nodes, joint_specs) -> str`（后 1 个 Task 5 用）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_emit_part.py
"""零件源码发射测试：发射串与已验证的执行模板逐字一致。"""
from cad_codegen.part_gen import (
    JointSpec, build_part, emit_part_source, generate_part_source,
)

# 轴套零件（单零件意图）
HUB_NODES = [
    {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
]


def test_emit_hub_source_roundtrips_build():
    src = generate_part_source('hub', HUB_NODES, [])
    assert 'def build():' in src
    assert 'Circle(0.03)' in src            # diameter/2 → 半径
    assert 'extrude(amount=0.08)' in src
    assert "export_step(build(), 'hub.step', unit=Unit.M)" in src
    # 发射串必须能 in-process 再执行（与子进程编译一致）
    ns = {'export_step': lambda s, p, unit: None}
    exec(compile(src.replace('if __name__', 'if 0 and __name__'), '<gen>', 'exec'), ns)
    part = ns['build']()
    import build123d as bd
    assert len([f for f in part.faces() if f.geom_type == bd.GeomType.CYLINDER]) == 1


def test_emit_joint_revolute_and_rigid():
    joints = [
        JointSpec(label='c1', cls='RevoluteJoint',
                  axis=((0.0, 0.0, 0.0), (0.0, 0.0, -1.0))),
        JointSpec(label='c2', cls='RigidJoint',
                  location=((0.0, 0.0, 0.08), (0.0, 0.0, 0.0))),
    ]
    src = emit_part_source('hub', HUB_NODES, joints)
    assert "RevoluteJoint('c1', part_b.part, axis=Axis((0.0, 0.0, 0.0), (0.0, 0.0, -1.0)))" in src
    assert "RigidJoint('c2', part_b.part, Location((0.0, 0.0, 0.08), (0.0, 0.0, 0.0)))" in src


def test_emit_through_all_uses_precomputed_amount():
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
    src = generate_part_source('bracket', nodes, [])
    assert 'extrude(amount=0.03, mode=Mode.SUBTRACT)' in src


def test_emit_pattern_absorbed_into_sketch_locations():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'b1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 's2', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.03}]},
        {'id': 'c1', 'type': 'extrude', 'sketch': 's2', 'operation': 'cut',
         'end': 'through_all'},
        {'id': 'p1', 'type': 'linear_pattern', 'feature': 'c1',
         'direction': 'x', 'spacing': 0.05, 'count': 2},
    ]
    src = emit_part_source('bracket', nodes, [], amounts={'c1': 0.03})
    # 关键：GridLocations 必须位于 BuildSketch 内部（0.11.1 唯一生效写法）
    assert ('with BuildSketch(Location((0, 0, 0.0))):\n'
            '            with GridLocations(0.05, 1, 2, 1):\n'
            '                Circle(0.015)') in src
    # 被阵列的 sketch/extrude 不再独立发射
    assert src.count('Circle(0.015)') == 1
    # 阵列后的 extrude 回到 part 级缩进
    assert '\n        extrude(amount=0.03, mode=Mode.SUBTRACT)\n' in src


def test_emit_line_profile_becomes_polygon():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [
             {'kind': 'line', 'x1': 0, 'y1': 0, 'x2': 0.1, 'y2': 0},
             {'kind': 'line', 'x1': 0.1, 'y1': 0, 'x2': 0.1, 'y2': 0.05},
             {'kind': 'line', 'x1': 0.1, 'y1': 0.05, 'x2': 0, 'y2': 0.05},
             {'kind': 'line', 'x1': 0, 'y1': 0.05, 'x2': 0, 'y2': 0},
         ]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.01},
    ]
    src = emit_part_source('plate', nodes, [])
    assert 'Polygon((0.0, 0.0), (0.1, 0.0), (0.1, 0.05), (0.0, 0.05))' in src
    assert 'Line(' not in src


def test_emit_mirror_about_plane():
    nodes = [
        {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.1, 'height': 0.1}]},
        {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
        {'id': 'm1', 'type': 'mirror', 'plane': {'datum': 'front'},
         'features': ['n1']},
    ]
    src = emit_part_source('sym', nodes, [])
    assert 'mirror(about=Plane((0, 0, 0), (1, 0, 0), (0, 0, 1)))' in src
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_emit_part.py -v`
Expected: FAIL（`emit_part_source` 未定义）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_codegen/part_gen.py —— 追加以下函数（发射侧只需生成字符串，无需新增 import）
def _v(xyz):
    return 'Vector(%s, %s, %s)' % tuple(_fmt(x) for x in xyz)


def _emit_profile(profile):
    """profile → 图元发射行列表。"""
    if not profile:
        raise CodegenError('profile 不能为空')
    if all(p.get('kind') == 'line' for p in profile):
        pts = _line_vertices(profile)
        if len(pts) < 3:
            raise CodegenError('line 轮廓至少需要 3 个顶点（闭合环）')
        return ['Polygon(%s)' % ', '.join('(%s, %s)' % (_fmt(x), _fmt(y)) for x, y in pts)]
    out = []
    for p in profile:
        kind = p.get('kind')
        if kind == 'rectangle':
            out.append('Rectangle(%s, %s)' % (_fmt(p['width']), _fmt(p['height'])))
        elif kind == 'circle':
            out.append('Circle(%s)' % _fmt(p['diameter'] / 2.0))
        else:
            raise CodegenError('v1 不支持草图图元 ' + str(kind))
    return out


def _emit_sketch(node, indent):
    ref = node.get('ref') or {}
    if ref.get('face') is not None:
        raise CodegenError('v1 不支持 ref.face 面上草图')
    datum = ref.get('datum', 'front')
    off = ref.get('offset', 0.0)
    tmpl = DATUM_LOCATIONS.get(datum)
    if tmpl is None:
        raise CodegenError('未知基准面 ' + str(datum))
    lines = [indent + 'with BuildSketch(' + tmpl.format(off=_fmt(off)) + '):']
    for line in _emit_profile(node.get('profile', [])):
        lines.append(indent + '    ' + line)
    return lines


def _emit_extrude(node, indent, amounts):
    op = node.get('operation', 'boss')
    end = node.get('end', 'blind')
    depth = node.get('depth')
    if end == 'up_to_surface':
        raise CodegenError('v1 不支持 extrude end=up_to_surface')
    if end == 'mid_plane':
        if not depth:
            raise CodegenError('mid_plane 需要 depth')
        return [indent + 'extrude(amount=%s, both=True)' % _fmt(depth)]
    if end == 'through_all':
        if op != 'cut':
            raise CodegenError('v1 不支持 boss through_all')
        amount = amounts.get(node['id'])
        if amount is None:
            raise CodegenError('through_all cut 缺少预计算深度（需先生成 build_part）')
        return [indent + 'extrude(amount=%s, mode=Mode.SUBTRACT)' % _fmt(amount)]
    if not depth:
        raise CodegenError('blind 需要 depth')
    if op == 'cut':
        return [indent + 'extrude(amount=%s, mode=Mode.SUBTRACT)' % _fmt(depth)]
    return [indent + 'extrude(amount=%s)' % _fmt(depth)]


def _emit_round(node, indent):
    ntype = node['type']
    r = node.get('radius' if ntype == 'fillet' else 'distance')
    edges = node.get('edges', [])
    if len(edges) != 1:
        raise CodegenError('v1 仅支持单个边锚点（' + ntype + '）')
    lines = [
        indent + ('_pick = [e for e in part_b.part.edges() '
                  'if e.distance_to(%s) < %s]' % (_v(edges[0]['near']), _fmt(EDGE_TOL))),
        indent + '_e = max(_pick, key=lambda e: e.length) if _pick else None',
        indent + 'if _e is None:',
        indent + '    raise RuntimeError("未找到' + ntype + '边")',
    ]
    if ntype == 'fillet':
        lines.append(indent + 'fillet([_e], radius=%s)' % _fmt(r))
    else:
        lines.append(indent + 'chamfer([_e], length=%s)' % _fmt(r))
    return lines


def _emit_mirror(node, indent):
    plane = node.get('plane') or {}
    datum = plane.get('datum', 'front')
    expr = MIRROR_PLANES.get(datum)
    if expr is None:
        raise CodegenError('未知镜像基准 ' + str(datum))
    return [indent + 'mirror(about=' + expr + ')']


def _emit_pattern_block(item, indent, amounts):
    node = item['node']
    sk = item['sketch']
    ex = item['extrude']
    ref = sk.get('ref') or {}
    if ref.get('face') is not None:
        raise CodegenError('v1 不支持 ref.face 面上草图')
    datum = ref.get('datum', 'front')
    off = ref.get('offset', 0.0)
    tmpl = DATUM_LOCATIONS.get(datum)
    if tmpl is None:
        raise CodegenError('未知基准面 ' + str(datum))
    lines = [indent + 'with BuildSketch(' + tmpl.format(off=_fmt(off)) + '):']
    sub = indent + '    '
    if node['type'] == 'linear_pattern':
        direction = node.get('direction', 'x')
        if direction == 'z':
            raise CodegenError('v1 不支持 z 方向线性阵列')
        spacing, count = node['spacing'], node['count']
        loc_args = ('%s, 1, %d, 1' if direction == 'x' else '1, %s, 1, %d') % (_fmt(spacing), count)
        lines.append(sub + 'with GridLocations(%s):' % loc_args)
    else:
        if node.get('radius') is None:
            raise CodegenError('circular_pattern 需要 radius')
        lines.append(sub + 'with PolarLocations(%s, %d):' % (_fmt(node['radius']), node['count']))
    for line in _emit_profile(sk.get('profile', [])):
        lines.append(sub + '    ' + line)
    lines.extend(_emit_extrude(ex, indent, amounts))
    return lines


def _emit_node(node, indent, amounts):
    ntype = node['type']
    if ntype == 'sketch':
        return _emit_sketch(node, indent)
    if ntype == 'extrude':
        return _emit_extrude(node, indent, amounts)
    if ntype in ('fillet', 'chamfer'):
        return _emit_round(node, indent)
    if ntype == 'mirror':
        return _emit_mirror(node, indent)
    raise CodegenError('未知节点类型 ' + str(ntype))


def _emit_joint(spec, indent):
    label = spec.label
    cls = spec.cls
    if cls in ('RigidJoint', 'BallJoint'):
        if spec.location is None:
            raise CodegenError(cls + ' 需要 location')
        (px, py, pz), (rx, ry, rz) = spec.location
        return [indent + ("part_b.part.joints['%s'] = %s('%s', part_b.part, "
                          'Location((%s, %s, %s), (%s, %s, %s)))') % (
            label, cls, label, _fmt(px), _fmt(py), _fmt(pz), _fmt(rx), _fmt(ry), _fmt(rz))]
    if cls in ('RevoluteJoint', 'LinearJoint', 'CylindricalJoint'):
        if spec.axis is None:
            raise CodegenError(cls + ' 需要 axis')
        (px, py, pz), (dx, dy, dz) = spec.axis
        return [indent + ("part_b.part.joints['%s'] = %s('%s', part_b.part, "
                          'axis=Axis((%s, %s, %s), (%s, %s, %s)))') % (
            label, cls, label, _fmt(px), _fmt(py), _fmt(pz), _fmt(dx), _fmt(dy), _fmt(dz))]
    raise CodegenError('未知关节类 ' + cls)


def emit_part_source(part_id, nodes, joint_specs, amounts=None):
    """发射零件源码（交付物①）。amounts: {节点 id: through 深度}。"""
    amounts = amounts or {}
    lines = [
        '# 由 AI-CAD 生成（交付物①：build123d 建模语言源码，可编辑）',
        '# 零件：' + part_id,
        'from build123d import (',
        '    Axis, BuildPart, BuildSketch, Circle, GridLocations,',
        '    Location, Mode, Plane, PolarLocations, Polygon, Rectangle,',
        '    Unit, Vector, chamfer, export_step, extrude, fillet, mirror,',
        '    BallJoint, CylindricalJoint, LinearJoint, RevoluteJoint, RigidJoint,',
        ')',
        '',
        '',
        'def build():',
        '    with BuildPart() as part_b:',
    ]
    for item in _build_plan(nodes):
        if item['op'] == 'node':
            lines.extend(_emit_node(item['node'], '        ', amounts))
        else:
            lines.extend(_emit_pattern_block(item, '        ', amounts))
    for spec in joint_specs:
        lines.extend(_emit_joint(spec, '    '))
    lines.append('    return part_b.part')
    lines.append('')
    lines.append('')
    lines.append("if __name__ == '__main__':")
    lines.append("    export_step(build(), '" + part_id + ".step', unit=Unit.M)")
    return '\n'.join(lines) + '\n'


def generate_part_source(part_id, nodes, joint_specs):
    """生成零件源码：in-process 执行算 through 深度，再发射字符串。"""
    _, amounts = build_part(nodes)
    return emit_part_source(part_id, nodes, joint_specs, amounts)
```

注意：`emit_part_source` 与 `_emit_mirror` 用到 `MIRROR_PLANES`，Task 2 的 import 里只导入了 `MIRROR_PLANE_TUP`——把 import 行改为同时导入 `MIRROR_PLANES`：

```python
# src/cad_codegen/part_gen.py 顶部 import 改为：
from cad_codegen.profile import (
    DATUM_LOCATIONS, EDGE_TOL, MIRROR_PLANES, MIRROR_PLANE_TUP,
    THROUGH_MARGIN, _fmt,
)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_emit_part.py -v`
Expected: 全部通过（6 个）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/part_gen.py tests/test_cad_codegen/test_emit_part.py
git commit -m "feat(cad-codegen): 零件源码发射（Plan B Task 3）"
```

---

### Task 4: 锚点解析器（anchor_resolver）

**Files:**
- Create: `src/cad_codegen/anchor_resolver.py`
- Test: `tests/test_cad_codegen/test_anchor_resolver.py`

**Interfaces:**
- Consumes: `profile.py`（`FACE_TOL`）；`part_gen.py`（`CodegenError`）；真实 build123d 实体
- Produces: `ResolvedAnchor(label, kind, location, axis, face)`；`pick_face(shape, kind, near, tol=FACE_TOL)`；`resolve_anchor(shape, kind, near, cls, direction=None, label='')`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_anchor_resolver.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen.anchor_resolver'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_anchor_resolver.py -v`
Expected: 全部通过（7 个）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/anchor_resolver.py tests/test_cad_codegen/test_anchor_resolver.py
git commit -m "feat(cad-codegen): 锚点解析器（Plan B Task 4）"
```

---

### Task 5: 单零件编译（compiler.py + 子进程 STEP 导出）

**Files:**
- Create: `src/cad_codegen/compiler.py`
- Test: `tests/test_cad_codegen/test_part_compile.py`

**Interfaces:**
- Consumes: Task 3 的 `generate_part_source`
- Produces: `compile_sources(sources: dict[str, str], out_dir, python='python3') -> CompileResult`；`CompileResult(ok, steps, artifacts)`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_part_compile.py
"""子进程编译测试：交付物② STEP 文件从交付物①源码导出。"""
import os
from cad_codegen import compile_sources
from cad_codegen.part_gen import generate_part_source

HUB_NODES = [
    {'id': 's1', 'type': 'sketch', 'ref': {'datum': 'front'},
     'profile': [{'kind': 'circle', 'diameter': 0.06}]},
    {'id': 'n1', 'type': 'extrude', 'sketch': 's1', 'operation': 'boss',
     'end': 'blind', 'depth': 0.08},
]


def test_compile_hub_step(tmp_path):
    src = generate_part_source('hub', HUB_NODES, [])
    res = compile_sources({'hub': src}, str(tmp_path))
    assert res.ok, res.steps
    assert res.artifacts['hub'] == os.path.join(str(tmp_path), 'hub.step')
    with open(res.artifacts['hub'], 'r', encoding='utf-8') as f:
        assert f.read(13) == 'ISO-10303-21;'


def test_compile_reports_failure(tmp_path):
    res = compile_sources({'bad': 'raise SyntaxError("x")\n'}, str(tmp_path))
    assert not res.ok
    assert res.steps[0][0] == 'bad'
    assert res.steps[0][1] is False
    assert 'SyntaxError' in res.steps[0][2]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_part_compile.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen.compiler'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_codegen/compiler.py
"""子进程编译：交付物①源码 → 交付物② STEP 文件。"""
import os
import subprocess
from dataclasses import dataclass, field


@dataclass
class CompileResult:
    ok: bool
    steps: list = field(default_factory=list)      # [(name, ok, msg)]
    artifacts: dict = field(default_factory=dict)  # name → STEP 绝对路径


def compile_sources(sources, out_dir, python='python3'):
    """把 {模块名: 源码} 写入 out_dir，逐模块以子进程执行导出 STEP。

    执行 cwd=out_dir：装配模块的 import_module('hub') 可解析零件模块。
    """
    os.makedirs(out_dir, exist_ok=True)
    for name, src in sources.items():
        with open(os.path.join(out_dir, name + '.py'), 'w', encoding='utf-8') as f:
            f.write(src)
    steps = []
    artifacts = {}
    for name in sources:
        proc = subprocess.run([python, name + '.py'], cwd=out_dir,
                              capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            steps.append((name, False, (proc.stderr or proc.stdout)[:2000]))
            continue
        step = os.path.join(out_dir, name + '.step')
        artifacts[name] = step
        steps.append((name, True, 'STEP 已生成'))
    return CompileResult(ok=all(ok for _, ok, _ in steps), steps=steps, artifacts=artifacts)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_part_compile.py -v`
Expected: 全部通过（2 个）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/compiler.py tests/test_cad_codegen/test_part_compile.py
git commit -m "feat(cad-codegen): 子进程编译与 STEP 导出（Plan B Task 5）"
```

---

### Task 6: 装配源码发射 + 装配编译

**Files:**
- Create: `src/cad_codegen/assembly_gen.py`
- Test: `tests/test_cad_codegen/test_assembly_gen.py`

**Interfaces:**
- Consumes: Task 5 的 `compile_sources`；Task 3 的 `generate_part_source`
- Produces: `emit_assembly_source(assembly, components) -> str`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_assembly_gen.py
"""装配源码发射 + 子进程装配编译测试（revolute 轴套-立柱）。"""
import os
import pytest
from cad_codegen.assembly_gen import emit_assembly_source
from cad_codegen.compiler import compile_sources
from cad_codegen.part_gen import JointSpec, generate_part_source

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
ASSEMBLY = {
    'components': [
        {'id': 'c1', 'part_ref': 'hn1'},
        {'id': 'c2', 'part_ref': 'pn1'},
    ],
    'connections': [
        {'id': 'J1', 'type': 'kinematic', 'joint': 'revolute',
         'contact': [
             {'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0.03, 0, 0]}},
             {'part': 'c2', 'anchor': {'kind': 'plane', 'near': [0, 0, 0.02]}},
         ],
         'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}},
    ],
}


def test_emit_assembly_source_imports_and_connects():
    src = emit_assembly_source(ASSEMBLY, ASSEMBLY['components'])
    assert "parts['c1'] = import_module('hn1').build()" in src
    assert "parts['c2'] = import_module('pn1').build()" in src
    assert "parts['c1'].joints['J1'].connect_to(parts['c2'].joints['J1'])" in src
    assert "assembly = Compound(children=list(parts.values()))" in src


def test_compile_revolute_assembly_end_to_end(tmp_path):
    # 零件关节束（与 orchestrator 将产出一致，label = 连接 id J1）：
    joints = {
        'hn1': [JointSpec(label='J1', cls='RevoluteJoint',
                          axis=((0.0, 0.0, 0.0), (0.0, 0.0, -1.0)))],
        'pn1': [JointSpec(label='J1', cls='RigidJoint',
                          location=((0.0, 0.0, 0.02), (0.0, 0.0, 0.0)))],
    }
    sources = {}
    for pref in ('hn1', 'pn1'):
        nodes = [n for n in PARTS if n['id'] in ('hs1', 'hn1')] if pref == 'hn1' \
            else [n for n in PARTS if n['id'] in ('ps1', 'pn1')]
        sources[pref] = generate_part_source(pref, nodes, joints[pref])
    sources['assembly'] = emit_assembly_source(ASSEMBLY, ASSEMBLY['components'])
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
    for name in ('hn1', 'pn1', 'assembly'):
        assert name in res.artifacts
    with open(res.artifacts['assembly'], 'r', encoding='utf-8') as f:
        assert f.read(13) == 'ISO-10303-21;'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_assembly_gen.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen.assembly_gen'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_codegen/assembly_gen.py
"""装配源码发射（交付物①装配部分）。"""
from cad_codegen.part_gen import CodegenError


def emit_assembly_source(assembly, components):
    """发射装配建模语言源码：导入各零件 build()、按连接 connect_to、Compound 汇总。"""
    comp_ref = {}
    for c in components:
        if isinstance(c, dict) and c.get('id'):
            comp_ref[c['id']] = c.get('part_ref')
    lines = [
        '# 由 AI-CAD 生成（交付物①：装配建模语言源码）',
        'from importlib import import_module',
        'from build123d import Compound, Unit, export_step',
        '',
        '',
        'parts = {}',
    ]
    for cid, pref in comp_ref.items():
        lines.append("parts['%s'] = import_module('%s').build()" % (cid, pref))
    lines.append('')
    for conn in assembly.get('connections') or []:
        label = conn.get('id', '')
        contact = conn.get('contact') or []
        if len(contact) != 2:
            raise CodegenError('v1 仅支持 2 接触面连接（' + str(label) + '）')
        c0 = contact[0].get('part')
        c1 = contact[1].get('part')
        if c0 not in comp_ref or c1 not in comp_ref:
            raise CodegenError('连接接触零件未在 components 中定义')
        lines.append("parts['%s'].joints['%s'].connect_to(parts['%s'].joints['%s'])"
                     % (c0, label, c1, label))
    lines.append('')
    lines.append('assembly = Compound(children=list(parts.values()))')
    lines.append("export_step(assembly, 'assembly.step', unit=Unit.M)")
    lines.append('')
    return '\n'.join(lines) + '\n'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python3 -m pytest tests/test_cad_codegen/test_assembly_gen.py -v`
Expected: 全部通过（2 个）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/assembly_gen.py tests/test_cad_codegen/test_assembly_gen.py
git commit -m "feat(cad-codegen): 装配源码发射与装配编译（Plan B Task 6）"
```

---

### Task 7: 编排器 generate_sources + 端到端全链

**Files:**
- Create: `src/cad_codegen/orchestrator.py`
- Modify: `src/cad_codegen/__init__.py`（无需改——Task 1 已导出；若惰性导入生效则保持）
- Test: `tests/test_cad_codegen/test_e2e.py`

**Interfaces:**
- Consumes: `split_parts`/`build_part`/`generate_part_source`/`JointSpec`（part_gen）、`resolve_anchor`（anchor_resolver）、`emit_assembly_source`（assembly_gen）、`JOINT_CLASSES`/`JOINT_ANCHOR_CLASS`（profile）；`cad_intent.validate_intent`（惰性）
- Produces: `generate_sources(intent: dict) -> dict[str, str]`（键：零件 part_ref + 'assembly'）

- [ ] **Step 1: 写失败测试**

```python
# tests/test_cad_codegen/test_e2e.py
"""端到端：意图 JSON → 交付物①②。"""
import os
import pytest
from cad_codegen import compile_sources, generate_sources

# hub(轴套) + post(立柱)，revolute 装配
INTENT_ASM = {
    'schema_version': 2,
    'units': 'meters',
    'ground': 'hn1',
    'parts': [
        {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'circle', 'diameter': 0.06}]},
        {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.08},
        {'id': 'ps1', 'type': 'sketch', 'ref': {'datum': 'front'},
         'profile': [{'kind': 'rectangle', 'width': 0.06, 'height': 0.06}]},
        {'id': 'pn1', 'type': 'extrude', 'sketch': 'ps1', 'operation': 'boss',
         'end': 'blind', 'depth': 0.02},
    ],
    'assembly': {
        'components': [
            {'id': 'c1', 'part_ref': 'hn1'},
            {'id': 'c2', 'part_ref': 'pn1'},
        ],
        'connections': [
            {'id': 'J1', 'type': 'kinematic', 'joint': 'revolute',
             'contact': [
                 {'part': 'c1', 'anchor': {'kind': 'cylinder', 'near': [0.03, 0, 0]}},
                 {'part': 'c2', 'anchor': {'kind': 'plane', 'near': [0, 0, 0.02]}},
             ],
             'direction': {'axis': [0, 0, 1], 'rotation': True, 'translation': False}},
        ],
    },
}


def test_generate_sources_key_set():
    sources = generate_sources(INTENT_ASM)
    assert set(sources) == {'hn1', 'pn1', 'assembly'}
    assert 'def build():' in sources['hn1']
    assert 'connect_to' in sources['assembly']


def test_end_to_end_compile_steps(tmp_path):
    sources = generate_sources(INTENT_ASM)
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
    for name in ('hn1', 'pn1', 'assembly'):
        with open(res.artifacts[name], 'r', encoding='utf-8') as f:
            assert f.read(13) == 'ISO-10303-21;'
    # 装配 STEP 体积 > 任一零件（两个零件已合并）
    asm_size = os.path.getsize(res.artifacts['assembly'])
    assert asm_size > os.path.getsize(res.artifacts['hn1'])


def test_generate_sources_rejects_invalid_intent():
    bad = dict(INTENT_ASM, units='inches')
    with pytest.raises(ValueError) as exc:
        generate_sources(bad)
    try:
        from cad_intent import validate_intent
        assert 'units' in str(exc.value)   # Plan A 就绪：校验错误透出
    except ImportError:
        assert str(exc.value)              # Plan A 未执行：仍抛 CodegenError（不静默）


def test_part_only_intent(tmp_path):
    intent = {
        'schema_version': 2,
        'units': 'meters',
        'ground': 'hn1',
        'parts': [
            {'id': 'hs1', 'type': 'sketch', 'ref': {'datum': 'front'},
             'profile': [{'kind': 'circle', 'diameter': 0.06}]},
            {'id': 'hn1', 'type': 'extrude', 'sketch': 'hs1', 'operation': 'boss',
             'end': 'blind', 'depth': 0.08},
        ],
        'assembly': None,
    }
    sources = generate_sources(intent)
    assert set(sources) == {'hn1'}
    res = compile_sources(sources, str(tmp_path))
    assert res.ok, res.steps
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m pytest tests/test_cad_codegen/test_e2e.py -v`
Expected: `ModuleNotFoundError: No module named 'cad_codegen.orchestrator'`（FAIL）

- [ ] **Step 3: 写最小实现**

```python
# src/cad_codegen/orchestrator.py
"""generate_sources 编排：校验 → 切分 → 锚点解析 → 发射 → 装配。"""
from cad_codegen.part_gen import (
    CodegenError, JointSpec, build_part, generate_part_source, split_parts,
)
from cad_codegen.anchor_resolver import resolve_anchor
from cad_codegen.assembly_gen import emit_assembly_source
from cad_codegen.profile import JOINT_ANCHOR_CLASS, JOINT_CLASSES


def generate_sources(intent):
    """意图层 JSON → {模块名: 源码}（零件模块 + assembly 模块）。"""
    try:
        from cad_intent import validate_intent  # 惰性：Tasks 1-6 单测不依赖 Plan A
    except ImportError:
        raise CodegenError('cad_intent（Plan A）未就绪：请先执行 Plan A')
    errors = validate_intent(intent)
    if errors:
        raise CodegenError('意图校验未通过：' + '; '.join(errors[:5]))
    parts_list = intent.get('parts') or []
    assembly = intent.get('assembly')
    components = (assembly or {}).get('components') or []
    part_refs = [c['part_ref'] for c in components if c.get('part_ref')]
    if part_refs:
        chains = split_parts(parts_list, part_refs)
    else:
        # 纯 part 图：整个 parts 数组即一个零件
        pid = intent.get('ground') or 'part'
        chains = {pid: parts_list}
    joints_by_part = _collect_joints(assembly, chains) if assembly else {}
    sources = {}
    for pref, nodes in chains.items():
        sources[pref] = generate_part_source(pref, nodes, joints_by_part.get(pref, []))
    if assembly:
        sources['assembly'] = emit_assembly_source(assembly, components)
    return sources


def _part_ref_of(assembly, comp_id):
    for comp in assembly.get('components') or []:
        if comp.get('id') == comp_id:
            return comp.get('part_ref')
    raise CodegenError('component ' + str(comp_id) + ' 未找到')


def _collect_joints(assembly, chains):
    """遍历连接，为每个零件解析出关节束。返回 {part_ref: [JointSpec]}。"""
    by_part = {}
    for conn in assembly.get('connections') or []:
        ctype = conn.get('type')
        label = conn.get('id', '')
        contact = conn.get('contact') or []
        if ctype == 'kinematic':
            joint_kind = conn.get('joint')
            if joint_kind not in JOINT_CLASSES or JOINT_CLASSES[joint_kind] is None:
                raise CodegenError('v1 不支持运动副 ' + str(joint_kind))
            direction = conn.get('direction') or {}
        else:
            joint_kind = None
            direction = None
        if len(contact) != 2:
            raise CodegenError('v1 仅支持 2 接触面连接（' + str(label) + '）')
        for c in contact:
            comp_id = c.get('part')
            pref = _part_ref_of(assembly, comp_id)
            nodes = chains.get(pref)
            if nodes is None:
                raise CodegenError('component ' + str(comp_id) + ' 的 part_ref 无特征链')
            anchor = c.get('anchor') or {}
            kind = anchor.get('kind')
            cls = JOINT_ANCHOR_CLASS.get(joint_kind or '', {}).get(kind, 'RigidJoint')
            shape, _ = build_part(nodes)
            ra = resolve_anchor(shape, kind, anchor.get('near'), cls, direction, label)
            by_part.setdefault(pref, []).append(JointSpec(
                label=ra.label, cls=cls, location=ra.location, axis=ra.axis))
    return by_part
```

- [ ] **Step 4: 运行全量测试**

Run: `python3 -m pytest tests/test_cad_codegen/ -v`
Expected: 全部通过（Task 1-7 合计 30 个）；再 `python3 -m pytest -v`（若 Plan A 已执行则整库通过）

- [ ] **Step 5: 提交**

```bash
git add src/cad_codegen/orchestrator.py tests/test_cad_codegen/test_e2e.py
git commit -m "feat(cad-codegen): 编排器与端到端全链（Plan B Task 7）"
```

---

## Self-Review

**1. Spec coverage（对照设计文档 §5 编译管线 / 交付物①②）：**
- 交付物① build123d 建模语言源码 → Task 3（零件）+ Task 6（装配）✅
- 交付物② 可编辑 STEP → Task 5（单零件）+ Task 6（装配）子进程编译 ✅
- 确定性锚点解析器 → Task 4 ✅
- 语义 mate → 关节类（revolute/prismatic/cylindrical/spherical）+ RigidJoint 退化 → Task 4/7 ✅
- 顶层校验（Plan A）→ `generate_sources` 惰性调用 `validate_intent` ✅
- 基准面/镜像/阵列/through_all → Task 2/3（实测模板）✅
- 多层细化（refine_of/frozen，Plan A 产出）→ 代码生成侧按同一 part 图处理，无额外动作（固化字段被校验、生成忽略）✅

**2. Placeholder scan：** 无 TBD/TODO；每个任务含完整可运行代码与精确命令；所有 API 均来自「已实测验证」表，无未验证假设。

**3. Type consistency：**
- `split_parts(parts, part_refs) -> dict[str, list]` Task 2 定义、Task 7 使用一致 ✅
- `build_part(nodes) -> (Part, amounts)`、`amounts[node_id] = float` Task 2 产生、Task 3 `emit_part_source(..., amounts)` 消费一致 ✅
- `JointSpec(label, cls, location, axis)` 元组结构（location/axis 均 `((x,y,z),(...))`）在 Task 2 定义、Task 3 `_emit_joint` 解包、Task 7 构造一致 ✅
- `ResolvedAnchor` 字段与 `resolve_anchor` 返回一致 ✅
- `MIRROR_PLANES`/`MIRROR_PLANE_TUP` 同源于 `MIRROR_PLANE_TUP`（profile.py 生成），杜绝发射/执行漂移 ✅
- `compile_sources(sources, out_dir, python='python3') -> CompileResult(ok, steps, artifacts)` Task 5/6/7 一致 ✅

**已知有意为之的取舍（设计变更，已在文中记录）：**
- **零件归属改用「边界切分法」**（part_ref=链首、特征链连续排布），取代原先的 id-可达性方案 → **取消** fillet/chamfer 的 `feature` 修订（设计文档亦未要求该字段），Plan A 仅增补 `circular_pattern.radius`。代价：零件特征链不得跨零件引用（LLM 生成约定，校验器暂不拦截）。
- `mirror` 为整实体镜像（`mirror(about=Plane)`），`features` 列表被校验但不参与代码生成（0.11.1 无选择性镜像操作）。
- `line` 图元要求整段 line 归组为 `Polygon`（自动闭合）；孤立 line 或与圆/矩形混用 → 报错。RegularPolygon 不在 v1 schema（未列入 PROFILE_KINDS）。
- 装配连接限 2 接触面（多接触面连接 → 明确报错）。
- 圆柱锚点轴方向可能为 ±Z，revolute/cylindrical 无方向敏感性，可接受。

---

## Execution Handoff

Plan B 已保存到 `docs/superpowers/plans/2026-08-17-plan-b-codegen-compile.md`。两种执行方式：

1. **Subagent-Driven（推荐）** — 每个任务派发独立 subagent，任务间审查，迭代快
2. **Inline Execution** — 本会话内用 executing-plans 批量执行，带检查点

选择哪种？（注意：Plan A 尚未执行——执行顺序建议 A 完成后再进入 B；若选择先跑 B，Task 1 的 `pytest.ini` 与惰性导入已让 B 的测试独立可过，`generate_sources` 会在 Plan A 就绪后自动生效。）
