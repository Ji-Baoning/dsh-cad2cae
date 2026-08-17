# AI-CAD for DeepSeek Harness —— DSH 插件设计文档

> 日期：2026-08-17
> 状态：已与用户逐节确认
> 前置材料：`AI-CAD生成与自动仿真-技术调研报告.md`、参考项目 `sample/solidworks-wlj-dsh`

## 1. 定位与目标

在 **DeepSeek Harness (DSH)** 上构建一个 CAD 生成插件（preset 形态，仿 `sample/solidworks-wlj-dsh`），实现"**文本需求 → 意图层 JSON → build123d 源码 → 可编辑 STEP**"的门禁化工作流。

- **首期边界**：仅 CAD 生成（含装配），CAE 仿真在架构上预留，不实现。
- **输入**：纯文本需求。
- **交付物（双交付，参考 Zoo）**：
  1. **建模语言** = build123d Python 源码（零件 + 装配，可编辑、参数化、保留设计意图，类比 Zoo KCL）
  2. **模型** = 由源码经 OCCT 编译出的**可编辑 STEP**（零件 STEP + 装配 STEP）

## 2. 关键选型

| 项 | 决策 | 依据 |
|---|---|---|
| 运行时底座 | DSH preset 插件（仿 sample） | 用户确认 |
| 首期范围 | 仅 CAD 生成，CAE 预留 | 用户确认 |
| 输入形态 | 纯文本需求（2D 图纸/手绘/逆向留二期） | 用户确认 |
| 执行内核 | build123d + OCCT（受限特征子集） | 报告 §6.1/§8 路径 A，用户确认 |
| 建模语言 | build123d Python（非自研 DSL / 非 Feature Graph JSON 交付） | 用户确认 |
| 门禁强度 | 重门禁（仿 sample 四道门禁，裁剪为关键节点） | 用户确认 |
| 校验层 | 意图层 JSON + 代码层编译验证 | 用户确认 |
| 装配范围 | 首期含装配（零件 + 装配两级交付） | 用户确认 |
| 装配约束 | 语义 mate + 锚点 Joint + 确定性解析器 | 用户确认 |
| 迭代工具 | 补充 Zoo 式 `cad_modify`/`cad_measure`/`cad_edit_parameter` | 用户确认 |

## 3. 架构与数据流

```
DSH 会话（AI-CAD preset 插件）
  → 意图层 JSON（part 图 | assembly 图，三层 Top-down 细化）
  → validateIntent 校验器
  → build123d 零件源码 × N + 装配源码（交付物①）
  → OCCT 编译 + BRepCheck/ShapeFix → 零件 STEP + 装配 STEP（交付物②）
  → 几何验证（水密/体积/干涉检测）+ 测量决策
  → 人工确认 → 双文件交付
```

### 3.1 词法分离（移植 sample）
part 词汇与 assembly 词汇不得混图；装配 IR 引用零件文件，不内嵌 part 节点。意图层一个 JSON 内嵌所有 part 建模意图（完整产品视图），代码生成时拆为独立 `parts/*.py`。

### 3.2 状态持久化
仿 sample 的 `cad-state/`：
```
cad-state/<workflow_id>/
├── state.json / intent-L0.json / intent-L1.json / intent-L2.json
├── parts/hub.py / assembly.py（交付物①）
└── parts/hub.step / assembly.step（交付物②）
```
全部经 DSH `fs` 服务读写；每次 `refine_of` 保留上一版本快照（可回溯）。

## 4. 意图层 JSON schema

### 4.1 顶层
```json
{
  "schema_version": 2,
  "units": "meters",
  "ground": "<part_id>",
  "material": { "name": "...", "library": "..." },
  "parts": [ ... ],
  "assembly": { "components": [...], "connections": [...] },
  "verification": { ... }
}
```
- `units` 必须 meters（同 sample）
- `material` 仅 part 图；从首期标准化（name + library），供 CAE 复用
- `verification` 首期为几何签名，预留 `structural` 扩展槽

### 4.2 part 词汇表（受限特征子集）
- `sketch`（rectangle/circle/line/arc/ellipse/spline）+ `extrude`(boss/cut) + `fillet`/`chamfer` + `linear_pattern`/`circular_pattern` + `mirror`
- **不支持**：revolve/sweep/loft/rib/钣金（越界由校验器拦截并提示替代方案）
- 顺序引用约束（移植 sample `checkSketchRef`/`seen`）：extrude 必须紧跟其 sketch；pattern/mirror 的 feature 必须引用更早特征节点

