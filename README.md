# dsh-cad2cae
AI Agent for CAD-CAE Integration Operating within Deepseek Harness

---

## src/cad_intent — 意图层校验器

`src/cad_intent/` 是 AI-CAD 意图层（intent JSON）的校验模块：在模型生成/细化之前，对 LLM 输出的意图层 JSON 做结构性校验并返回错误列表。纯标准库实现，零外部依赖。

### 公共 API

- `validate_intent(intent) -> list[str]`：校验完整意图 JSON，返回错误列表（空 = 通过）。
- `validate_refinement(previous, next, errors)`：校验 Top-down 细化提交，frozen 约束不得被修改。

### 分层校验

- **part 层**（`part_validator.py` + `graph.py`）：节点类型、草图图元、拉伸终止方式、顺序引用（extrude 紧跟其 sketch；pattern/mirror 引用更早特征）、基准面/边锚点。
- **assembly 层**（`assembly_validator.py` + `assembly_graph.py`）：component 引用 + 静/动连接词汇；四层检查：
  1. 可达性：所有 component 通过连接与基准零件连通
  2. 无环性：连接图为树（边数 < 节点数）
  3. 静完备：静连接需 position/method；bolt_fastening 需 fasteners.holes
  4. 动一致：joint 属六类运动副；direction 与运动副查表匹配；接触面 kind 匹配

### Top-down 细化

- `refinement.py`：细化提交不得修改冻结字段（units/ground/material）、不得删除 part 节点、不得改动连接特征（type/joint/method）。

### 单位约束

- 强制 `units == "meters"`：所有尺寸/坐标/深度/间距等均为米制，否则报错。

### 依赖

- 纯标准库（零外部依赖）。