### 4.3 assembly 词汇
**components**（引用零件，无 transform）：
```json
{ "id": "comp_hub", "source": { "path": "parts/hub.py", "hash": "sha256:..." }, "part_ref": "hub" }
```

**connections**（静/动连接，顶层性质判断）：
```json
// 动连接示例
{ "type": "kinematic", "joint": "cylindrical",
  "contact": [ { "part": "comp_hub", "anchor": { "kind": "cylinder", "near": [0,0,0.02] } },
               { "part": "comp_shaft", "anchor": { "kind": "cylinder", "near": [0,0,0] } } ],
  "direction": { "axis": [0,0,1], "rotation": true, "translation": true } }

// 静连接示例
{ "type": "static", "method": "bolt_fastening",
  "contact": [ { "part": "comp_cover", "anchor": { "kind": "plane", "near": [...] } },
               { "part": "comp_body", "anchor": { "kind": "plane", "near": [...] } } ],
  "position": { "normal_axis": [0,0,-1], "clearance": 0.0005 },
  "fasteners": { "holes": [ ... ], "pattern": "4x M6" } }
```

**连接性质划分（机械原理视角）**：
- **静连接**（static）：固定 6 自由度。method：weld/bond/bolt/rivet。不审计自由度，校验连接完整性（贴合面 + 孔位对齐 + 工艺合理）。
- **动连接**（kinematic）：保留部分自由度。joint 运动副查表 + 接触面几何推导运动方向。

**运动副查表**：

| 运动副 | 剩余 DOF | 要求接触面 | 运动方向 |
|---|---|---|---|
| Revolute 转动副 | 1 旋转 | 圆柱面接触 | 旋转轴 = 圆柱轴线 |
| Prismatic 移动副 | 1 平动 | 贴合平面 + 导向 | 平动 ∥ 贴合面 |
| Cylindrical 圆柱副 | 2（旋转+平动） | 圆柱面接触 | 轴 = 圆柱轴线 |
| Planar 平面副 | 3（面内滑动+绕法线转） | 平面接触 | 滑动面 ∥ 接触面 |
| Spherical 球副 | 3 旋转 | 球面/点接触 | 绕球心旋转 |
| Helical 螺旋副 | 1（旋转+平移联动） | 螺旋面/螺纹 | 导程比 |

### 4.4 装配约束机制
1. **锚点格式**：sample 式 `{ kind: plane|cylinder|cone|sphere|line|circle, near:[x,y,z], hint? }`
2. **确定性锚点解析器**：零件代码生成阶段，用 OCCT/build123d API 在零件几何上查询锚点（面/孔/轴），计算 Location 自动创建 Joint。LLM 只给语义锚点，不写坐标。
3. **位置由 mate 推导**：无显式 transform；build123d `connect_to()` 链式求解（两两配对局部对齐，非全局求解器）。
4. **基准零件**：显式声明 `ground`，缺省取第一个 component。

### 4.5 校验器 validateIntent（四层装配校验）
1. **可达性**：从 ground BFS 连接图，所有 component 可达
2. **无环性**：连接图为树
3. **静连接完备性**：static 必须有 position + contact + fasteners.holes 完整
4. **动连接一致性**（中校验）：joint 类型 ↔ direction 自由度匹配；锚点存在性在零件编译时由确定性解析器验证；装配阶段几何抽查（中心距/直径差）

### 4.6 Top-down 三层细化
```
Level 0 产品骨架（冻结）：功能/总体尺寸/材料/装配拓扑/基准与主尺寸
Level 1 零件定义（冻结）：主体几何 + 装配锚点归属
Level 2 特征细化（自主）：草图/孔位/圆角/公差
```
- 节点带 `status: frozen | proposed`；frozen 约束后续提交不得违反
- `cad_attach_intent` 接受 `refine_of` 追加细化提交；校验器做细化合法性 + 不违反冻结约束
- 门禁节奏：骨架确认 → 零件定义确认 → （特征自主细化）→ 交付确认

## 5. 工具集（19 个）

| 组 | 工具 | 作用 |
|---|---|---|
| 环境与工作流 | `cad_environment_profile` | 受限特征子集能力声明 + 版本坑 |
| | `cad_start_workflow` | 建工作流 + 9 intake 问题（含静/动连接性质澄清） |
| | `cad_get_state` | 查状态 |
| | `cad_next_action` | 返回当前阶段、未答问题、下一步动作 |
| 问答与门禁 | `cad_answer_question` | 回答 intake/计划问题并持久化 |
| | `cad_approve_brief` | 确认 brief，进入意图阶段 |
| | `cad_attach_plan` | 附加计划 + verification 验证块 |
| | `cad_approve_plan` | 确认计划（含骨架确认 / 零件确认两用） |
| 意图与校验 | `cad_attach_intent` | 意图层 JSON（part+assembly 图，refine_of 细化）校验 = validateIntent 中枢 |
| | `cad_approve_execution` | 显式批准"编译+验证" |
| 生成与编译 | `cad_generate_code` | 生成 build123d 零件 + 装配源码（交付物①） |
| | `cad_compile` | OCCT 编译零件/装配 STEP + ShapeFix（交付物②） |
| 测量与迭代 | `cad_measure` | 只读测量 + 决策建议（改参数/重生成/交付） |
| | `cad_modify` | 结构性迭代：改意图 JSON → 重新校验 → 重生成 |
| | `cad_edit_parameter` | 数值性迭代：改命名参数 → 重算 → 重编译 |
| 验证与收尾 | `cad_verify_execution` | 基础检查 + 几何验证（体积/水密/干涉） |
| | `cad_approve_delivery` | 交付确认：源码 + 零件 STEP + 装配 STEP |
| | `cad_prepare_retry` | 失败清理后重试门禁 |
| | `cad_health_check` | 探活 |

**迭代工具边界**：
- `cad_modify`（结构）→ 走完整意图层校验门禁，可跨装配
- `cad_edit_parameter`（数值）→ 轻量，仅校验参数存在 + 值域，触发重编译
- `cad_measure`（只读）→ 服务前三者与交付确认

## 6. 工作流（完整）

```
cad_start_workflow → 9 intake 问题 → cad_approve_brief
→ [L0] cad_attach_intent（骨架）→ cad_approve_plan（骨架确认）
→ [L1] cad_attach_intent（零件定义）→ cad_approve_plan（零件确认）
→ [L2] cad_attach_intent（特征细化，自主）
→ cad_generate_code → cad_compile
→ cad_measure → cad_verify_execution
→ cad_approve_delivery（交付双文件）
```

**失败恢复**：编译/验证失败 → 状态 `execution_failed`，清理确认后 `cad_prepare_retry` 重走；禁止自动重放。

## 7. CAE 仿真预留（首期不实现）

- **STEP 唯一中介格式**；生成链路只依赖 build123d/OCCT，不引入 FreeCAD 依赖（FreeCAD 仅作独立仿真后端进程，subprocess 调用）
- **仿真工具位**：预留 `cad_simulate_setup` / `cad_simulate_run` / `cad_simulate_report`，首期注册返回 `SIMULATION_NOT_IMPLEMENTED`
- **verification 扩展槽**：`structural: { analysis_type, constraints, loads }`
- **后端选定（记录）**：FreeCAD FEM(CalculiX) + Gmsh + meshio + PyVista（报告 §6.5）；FEA 反馈闭环为二期

## 8. 错误处理与测试

**错误处理**：
- 编译失败 → 明确错误（exit code + 输出截断），状态 `execution_failed`
- 几何验证失败 → `GEOMETRY_MISMATCH` / `GEOMETRY_UNVERIFIED`，不得称已生成
- 解析器查不到锚点 → 明确报错并列出 near 附近可选面/孔
- OCCT 数值精度 → 显式精度/fuzzy + ShapeFix/BRepCheck（报告 §6.7）

**测试**：
- validateIntent 单元测试：part 图/装配四层/静动连接词汇非法输入用例
- 确定性解析器测试：零件几何 + 锚点 → 断言 Joint 位置
- 编译管线测试：合法意图 → 源码 → STEP 往返 + ShapeFix 通过
- 契约测试：`cad_attach_intent` → `cad_generate_code` → `cad_compile` 端到端

## 9. 明确不做（YAGNI）

- 2D 工程图纸/手绘/逆向输入（二期）
- CAE 仿真实现（仅预留）
- 自研 DSL（建模语言 = build123d Python）
- revolve/sweep/loft/rib/钣金等复杂特征（受限子集）
- 强校验动连接（真实几何匹配，二期演进）
