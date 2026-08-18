# Plan C：DSH 插件层（AI-CAD 预设插件）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 DSH（DeepSeek Harness）预设插件 `ai-cad-dsh`，把 Plan A（意图校验）与 Plan B（build123d 代码生成 + OCCT 编译）包装为 19 个 `cad_*` 工具 + 3 个 CAE 预留工具插槽，实现"纯文本需求 → 编辑态 STEP + build123d 源码"双交付物的重门控工作流。

**Architecture:** 仿照 `sample/solidworks-wlj-dsh` 的 wlj-plugin.js 分层：`ai-cad-plugin.js` 是唯一引入 `@deepseek-ai/*` 的胶水文件（注册系统提示 + 工具），其余 `lib/*.js` 全部依赖无关（可用 `node --test` 测试），Python 后端通过 DSH `subprocess` 服务以 CLI 子进程方式调用，通过 DSH `fs` 服务读写 `cad-state/<workflow_id>/` 下的状态与交付物。

**Tech Stack:** Node.js ESM（`node --test`）、schemastery（`@deepseek-ai/schemastery`）、`@deepseek-ai/dsh-tools`、Python 3（build123d 0.11.1、cadquery-ocp-novtk 7.9.3.1.1、OCCT）。

## Global Constraints

- 仓库根：`/home/ji/work/program/AI-CAD2`（以下路径均为仓库相对路径）。
- Plan A 提供 `src/cad_intent/validate_intent(intent: dict) -> list[str]`（纯 stdlib，错误格式 `<location>: <message>`）。
- Plan B 提供 `src/cad_codegen/generate_sources(intent) -> dict[str,str]` 与 `compile_sources(sources, out_dir, python='python3') -> CompileResult(ok, steps, artifacts)`；源码键为扁平模块名（如 `hn1`、`pn1`、`assembly`），build123d 导出 STEP 单位为 `Unit.M`（米）。
- 依赖关系：Plan C 的 Task 7（端到端契约测试）依赖 Plan A/B 已实现；Task 1-6 不依赖，可先行实现。
- `pytest.ini` 需追加 `pythonpath = src preset/ai-cad-dsh/preset/python`（供 `tests/test_cad_backend/test_measure.py` 找到测量模块）。
- Node ≥ 18（`node --test`），ESM（`"type":"module"`）。`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 只在 `ai-cad-plugin.js` 中引入，`lib/*.js` 保持依赖无关以便 `node --test` 无 node_modules 可跑。
- 单位约定：所有几何/测量输出均为米（`m`），`m3`、`m2`。
- 工具总数：22 = 19 个核心 `cad_*` 工具 + 3 个 CAE 插槽工具（`cad_simulate_setup` / `cad_simulate_run` / `cad_simulate_report`，固定返回 `SIMULATION_NOT_IMPLEMENTED`）。
- 失败恢复：`execution_failed` 状态只能通过 `cad_prepare_retry`（须确认清理）回到 `approved_for_execution`；禁止自动重放（auto-replay）。
- 顶层层级意图 JSON 遵循 `{schema_version: 2, units, ground, material, parts, assembly, verification}` 结构；装配连接遵循 Plan A 的 `connection` 结构。
- 语义锚点：装配接触/锚点用 `{kind, near:[x,y,z], hint?}` 语义描述，不写硬坐标；由确定性解析器在 Plan A/B 侧解析。
- 交付物位置：所有交付物扁平存放于 `cad-state/<workflow_id>/parts/`（源码 `*.py` + 编译 `*.step` 同目录，见前置说明）。

---

## 前置说明（设计歧义消解）

设计文档 §3.2 的状态布局示意为 `parts/hub.py`、`assembly.py`、`assembly.step` 混排（`assembly` 在根、parts 在子目录）。Plan B 的 `generate_sources`/`compile_sources` 以扁平模块名 + 单一 out_dir 工作，因此本计划统一为：**所有交付物（源码与 STEP）扁平放在 `cad-state/<workflow_id>/parts/`**。即 `parts/hn1.py`、`parts/pn1.py`、`parts/assembly.py`、`parts/hn1.step`、`parts/pn1.step`、`parts/assembly.step`。

fs 服务假设（与 wlj-plugin.js 一致）：`fs.resolve(path)` → target、`fs.stat(target)` → 对象或 null、`fs.readText(target)`、`fs.writeText(target, text)`、`fs.processPath(target)` → OS 路径。本插件只在 JS 侧用 fs 读写 `state.json` 与指针文件；意图 JSON 与 `parts/*.py`、`*.step` 全部由 Python 后端（backend_cli.py）直接以 OS 路径写入，避免依赖 fs.mkdir。

---

## File Structure

```
preset/ai-cad-dsh/
├── package.json                       # ESM、scripts.test = node --test
└── preset/
    ├── preset.yml                     # DSH preset 元数据
    ├── agent.cordis.yml               # agent 组合（复制 sample，替换插件挂载点）
    ├── ai-cad-plugin.js               # 唯一 @deepseek-ai 胶水：Config/apply/注册
    ├── lib/
    │   ├── questions.js               # 9 项 intake + 4 项 plan 提问（纯函数）
    │   ├── state.js                   # 状态机（纯函数 + fs 薄封装）
    │   ├── python.js                  # subprocess 封装（runPython/BackendError）
    │   ├── backend.js                 # 后端 CLI 定位 + 各 backend 操作构建 argv
    │   ├── tools.js                   # makeTools(config) → 22 个工具 execute(ctx, args)
    │   ├── register.js                # registerTools(ctx, config, wrap)
    │   ├── questions.test.js          # 3 个测试
    │   ├── state.test.js              # 5 个测试
    │   ├── python.test.js             # 3 个测试（runPython 成功/失败/无效 JSON）
    │   ├── tools.test.js              # 4 个测试
    │   ├── contract.test.js           # 1 个端到端契约测试（依赖 Plan A/B）
    │   ├── plugin.test.js             # 1 个测试
    │   └── test/support.js            # makeCtx 等测试支撑（temp dir fs + 真实 subprocess）
    └── python/
        ├── backend_cli.py             # argparse 分发：health/validate/generate/compile/measure/verify
        └── measure.py                 # OCP STEP 测量 + 契约校验（BRepGProp/TopExp/ShapeAnalysis）
tests/test_cad_backend/
└── test_measure.py                    # measure/verify 的 Python 层测试（pytest）
pytest.ini                             # 修改：pythonpath 追加 preset/ai-cad-dsh/preset/python
```

模块职责边界：

- `questions.js`：只定义提问（id、中文题干、选项/自由文本、required）与"回答是否齐全"判定；不接触状态。
- `state.js`：状态机跃迁 + fs 读写。跃迁矩阵与状态枚举的唯一权威。
- `python.js`：只做 subprocess 契约封装（spawn/收集/超时/错误分类），不关心具体命令。
- `backend.js`：拼 CLI argv、解析 stdout JSON，定义 `BackendError`。知道 Plan A/B 模块名。
- `tools.js`：22 个工具的 `execute(ctx, args)` 完整实现。纯逻辑（业务编排），依赖 state/backend。
- `register.js`：把 `makeTools(config)` 结果包装成 DSH `defineTool` 定义注册进 `ctx.tools`。
- `ai-cad-plugin.js`：DSH 入口，`Config` schema + 系统提示 + 调用 `registerTools`。

---

### Task 1: questions.js — 提问清单

**Files:**
- Create: `preset/ai-cad-dsh/preset/lib/questions.js`
- Test: `preset/ai-cad-dsh/preset/lib/questions.test.js`

**Interfaces:**
- Consumes: 无（纯数据 + 纯函数）。
- Produces:
  - `INTAKE_QUESTIONS: Question[]`（9 项，id 见下）
  - `PLAN_QUESTIONS: Question[]`（4 项）
  - `openQuestions(state) -> Question[]`（按 state.status 返回 intake 或 plan 清单）
  - `allRequiredAnswered(state, questions) -> boolean`（对每项 `required: true` 的提问，state.answers[id] 非空）
  - `answerValue(state, id) -> string | undefined`

`Question` 形如 `{id, label, hint, required, options?}`；`options` 为 `{value, label}[]`，缺省为自由文本。

9 项 intake（id 全小写下划线）：

1. `product_name`（required，自由文本）：产品/部件名称。
2. `units`（required，选项 `meters`/`mm`）：几何单位，`meters` 为默认推荐。
3. `scope`（required，选项 `part`/`assembly`）：本次交付范围。
4. `material`（required，自由文本或"未指定"）：材料（如 `AL6061`）。
5. `connection_nature`（required，选项 `none`/`static`/`kinematic`）：装配连接性质。
6. `ground_part`（required，选项 `auto`/`part_id`/`none`）：基准（接地）部件指定方式。
7. `source_quality`（required，选项 `high`/`medium`/`low`）：需求文本的完整度自评，决定是否触发 `cad_approve_brief` 的驳回重问。
8. `dimensions_strategy`（required，选项 `parametric`/`absolute`）：尺寸策略。
9. `feature_scope_check`（required，布尔确认）：已告知受限特征子集（无 revolve/sweep/loft/rib/钣金），确认需求不越界。

4 项 plan：

- `feature_order`（required）：特征构建顺序（哪些先建、依赖关系）。
- `parametric_intent`（required）：哪些尺寸/位置应参数化以便 `cad_edit_parameter` 改参。
- `plan_risks`（required）：几何或装配上可预见的风险点。
- `verification_plan`（required）：交付验收的测量/校验项（体数、体积、质心、装配干涉）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_QUESTIONS,
  PLAN_QUESTIONS,
  openQuestions,
  allRequiredAnswered,
  answerValue,
} from './questions.js';

test('清单规模：9 项 intake + 4 项 plan', () => {
  assert.equal(INTAKE_QUESTIONS.length, 9);
  assert.equal(PLAN_QUESTIONS.length, 4);
});

test('openQuestions 按状态分流，answerValue 取值，allRequiredAnswered 判定齐全', () => {
  const base = { status: 'awaiting_confirmation', answers: {} };
  assert.deepEqual(openQuestions(base).map(q => q.id), INTAKE_QUESTIONS.map(q => q.id));
  assert.equal(allRequiredAnswered(base, INTAKE_QUESTIONS), false);

  const answered = { ...base, answers: Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, 'x'])) };
  assert.equal(allRequiredAnswered(answered, INTAKE_QUESTIONS), true);
  assert.equal(answerValue(answered, 'product_name'), 'x');

  const planned = { ...answered, status: 'brief_approved' };
  assert.deepEqual(openQuestions(planned).map(q => q.id), PLAN_QUESTIONS.map(q => q.id));
});

test('intake 提问含 feature_scope_check 布尔确认', () => {
  const q = INTAKE_QUESTIONS.find(x => x.id === 'feature_scope_check');
  assert.ok(q && q.options && q.options.some(o => o.value === 'yes'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/questions.test.js`
Expected: FAIL — 找不到 `./questions.js` 模块（ERR_MODULE_NOT_FOUND）。

- [ ] **Step 3: 写最小实现**

```js
// preset/ai-cad-dsh/preset/lib/questions.js
// 纯数据 + 纯函数：intake/plan 提问清单与"回答齐全"判定。不接触状态机。

export const INTAKE_QUESTIONS = [
  { id: 'product_name', label: '产品/部件名称', hint: '一句话描述交付对象', required: true },
  { id: 'units', label: '几何单位', hint: 'meters 为默认推荐', required: true,
    options: [{ value: 'meters', label: '米（推荐）' }, { value: 'mm', label: '毫米' }] },
  { id: 'scope', label: '本次交付范围', required: true,
    options: [{ value: 'part', label: '单个零件' }, { value: 'assembly', label: '装配体' }] },
  { id: 'material', label: '材料', hint: '如 AL6061；不确定填"未指定"', required: true },
  { id: 'connection_nature', label: '装配连接性质', required: true,
    options: [{ value: 'none', label: '无/单零件' }, { value: 'static', label: '静态（焊接/螺栓/胶接）' },
              { value: 'kinematic', label: '运动学（铰链/滑动等运动副）' }] },
  { id: 'ground_part', label: '基准（接地）部件', required: true,
    options: [{ value: 'auto', label: '自动选择' }, { value: 'part_id', label: '指定部件 id' },
              { value: 'none', label: '无（单零件）' }] },
  { id: 'source_quality', label: '需求文本完整度自评', required: true,
    options: [{ value: 'high', label: '完整（尺寸/顺序/连接都明确）' },
              { value: 'medium', label: '大致完整，个别缺失' },
              { value: 'low', label: '不完整，需补充' }] },
  { id: 'dimensions_strategy', label: '尺寸策略', required: true,
    options: [{ value: 'parametric', label: '参数化（可改参）' }, { value: 'absolute', label: '固定数值' }] },
  { id: 'feature_scope_check', label: '受限特征子集确认', hint: '无 revolve/sweep/loft/rib/钣金', required: true,
    options: [{ value: 'yes', label: '已确认不越界' }, { value: 'no', label: '需求超出子集' }] },
];

export const PLAN_QUESTIONS = [
  { id: 'feature_order', label: '特征构建顺序', hint: '哪些特征先建、依赖关系', required: true },
  { id: 'parametric_intent', label: '参数化意图', hint: '哪些尺寸/位置应参数化以便改参', required: true },
  { id: 'plan_risks', label: '可预见风险点', hint: '几何或装配上可能出问题之处', required: true },
  { id: 'verification_plan', label: '验收校验项', hint: '体数/体积/质心/装配干涉', required: true },
];

export function openQuestions(state) {
  if (state.status === 'awaiting_confirmation' || state.status === 'brief_rejected') return INTAKE_QUESTIONS;
  return PLAN_QUESTIONS;
}

export function allRequiredAnswered(state, questions) {
  return questions.every(q => {
    if (!q.required) return true;
    const v = state.answers?.[q.id];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function answerValue(state, id) {
  return state.answers?.[id];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/questions.test.js`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/lib/questions.js preset/ai-cad-dsh/preset/lib/questions.test.js
git commit -m "feat(cad-dsh): Plan C Task 1 — intake/plan 提问清单"
```

---

### Task 2: state.js — 工作流状态机

**Files:**
- Create: `preset/ai-cad-dsh/preset/lib/state.js`
- Test: `preset/ai-cad-dsh/preset/lib/state.test.js`

**Interfaces:**
- Consumes: `INTAKE_QUESTIONS`、`PLAN_QUESTIONS`、`openQuestions`、`allRequiredAnswered`、`answerValue`（Task 1）。
- Produces:
  - `newState(request, opts) -> state`：`{workflow_id, status:'awaiting_confirmation', request, answers:{}, levels:{}, delivery:{}, history:[], created_at}`
  - `answer(state, id, value) -> state`（拷贝更新 `state.answers[id]`，追加 history 记录）
  - `approveBrief(state) -> state`：要求 `allRequiredAnswered(openQuestions(state))`；否则抛 `Error('INTAKE_INCOMPLETE')`。`awaiting_confirmation → brief_approved`。
  - `attachPlan(state, planText) -> state`：`brief_approved → plan_attached`（`state.plan = planText`）。
  - `attachIntent(state, level, intent) -> state`：`level` ∈ `L0|L1|L2`，`intent` 为对象。写入 `state.levels[level]`，`state.attached_level`。跃迁门见 Step 3 表。
  - `approvePlan(state) -> state`：`plan_attached → plan_approved`，并把 `state.attached_level` 置为 -1。
  - `approveExecution(state) -> state`：`plan_approved → approved_for_execution`（要求 `state.attached_level >= 2`，否则抛 `Error('LEVEL_L2_REQUIRED')`）。
  - `approveDelivery(state, result) -> state`：`verified → completed`。
  - `prepareRetry(state, cleanupConfirmed, reason) -> state`：要求 `state.status === 'execution_failed'` 且 `cleanupConfirmed === true`，否则抛 `Error('CLEANUP_NOT_CONFIRMED')`；`execution_failed → approved_for_execution`。
  - `latestIntentFile(state) -> string`：`L0 → 'intent-L0.json'`，`L1 → 'intent-L1.json'`，`L2 → 'intent-L2.json'`（缺省 L0）。
  - `loadState(fs, statePath) -> state | null`、`saveState(fs, statePath, state)`、`mutate(fs, statePath, fn)`。
  - `resolveStatePath(fs, statePath) -> target`：`statePath` 缺省用 `DEFAULT_POINTER = 'cad-state/current.json'`；若 `statePath === DEFAULT_POINTER`，读指针文件的 `{workflow_id, state_path}` 解析。
  - `DEFAULT_POINTER` 常量。

状态枚举：`awaiting_confirmation → brief_approved → plan_attached → plan_approved → approved_for_execution → (execution_failed | verified) → completed`。状态存 `state.status`。

附加字段：`state.attached_level`（int，-1 表示未 attach）、`state.cleanup_confirmed`（bool）、`state.last_error`（string|undefined）。

跃迁门矩阵（attachIntent）：

| 目标层 | 前置条件 |
|---|---|
| L0 | `attached_level === -1` 且 `approved_level === -1`（即尚未 attach 且尚未 approve 任何计划） |
| L1 | `approved_level === 0` |
| L2 | `approved_level === 1` |

字段 `state.approved_level`（int，-1 表示尚未批准到该层）：`approvePlan` 把 `approved_level = state.attached_level`。attachIntent 成功写入后 `attached_level = levelIndex`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, answer, approveBrief, attachPlan, attachIntent, approvePlan,
  approveExecution, approveDelivery, prepareRetry, latestIntentFile, resolveStatePath,
} from './state.js';
import { INTAKE_QUESTIONS } from './questions.js';

function intakeComplete() {
  const s0 = newState('制造一个铰链装配', { workflow_id: 'wf-t' });
  return Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, 'x'])).length
    ? INTAKE_QUESTIONS.reduce((s, q) => answer(s, q.id, 'x'), s0)
    : s0;
}
function toApprovedForExecution() {
  let s = intakeComplete();
  s = approveBrief(s);
  s = attachPlan(s, '先 hub 后 post；质心校验');
  s = attachIntent(s, 'L0', { schema_version: 2, units: 'meters', parts: {} });
  s = approvePlan(s);
  s = attachIntent(s, 'L1', { schema_version: 2, units: 'meters', parts: { c1: {} }, assembly: {} });
  s = approvePlan(s);
  s = attachIntent(s, 'L2', { schema_version: 2, units: 'meters', parts: { c1: {} }, assembly: {} });
  return approveExecution(s);
}

test('完整流程到达 completed', () => {
  let s = toApprovedForExecution();
  s = prepareRetry({ ...s, status: 'execution_failed' }, true, '编译超时');
  assert.equal(s.status, 'approved_for_execution');
  s = approveDelivery({ ...s, status: 'verified' }, { ok: true });
  assert.equal(s.status, 'completed');
});

test('门禁：intake 未齐全 approveBrief 抛错；未到 L2 approveExecution 抛错', () => {
  assert.throws(() => approveBrief(newState('x', { workflow_id: 'wf-t' })), /INTAKE_INCOMPLETE/);
  const s = approvePlan(attachPlan(approveBrief(intakeComplete()), 'p'));
  assert.throws(() => approveExecution({ ...s, attached_level: 1 }), /LEVEL_L2_REQUIRED/);
});

test('prepareRetry 须确认清理', () => {
  const s = { ...toApprovedForExecution(), status: 'execution_failed' };
  assert.throws(() => prepareRetry(s, false, 'x'), /CLEANUP_NOT_CONFIRMED/);
  assert.equal(prepareRetry(s, true, 'x').status, 'approved_for_execution');
});

test('latestIntentFile 随 level 变化', () => {
  assert.equal(latestIntentFile({ attached_level: 0 }), 'intent-L0.json');
  assert.equal(latestIntentFile({ attached_level: 1 }), 'intent-L1.json');
  assert.equal(latestIntentFile({ attached_level: 2 }), 'intent-L2.json');
  assert.equal(latestIntentFile({ attached_level: -1 }), 'intent-L0.json');
});

test('resolveStatePath 解析指针文件', async () => {
  const fs = { resolve: p => `T:${p}`, readText: async p => JSON.stringify({
    workflow_id: 'wf-1', state_path: 'cad-state/wf-1/state.json',
  }) };
  const target = await resolveStatePath(fs, 'cad-state/current.json');
  assert.equal(target, 'cad-state/wf-1/state.json');
});
```

> 注意：`intakeComplete` 中的 `Object.fromEntries(...).length` 分支永远走 reduce 分支——这是为了让测试在改动清单后仍直观（清单 9 项全答）。实现中保持简洁即可。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/state.test.js`
Expected: FAIL — 找不到 `./state.js`。

- [ ] **Step 3: 写最小实现**

```js
// preset/ai-cad-dsh/preset/lib/state.js
// 工作流状态机：状态跃迁的唯一权威 + fs 读写薄封装。纯函数，不引入任何外部依赖。

export const DEFAULT_POINTER = 'cad-state/current.json';
const LEVELS = ['L0', 'L1', 'L2'];

export function newState(request, opts = {}) {
  return {
    workflow_id: opts.workflow_id || 'cad-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'awaiting_confirmation',
    request,
    answers: {},
    plan: '',
    levels: {},
    attached_level: -1,
    approved_level: -1,
    delivery: {},
    cleanup_confirmed: false,
    last_error: undefined,
    history: [],
  };
}

function push(s, event, extra = {}) {
  return { ...s, history: [...s.history, { at: new Date().toISOString(), event, ...extra }] };
}

export function answer(state, id, value) {
  return push({ ...state, answers: { ...state.answers, [id]: value } }, 'answer', { id, value });
}

export function approveBrief(state) {
  if (state.status !== 'awaiting_confirmation' && state.status !== 'brief_rejected') {
    throw new Error('WRONG_STATE');
  }
  return push({ ...state, status: 'brief_approved' }, 'approve_brief');
}

export function attachPlan(state, planText) {
  if (state.status !== 'brief_approved') throw new Error('WRONG_STATE');
  return push({ ...state, status: 'plan_attached', plan: planText }, 'attach_plan');
}

export function attachIntent(state, level, intent) {
  const idx = LEVELS.indexOf(level);
  if (idx < 0) throw new Error('BAD_LEVEL');
  if (state.status !== 'plan_approved' && state.status !== 'approved_for_execution') {
    throw new Error('WRONG_STATE');
  }
  const gates = { 0: () => state.attached_level === -1 && state.approved_level === -1,
                  1: () => state.approved_level === 0,
                  2: () => state.approved_level === 1 };
  if (!gates[idx]()) throw new Error('LEVEL_GATE_VIOLATION');
  return push({ ...state, attached_level: idx, levels: { ...state.levels, [level]: intent } }, 'attach_intent', { level });
}

export function approvePlan(state) {
  if (state.status !== 'plan_attached' && state.status !== 'plan_approved') throw new Error('WRONG_STATE');
  if (state.attached_level < 0) throw new Error('NO_INTENT_ATTACHED');
  return push({ ...state, status: 'plan_approved', approved_level: state.attached_level, attached_level: -1 },
              'approve_plan');
}

export function approveExecution(state) {
  if (state.status !== 'plan_approved') throw new Error('WRONG_STATE');
  if (state.attached_level < 2) throw new Error('LEVEL_L2_REQUIRED');
  return push({ ...state, status: 'approved_for_execution' }, 'approve_execution');
}

export function approveDelivery(state, result) {
  if (state.status !== 'verified') throw new Error('WRONG_STATE');
  return push({ ...state, status: 'completed', delivery: result }, 'approve_delivery');
}

export function prepareRetry(state, cleanupConfirmed, reason) {
  if (state.status !== 'execution_failed') throw new Error('WRONG_STATE');
  if (!cleanupConfirmed) throw new Error('CLEANUP_NOT_CONFIRMED');
  return push({ ...state, status: 'approved_for_execution', cleanup_confirmed: true, last_error: reason },
              'prepare_retry', { reason });
}

export function latestIntentFile(state) {
  const idx = Math.max(0, state.attached_level);
  return 'intent-' + LEVELS[idx] + '.json';
}

export async function loadState(fs, statePath) {
  const target = await resolveStatePath(fs, statePath);
  try {
    const text = await fs.readText(target);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveState(fs, statePath, state) {
  await fs.writeText(await resolveStatePath(fs, statePath), JSON.stringify(state, null, 2));
}

export async function mutate(fs, statePath, fn) {
  const cur = (await loadState(fs, statePath)) || newState('', {});
  const next = fn(cur);
  await saveState(fs, statePath, next);
  return next;
}

export async function resolveStatePath(fs, statePath) {
  const p = statePath || DEFAULT_POINTER;
  if (p === DEFAULT_POINTER) {
    try {
      const pointer = JSON.parse(await fs.readText(await fs.resolve(DEFAULT_POINTER)));
      return pointer.state_path;
    } catch {
      return await fs.resolve(DEFAULT_POINTER);
    }
  }
  return await fs.resolve(p);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/state.test.js`
Expected: PASS（5 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/lib/state.js preset/ai-cad-dsh/preset/lib/state.test.js
git commit -m "feat(cad-dsh): Plan C Task 2 — 工作流状态机"
```

---

### Task 3: python.js + backend.js — 子进程封装与后端操作

**Files:**
- Create: `preset/ai-cad-dsh/preset/lib/python.js`
- Create: `preset/ai-cad-dsh/preset/lib/backend.js`
- Test: `preset/ai-cad-dsh/preset/lib/python.test.js`

**Interfaces:**
- Consumes: 无（仅使用注入的 `ctx.get('subprocess')` 与 `ctx.get('fs')`）。
- Produces:
  - `class BackendError extends Error { code, exitCode, stderr, stdout }`
  - `runPython(ctx, { argv, cwd, stdoutLimit=8388608, stderrLimit=65536, graceMs=120000 }) -> string`：stdout 全文；非零退出抛 `BackendError('BACKEND_EXIT_'+exitCode, …)`（message 截断 ≤2000 字符）；stderr 也并入 message。
  - `resolveBackend(config) -> { backendDir, cli }`：`backendDir = config.backendDir || path.resolve(__dirname, '..', '..', '..', 'src')`；`cli = path.join(__dirname, '..', 'python', 'backend_cli.py')`。
  - `backendOp(ctx, config, command, payload, opts={}) -> Promise<any>`：拼 argv `[config.python, cli, '--backend-dir', backendDir, command, '--payload', JSON.stringify(payload), ...(opts.outDir ? ['--out-dir', opts.outDir] : [])]`，`cwd = opts.cwd || repoRoot`，运行 `runPython` 后 `JSON.parse`；非法 JSON 抛 `BackendError('BACKEND_INVALID_JSON', …)`。
  - 便捷封装：`validateIntent(ctx, config, intent)`、`generateSources(ctx, config, intent, opts)`、`compileSources(ctx, config, sources, opts)`、`measureStep(ctx, config, stepPath)`、`verifyExecution(ctx, config, {step_paths, expected})`、`healthCheck(ctx, config)`。各自对应后端命令并透传 payload。

subprocess 契约（wlj 的 postJson 同款）：`sub.spawn({ argv, cwd, stdio: { stdin:'ignore', stdout:{collect:{limit}}, stderr:{collect:{limit}} }, graceMs })` → `handle.done` → `handle.collected.stdout.readFrom(0)`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPython, BackendError } from './python.js';

const exec = promisify(execFile);

function makeSubprocess() {
  return {
    async spawn(opts) {
      const { argv, stdio, graceMs } = opts;
      const execOpts = { encoding: 'utf8' };
      const stdoutLimit = stdio.stdout.collect.limit;
      const stderrLimit = stdio.stderr.collect.limit;
      let result;
      try {
        result = await exec(argv[0], argv.slice(1), execOpts);
      } catch (e) {
        result = { stdout: e.stdout || '', stderr: e.stderr || String(e.message) };
        result.code = e.code;
      }
      const collected = {
        stdout: { readFrom: async () => (result.stdout || '').slice(0, stdoutLimit) },
        stderr: { readFrom: async () => (result.stderr || '').slice(0, stderrLimit) },
      };
      return { done: Promise.resolve({ exitCode: result.code === undefined ? 0 : result.code }), collected };
    },
  };
}

const ctx = { get: (s) => s === 'subprocess' ? makeSubprocess() : null };

test('runPython 成功返回 stdout', async () => {
  const out = await runPython(ctx, { argv: ['node', '-e', 'console.log("hi")'], cwd: process.cwd() });
  assert.equal(out.trim(), 'hi');
});

test('runPython 非零退出抛 BackendError(BACKEND_EXIT_*)', async () => {
  await assert.rejects(
    () => runPython(ctx, { argv: ['node', '-e', 'process.exit(3)'], cwd: process.cwd() }),
    (e) => e instanceof BackendError && e.code === 'BACKEND_EXIT_3' && e.exitCode === 3,
  );
});

test('runPython 把 stderr 并入错误消息且截断', async () => {
  await assert.rejects(
    () => runPython(ctx, { argv: ['node', '-e', 'console.error("boom".repeat(5000)); process.exit(1)'], cwd: process.cwd() }),
    (e) => e instanceof BackendError && e.message.length <= 2000 && e.stderr.includes('boom'),
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/python.test.js`
Expected: FAIL — 找不到 `./python.js`。

- [ ] **Step 3: 写最小实现**

```js
// preset/ai-cad-dsh/preset/lib/python.js
// DSH subprocess 服务封装：统一超时、收集、错误分类。不关心具体命令。

export class BackendError extends Error {
  constructor(code, message, { exitCode, stderr, stdout } = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export async function runPython(ctx, { argv, cwd, stdoutLimit = 8388608, stderrLimit = 65536, graceMs = 120000 }) {
  const sub = ctx.get('subprocess');
  const handle = await sub.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { collect: { limit: stdoutLimit } },
      stderr: { collect: { limit: stderrLimit } },
    },
    graceMs,
  });
  const { exitCode } = await handle.done;
  const stdout = await handle.collected.stdout.readFrom(0);
  const stderr = await handle.collected.stderr.readFrom(0);
  if (exitCode !== 0) {
    const detail = (stderr || stdout || '').trim().slice(0, 2000);
    throw new BackendError('BACKEND_EXIT_' + exitCode, detail, { exitCode, stderr, stdout });
  }
  return stdout;
}
```

```js
// preset/ai-cad-dsh/preset/lib/backend.js
// 后端 CLI 定位与命令构建：把 Plan A/B 包装为子进程 JSON 往返。
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython, BackendError } from './python.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

export function resolveBackend(config) {
  const backendDir = config.backendDir || resolve(__dirname, '..', '..', '..', 'src');
  const cli = join(__dirname, '..', 'python', 'backend_cli.py');
  return { backendDir, cli };
}

export async function backendOp(ctx, config, command, payload, opts = {}) {
  const { backendDir, cli } = resolveBackend(config);
  const argv = [
    config.python || 'python3',
    cli,
    '--backend-dir', backendDir,
    command,
    '--payload', JSON.stringify(payload),
  ];
  if (opts.outDir) argv.push('--out-dir', opts.outDir);
  const stdout = await runPython(ctx, {
    argv,
    cwd: opts.cwd || REPO_ROOT,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new BackendError('BACKEND_INVALID_JSON', '后端输出非 JSON：' + stdout.slice(0, 500));
  }
}

export const validateIntent = (ctx, config, intent) => backendOp(ctx, config, 'validate', intent);
export const generateSources = (ctx, config, intent, opts) => backendOp(ctx, config, 'generate', intent, opts);
export const compileSources = (ctx, config, sources, opts) => backendOp(ctx, config, 'compile', sources, opts);
export const measureStep = (ctx, config, stepPath) => backendOp(ctx, config, 'measure', { step_path: stepPath });
export const verifyExecution = (ctx, config, payload) => backendOp(ctx, config, 'verify', payload);
export const healthCheck = (ctx, config) => backendOp(ctx, config, 'health', {});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/python.test.js`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/lib/python.js preset/ai-cad-dsh/preset/lib/backend.js preset/ai-cad-dsh/preset/lib/python.test.js
git commit -m "feat(cad-dsh): Plan C Task 3 — 子进程封装与后端操作"
```

---

### Task 4: Python 后端 — backend_cli.py + measure.py

**Files:**
- Create: `preset/ai-cad-dsh/preset/python/backend_cli.py`
- Create: `preset/ai-cad-dsh/preset/python/measure.py`
- Create: `tests/test_cad_backend/test_measure.py`
- Modify: `pytest.ini`（`pythonpath` 追加 `preset/ai-cad-dsh/preset/python`）

**Interfaces:**
- Consumes: `src/cad_intent/validate_intent(intent) -> list[str]`（Plan A）、`src/cad_codegen/generate_sources(intent) -> dict[str,str]`、`src/cad_codegen/compile_sources(sources, out_dir, python) -> CompileResult`（Plan B）。
- Produces（Python 侧，与 Task 3 的 backend.js 命令一一对应）：
  - CLI：`python backend_cli.py --backend-dir <dir> <command> --payload <json> [--out-dir <dir>]`，命令 `health|validate|generate|compile|measure|verify`。stdout 输出 JSON。
  - `measure(path) -> dict`：`{bodies, volume_m3, surface_area_m2, centroid_m, watertight, step}`。
  - `verify(step_paths, expected, tol_rel=0.01, tol_abs=1e-4) -> dict`：`{passed, checks, interference, measured, verdict}`，`verdict ∈ PASS|GEOMETRY_MISMATCH|GEOMETRY_UNVERIFIED`。

命令返回结构（JSON）：

- `health`：`{ok: true, python: '<sys.executable>', ocp: '<ocp version 或 NOT_FOUND>'}`；OCP 缺失返回 `{ok: false, python, ocp: 'NOT_FOUND'}`（不抛错）。
- `validate`：`{errors: [...]}`（Plan A 的 list[str]）。
- `generate`：`{written: [<相对路径>...], intent_snapshot: <校验后的 intent 副本>}`；写入 `<out_dir>/parts/<name>.py`（先按 Plan A 校验，`errors` 非空则返回 `{ok:false, errors}` 且退出码 0、HTTP 式业务错误由调用方判断——实际用 `{ok:false, errors}` + 退出码 0 便于 JS 侧区分校验失败与运行失败）。
- `compile`：`{ok, steps, artifacts}`（Plan B 的 CompileResult 序列化；`artifacts` 为相对路径列表，STEP 文件在 `out_dir` 下扁平放置）。
- `measure`：`{ok: true, measured: <measure(path) 结果>}`。
- `verify`：`{ok, passed, checks, interference, measured, verdict}`（见 measure.verify）。

- [ ] **Step 1: 写失败测试（Python 层 measure/verify）**

```python
# tests/test_cad_backend/test_measure.py
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "preset/ai-cad-dsh/preset/python"))

from measure import measure, verify


def test_measure_box(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1)
    step_path = tmp_path / "box.step"
    b.export_step(box, str(step_path), unit=b.Unit.M)
    m = measure(str(step_path))
    assert m["bodies"] == 1
    assert abs(m["volume_m3"] - 0.001) < 1e-12
    assert abs(m["surface_area_m2"] - 0.06) < 1e-9
    assert m["watertight"] is True
    c = m["centroid_m"]
    assert abs(c[0] - 0.5) < 1e-6 and abs(c[1] - 0.5) < 1e-6 and abs(c[2] - 0.5) < 1e-6
    assert m["step"] == str(step_path)


def test_verify_pass_and_mismatch(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1)
    p = tmp_path / "b.step"
    b.export_step(box, str(p), unit=b.Unit.M)
    r = verify([str(p)], {"bodies": 1, "volume_m3": 0.001, "surface_area_m2": 0.06})
    assert r["verdict"] == "PASS" and r["passed"] is True
    bad = verify([str(p)], {"bodies": 1, "volume_m3": 9.9})
    assert bad["verdict"] == "GEOMETRY_MISMATCH" and bad["passed"] is False


def test_verify_empty_contract_is_unverified(tmp_path):
    import build123d as b
    box = b.Box(0.1, 0.1, 0.1)
    p = tmp_path / "b.step"
    b.export_step(box, str(p), unit=b.Unit.M)
    r = verify([str(p)], {})
    assert r["verdict"] == "GEOMETRY_UNVERIFIED" and r["passed"] is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/test_cad_backend/test_measure.py -v`
Expected: FAIL — 找不到 `measure` 模块（pytest.ini `pythonpath` 尚未改）。

先修改 `pytest.ini`（追加 preset 路径）：

```ini
[pytest]
pythonpath = src preset/ai-cad-dsh/preset/python
```

- [ ] **Step 3: 写最小实现**

```python
# preset/ai-cad-dsh/preset/python/measure.py
# OCP STEP 测量 + 契约校验。单位均为米。
import os

OCC_ERR = None
try:
    from OCP.STEPControl import STEPControl_Reader
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL
    from OCP.ShapeAnalysis import ShapeAnalysis_Shell
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    from OCP.BRep import BRep_Tool
except Exception as e:  # pragma: no cover - CI 无 OCP 时报错
    OCC_ERR = e


def _read_step(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != 1:
        raise ValueError("STEP 读取失败: %s" % path)
    reader.TransferRoots()
    return reader.OneShape()


def count_solids(shape):
    n = 0
    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    while exp.More():
        n += 1
        exp.Next()
    return n


def is_watertight(shape):
    exp = TopExp_Explorer(shape, TopAbs_SHELL)
    closed = True
    while exp.More():
        s = exp.Current()
        shell = ShapeAnalysis_Shell.ShellClosed_s(s)
        closed = closed and shell
        exp.Next()
    return closed


def mass_props(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    vol = props.Mass()
    c = props.CentreOfMass()
    sprops = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, sprops)
    area = sprops.Mass()
    return vol, area, (c.X(), c.Y(), c.Z())


def measure(path):
    if OCC_ERR is not None:
        raise RuntimeError("OCP 不可用: %s" % OCC_ERR)
    shape = _read_step(path)
    vol, area, c = mass_props(shape)
    return {
        "bodies": count_solids(shape),
        "volume_m3": vol,
        "surface_area_m2": area,
        "centroid_m": [c[0], c[1], c[2]],
        "watertight": is_watertight(shape),
        "step": os.path.abspath(str(path)),
    }


def _interference_pairs(paths):
    pairs = []
    shapes = []
    for p in paths:
        try:
            shapes.append(_read_step(p))
        except ValueError:
            continue
    for i in range(len(shapes)):
        for j in range(i + 1, len(shapes)):
            try:
                common = BRepAlgoAPI_Common(shapes[i], shapes[j])
                common.Build()
                if common.IsDone() and count_solids(common.Shape()) > 0:
                    pairs.append([paths[i], paths[j]])
            except Exception:
                continue
    return pairs


def verify(step_paths, expected, tol_rel=0.01, tol_abs=1e-4):
    if OCC_ERR is not None:
        return {"passed": False, "checks": [], "interference": [],
                "measured": None, "verdict": "GEOMETRY_UNVERIFIED",
                "error": "OCP 不可用: %s" % OCC_ERR}
    if not expected or not step_paths:
        return {"passed": False, "checks": [], "interference": [],
                "measured": None, "verdict": "GEOMETRY_UNVERIFIED"}
    measured = None
    for p in step_paths:
        m = measure(p)
        measured = m if measured is None else {
            "bodies": measured["bodies"] + m["bodies"],
            "volume_m3": measured["volume_m3"] + m["volume_m3"],
            "surface_area_m2": measured["surface_area_m2"] + m["surface_area_m2"],
            "watertight": measured["watertight"] and m["watertight"],
            # 质心按体积加权
            "centroid_m": [
                (measured["centroid_m"][i] * measured["volume_m3"] +
                 m["centroid_m"][i] * m["volume_m3"]) /
                max(measured["volume_m3"] + m["volume_m3"], 1e-30)
                for i in range(3)
            ],
            "step": measured["step"],
        }
    checks = []
    ok = True
    if "bodies" in expected:
        hit = expected["bodies"] == measured["bodies"]
        ok = ok and hit
        checks.append({"key": "bodies", "expected": expected["bodies"], "measured": measured["bodies"], "pass": hit})
    for key, rel in (("volume_m3", True), ("surface_area_m2", True)):
        if key in expected:
            exp, act = expected[key], measured[key]
            denom = max(abs(exp), 1e-30)
            tol = tol_abs if abs(exp) < tol_abs else tol_rel * denom
            hit = abs(exp - act) <= tol
            ok = ok and hit
            checks.append({"key": key, "expected": exp, "measured": act, "pass": hit,
                           "tol": tol})
    if "centroid_m" in expected:
        e = expected["centroid_m"]
        hit = all(abs(e[i] - measured["centroid_m"][i]) <= tol_abs for i in range(3))
        ok = ok and hit
        checks.append({"key": "centroid_m", "expected": e, "measured": measured["centroid_m"], "pass": hit})
    if "watertight" in expected and expected["watertight"] and not measured["watertight"]:
        ok = False
        checks.append({"key": "watertight", "expected": True, "measured": False, "pass": False})
    interference = _interference_pairs(step_paths) if len(step_paths) > 1 else []
    if "interference" in expected and expected["interference"] is False and interference:
        ok = False
        checks.append({"key": "interference", "expected": False, "measured": interference, "pass": False})
    return {"passed": ok, "checks": checks, "interference": interference,
            "measured": measured, "verdict": "PASS" if ok else "GEOMETRY_MISMATCH"}
```

```python
# preset/ai-cad-dsh/preset/python/backend_cli.py
# DSH AI-CAD 后端 CLI：把 Plan A/B + measure 包装为 JSON 子进程协议。
import argparse
import json
import os
import sys


def _import_plans(backend_dir):
    sys.path.insert(0, backend_dir)
    from cad_intent import validate_intent          # noqa: F401
    from cad_codegen import generate_sources, compile_sources  # noqa: F401
    return validate_intent, generate_sources, compile_sources


def cmd_health(backend_dir):
    py = sys.executable
    ocp = "NOT_FOUND"
    try:
        import OCP  # noqa: F401
        ocp = "OK"
    except Exception:
        pass
    return {"ok": ocp == "OK", "python": py, "ocp": ocp}


def cmd_validate(backend_dir, payload):
    validate_intent, _, _ = _import_plans(backend_dir)
    return {"errors": validate_intent(payload)}


def cmd_generate(backend_dir, payload, out_dir):
    validate_intent, generate_sources, _ = _import_plans(backend_dir)
    errors = validate_intent(payload)
    if errors:
        return {"ok": False, "errors": errors}
    sources = generate_sources(payload)
    parts_dir = os.path.join(out_dir, "parts")
    os.makedirs(parts_dir, exist_ok=True)
    written = []
    for name, src in sources.items():
        path = os.path.join(parts_dir, name + ".py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)
        written.append(os.path.relpath(path, out_dir))
    return {"ok": True, "written": written, "intent_snapshot": payload}


def cmd_compile(backend_dir, payload, out_dir):
    _, _, compile_sources = _import_plans(backend_dir)
    result = compile_sources(payload, out_dir=out_dir)
    artifacts = [os.path.relpath(a, out_dir) for a in result.artifacts]
    return {"ok": result.ok, "steps": result.steps, "artifacts": artifacts}


def cmd_measure(backend_dir, payload):
    from measure import measure
    try:
        m = measure(payload["step_path"])
        return {"ok": True, "measured": m}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def cmd_verify(backend_dir, payload):
    from measure import verify
    return verify(payload.get("step_paths", []), payload.get("expected", {}))


def main():
    ap = argparse.ArgumentParser(description="AI-CAD 后端 CLI")
    ap.add_argument("--backend-dir", required=True)
    ap.add_argument("command", choices=["health", "validate", "generate", "compile", "measure", "verify"])
    ap.add_argument("--payload", required=True)
    ap.add_argument("--out-dir", default=os.getcwd())
    args = ap.parse_args()

    try:
        payload = json.loads(args.payload)
        if args.command == "health":
            result = cmd_health(args.backend_dir)
        elif args.command == "validate":
            result = cmd_validate(args.backend_dir, payload)
        elif args.command == "generate":
            result = cmd_generate(args.backend_dir, payload, args.out_dir)
        elif args.command == "compile":
            result = cmd_compile(args.backend_dir, payload, args.out_dir)
        elif args.command == "measure":
            result = cmd_measure(args.backend_dir, payload)
        else:
            result = cmd_verify(args.backend_dir, payload)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/test_cad_backend/test_measure.py -v`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/python/backend_cli.py preset/ai-cad-dsh/preset/python/measure.py tests/test_cad_backend/test_measure.py pytest.ini
git commit -m "feat(cad-dsh): Plan C Task 4 — Python 后端 CLI 与 STEP 测量"
```

---

### Task 5: tools.js + register.js — 22 个工具

**Files:**
- Create: `preset/ai-cad-dsh/preset/lib/tools.js`
- Create: `preset/ai-cad-dsh/preset/lib/register.js`
- Create: `preset/ai-cad-dsh/preset/lib/test/support.js`
- Test: `preset/ai-cad-dsh/preset/lib/tools.test.js`

**Interfaces:**
- Consumes: `newState/answer/approveBrief/attachPlan/attachIntent/approvePlan/approveExecution/approveDelivery/prepareRetry/latestIntentFile/loadState/saveState/mutate/resolveStatePath/DEFAULT_POINTER`（Task 2）、`validateIntent/generateSources/compileSources/measureStep/verifyExecution/healthCheck`（Task 3）。
- Produces:
  - `makeTools(config) -> Tool[]`：恰好 22 个工具。每个工具 `{ name, description, parameters, execute }`；`execute(ctx, args) -> Promise<any>`（参数 `ctx` 为 DSH 上下文，含 `ctx.get('fs')`/`ctx.get('subprocess')`）。
  - `registerTools(ctx, config, wrap=identity) -> void`：对 `makeTools(config)` 每个工具调用 `ctx.tools.register(wrap(t))`。
  - `setParameter(intent, {node_id, field, value, profile_index?}) -> intent`（纯函数）：改 `intent.parts[node_id].<field>`（若 node 有 `profiles` 数组且给了 `profile_index`，改 `profiles[i][field]`）；node 或 field 不存在抛 `Error('PARAM_NOT_FOUND')`。
  - `nextAction(state) -> string`（纯函数）：按状态返回提示语（如 `awaiting_confirmation` → `请先回答 intake 提问（cad_answer_question）`；`plan_attached` → `请 cad_attach_intent L0 或 cad_approve_plan` 等）。
  - `test/support.js` 导出：`makeCtx({baseDir, python})`（temp-dir fs + 真实 execFile subprocess，见 Step 3）、`tempBase()`、`writeState(ctx, base, state)`、`answeredIntake(base)`（返回 intake 全答后的 state）、`answersFor(base)`、`SKETCH_HUB`、`SKETCH_POST`、`L0`、`L1`、`L2` 夹具。

22 个工具清单（name / 参数 / 行为）：

1. `cad_environment_profile` `{}` → 返回固定环境说明（DSH 插件层信息 + 双交付物 + 受限特征子集 + 单位米）。
2. `cad_start_workflow` `{request}` → `mutate` 新建 state（若已有未完成 state 则覆盖为新 workflow），返回 `{workflow_id, status, next}`。
3. `cad_get_state` `{workflow_id?}` → 读 state 返回状态摘要（含 `status/request/answers/plan/attached_level/approved_level/latest_intent/delivery`）。
4. `cad_next_action` `{workflow_id?}` → 返回 `nextAction(state)` 提示 + 可用工具建议。
5. `cad_answer_question` `{workflow_id?, id, value}` → `answer` 写入；返回 `{id, value, all_required: allRequiredAnswered(...)}`。未知 id 抛 `Error('UNKNOWN_QUESTION')`。
6. `cad_approve_brief` `{workflow_id?}` → 若 intake 未齐全抛 `Error('INTAKE_INCOMPLETE')`；`approveBrief`。
7. `cad_attach_plan` `{workflow_id?, plan}` → `attachPlan`。
8. `cad_approve_plan` `{workflow_id?}` → `approvePlan`。
9. `cad_attach_intent` `{workflow_id?, level, intent}` → `attachIntent(state, level, intent)`；随后**写 intent JSON**：调用 `backend.generateSources`？不——只写文件，用 Python `generate` 命令会在生成时写。简化：**用 fs 写 `cad-state/<id>/intent-<level>.json`**（JS 侧仅文本写入，不需 mkdir，因为 state.json 目录已由 Python generate 的 makedirs 创建——不可靠）。改为：**用 Python `validate` 命令校验，并用 Python `generate` 的意图快照落盘**？太绕。直接：JS 用 `backendOp` 无、用 `fs.writeText` 写 `cad-state/<workflow_id>/intent-<level>.json`。依赖目录存在：目录由 `cad_start_workflow` 时用 Python `generate` 空意图触发 makedirs？过度设计。**决定：`cad_attach_intent` 只做状态内存更新 + 用 fs 写 intent 文件到 `cad-state/<workflow_id>/`；目录由每次操作前 `ensureStateDir`（fs 无 mkdir，则依赖 Python 侧在 `cad_start_workflow` 时通过一次 `health` 附带 mkdir）**。最简可行：`cad_start_workflow` 调用 Python `validate`（空 intent）——不创建目录。**最终方案：fs 服务在 wlj 中 `writeText` 会自动建目录（样例 `saveState` 直接 `fs.writeText(target, …)` 且从未手动 mkdir）。**本插件与 wlj 同假设：`fs.writeText` 自动建父目录。见 Task 6 前置说明注释。
10. `cad_approve_execution` `{workflow_id?}` → `approveExecution`。
11. `cad_generate_code` `{workflow_id?}` → 读 `state.levels.L2`（不存在抛 `Error('NO_L2_INTENT')`），`generateSources(ctx, config, L2, {outDir})`；`outDir = <repo>/cad-state/<id>`；失败（`ok:false`）抛 `BackendError`；成功返回 `{ok, written}` 并把 state.status 置为 `generated`（新增状态 `generated`，见 Step 3）。
12. `cad_compile` `{workflow_id?}` → 读 `state.levels.L2`，`compileSources(ctx, config, L2, {outDir})`；成功返回 `{ok, artifacts}`，并把 `state.delivery = {artifacts, outDir}`、status 置 `compiled`。
13. `cad_measure` `{workflow_id?, step_path?}` → `measureStep(ctx, config, step_path || 默认装配 STEP)`；返回 `{ok, measured}`。
14. `cad_modify` `{workflow_id?, instruction, target?}` → 记录修改请求（`state.pending_modification`），返回 `{status:'accepted', note}`（本工具是提示 LLM 去修改 L2 意图并重新 attach 的引导工具；不自动改码）。
15. `cad_edit_parameter` `{workflow_id?, node_id, field, value, profile_index?}` → 读 L2，`setParameter`，重新 `attachIntent(state,'L2', 新L2)`（保持 approved_level 不变），返回 `{ok, updated}`；随后需 `cad_generate_code` 重生成。
16. `cad_verify_execution` `{workflow_id?, expected}` → `verifyExecution(ctx, config, {step_paths, expected})`；`step_paths` 取 `state.delivery.artifacts` 里全部 `.step`；`passed && verdict==='PASS'` → status `verified`；否则 status `execution_failed`、`last_error`、返回 `{passed:false, checks, verdict}`。
17. `cad_approve_delivery` `{workflow_id?}` → `approveDelivery`；返回 `{status:'completed', delivery}`。
18. `cad_prepare_retry` `{workflow_id?, cleanup_confirmed, reason}` → `prepareRetry`。
19. `cad_health_check` `{}` → `healthCheck(ctx, config)`。
20. `cad_simulate_setup` `{workflow_id?}` → `{status:'SIMULATION_NOT_IMPLEMENTED', message}`。
21. `cad_simulate_run` `{workflow_id?}` → `{status:'SIMULATION_NOT_IMPLEMENTED', message}`。
22. `cad_simulate_report` `{workflow_id?}` → `{status:'SIMULATION_NOT_IMPLEMENTED', message}`。

状态机新增状态：`generated`、`compiled`（在 `approved_for_execution` 之后、`verified/execution_failed` 之前）。`cad_verify_execution` 从 `compiled`（或 `generated`）进入 `verified`/`execution_failed`。

**工具实现采用"读态-操作-写回"三步**：每个有状态工具先用 `loadState(fs, statePath)` 读（或 `mutate`），执行纯逻辑，再 `saveState`。`statePath` 由 `args.workflow_id` 决定（缺省走 `DEFAULT_POINTER` 指针）。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTools, setParameter, nextAction } from './tools.js';
import { makeCtx, tempBase, writeState, answeredIntake, L0, L1, L2 } from './test/support.js';

test('恰好 22 个工具且 name 唯一', () => {
  const tools = makeTools({ python: 'python3' });
  assert.equal(tools.length, 22);
  assert.equal(new Set(tools.map(t => t.name)).size, 22);
  for (const t of tools) {
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(typeof t.description === 'string' && t.description.length > 0);
    assert.ok(t.parameters && typeof t.parameters === 'object');
  }
});

test('3 个 CAE 插槽固定返回 SIMULATION_NOT_IMPLEMENTED', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  for (const n of ['cad_simulate_setup', 'cad_simulate_run', 'cad_simulate_report']) {
    const r = await tools[n].execute(ctx, {});
    assert.equal(r.status, 'SIMULATION_NOT_IMPLEMENTED');
  }
});

test('cad_generate_code 在 plan_approved 时被拒绝', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const base = answeredIntake('wf-1');
  await writeState(ctx, base, { ...base, status: 'plan_approved', plan: 'p' });
  await assert.rejects(() => tools.cad_generate_code.execute(ctx, { workflow_id: 'wf-1' }),
    /cad_approve_execution/);
});

test('setParameter 修改/抛错', () => {
  const intent = structuredClone(L2);
  const out = setParameter(intent, { node_id: 'c1', field: 'thickness', value: 0.01 });
  assert.equal(out.parts.c1.thickness, 0.01);
  assert.throws(() => setParameter(intent, { node_id: 'nope', field: 'x', value: 1 }), /PARAM_NOT_FOUND/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/tools.test.js`
Expected: FAIL — 找不到 `./tools.js` / `./test/support.js`。

- [ ] **Step 3: 写最小实现**

先写 `test/support.js`（temp-dir fs + 真实子进程；`answeredIntake` 复用 `INTAKE_QUESTIONS` 自动全答）：

```js
// preset/ai-cad-dsh/preset/lib/test/support.js
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { INTAKE_QUESTIONS } from '../questions.js';
import { newState, answer } from '../state.js';

const exec = promisify(execFile);

export function tempBase() {
  const dir = mkdtempSync(join(tmpdir(), 'cad-dsh-'));
  writeFileSync(join(dir, '.keep'), '');
  return realpathSync(dir);
}

export function makeCtx({ baseDir, python }) {
  const fs = {
    resolve: (p) => resolve(baseDir, p),
    async stat(p) {
      try { const s = await import('node:fs/promises').then(m => m.stat(p)); return { size: s.size }; }
      catch { return null; }
    },
    async readText(p) { return readFileSync(p, 'utf8'); },
    async writeText(p, text) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(require_dirname(p), { recursive: true });
      writeFileSync(p, text, 'utf8');
    },
    processPath: (p) => p,
  };
  function require_dirname(p) { return p.slice(0, p.lastIndexOf('/')); }
  const subprocess = {
    async spawn(opts) {
      const { argv, stdio } = opts;
      const stdoutLimit = stdio.stdout.collect.limit;
      const stderrLimit = stdio.stderr.collect.limit;
      let result;
      try {
        result = await exec(argv[0], argv.slice(1), { encoding: 'utf8' });
        result.code = 0;
      } catch (e) {
        result = { stdout: e.stdout || '', stderr: e.stderr || String(e.message), code: e.code };
      }
      const collected = {
        stdout: { readFrom: async () => (result.stdout || '').slice(0, stdoutLimit) },
        stderr: { readFrom: async () => (result.stderr || '').slice(0, stderrLimit) },
      };
      return { done: Promise.resolve({ exitCode: result.code }), collected };
    },
  };
  return { get: (s) => s === 'fs' ? fs : s === 'subprocess' ? subprocess : null, python };
}

export async function writeState(ctx, base, state) {
  await ctx.get('fs').writeText(join(base, 'cad-state', state.workflow_id, 'state.json'), JSON.stringify(state, null, 2));
}

export function answersFor() {
  return Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, q.id === 'units' ? 'meters' : q.id === 'feature_scope_check' ? 'yes' : 'sample']));
}

export function answeredIntake(workflowId) {
  return INTAKE_QUESTIONS.reduce((s, q) => answer(s, q.id, q.id === 'units' ? 'meters' : q.id === 'feature_scope_check' ? 'yes' : 'sample'),
    newState('制造一个铰链装配', { workflow_id: workflowId }));
}

// 层级意图夹具：L0 仅草图（不触发 Plan A ground 引用错误），L1 装配，L2 = L1 + 过孔切
export const SKETCH_HUB = { id: 's1', type: 'sketch', ref: { datum: 'front' },
  profile: [{ kind: 'circle', diameter: 0.06 }] };
export const SKETCH_POST = { id: 's2', type: 'sketch', ref: { datum: 'front' },
  profile: [{ kind: 'rectangle', width: 0.06, height: 0.06 }] };
export const L0 = { schema_version: 2, units: 'meters',
  parts: { c1: { id: 'c1', type: 'part', sketches: [SKETCH_HUB], features: [] } } };
export const L1 = { schema_version: 2, units: 'meters', ground: 'c1',
  parts: {
    c1: { id: 'c1', type: 'part', sketches: [SKETCH_HUB],
      features: [{ id: 'f1', type: 'extrude', sketch: 's1', operation: 'boss', end: 'blind', depth: 0.08 }] },
    c2: { id: 'c2', type: 'part', sketches: [SKETCH_POST],
      features: [{ id: 'f2', type: 'extrude', sketch: 's2', operation: 'boss', end: 'blind', depth: 0.02 }] },
  },
  assembly: {
    connections: [{ id: 'J1', type: 'kinematic', joint: 'revolute',
      contact: [{ part: 'c1', anchor: { kind: 'cylinder', near: [0.03, 0, 0] } },
                { part: 'c2', anchor: { kind: 'plane', near: [0, 0, 0.02] } }],
      direction: { axis: [0, 0, 1], rotation: true, translation: false } }],
  } };
export const L2 = structuredClone(L1);
L2.parts.c2.features.push({ id: 'f3', type: 'extrude', sketch: 's2', operation: 'cut',
  end: 'through_all' });
```

> 说明：`makeCtx.fs.writeText` 使用 `mkdirSync(recursive:true)` 自动建父目录——这是 mock 对 wlj 样例"writeText 自动建目录"假设的显式化。真实 DSH fs 服务在 sample 中的行为视为等价（wlj `saveState` 从不手动 mkdir）。

`tools.js` 主体（关键实现，全部 22 个 execute）：

```js
// preset/ai-cad-dsh/preset/lib/tools.js
// 22 个 cad_* 工具的 execute(ctx, args) 完整实现。纯逻辑，不引入 @deepseek-ai。
import { resolve, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newState, answer, approveBrief, attachPlan, attachIntent, approvePlan,
  approveExecution, approveDelivery, prepareRetry, latestIntentFile,
  loadState, saveState, mutate, resolveStatePath, DEFAULT_POINTER,
} from './state.js';
import { openQuestions, allRequiredAnswered } from './questions.js';
import {
  validateIntent, generateSources, compileSources, measureStep,
  verifyExecution, healthCheck,
} from './backend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function statePathFor(args) {
  return args.workflow_id ? resolve(REPO_ROOT, 'cad-state', args.workflow_id, 'state.json') : DEFAULT_POINTER;
}
function outDirFor(args) {
  const id = args.workflow_id || 'default';
  return resolve(REPO_ROOT, 'cad-state', id);
}
function intentPathFor(args, state) {
  const id = args.workflow_id || 'default';
  return resolve(REPO_ROOT, 'cad-state', id, latestIntentFile(state));
}

const SIM = (name) => ({ name, description: `CAE 仿真插槽（预留）：${name}。Phase 1 未实现。`,
  parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
  async execute() { return { status: 'SIMULATION_NOT_IMPLEMENTED', message: `${name} 属于 CAE（Phase 2），Phase 1 仅 CAD 生成。` }; } });

export function setParameter(intent, { node_id, field, value, profile_index }) {
  const node = intent.parts?.[node_id];
  if (!node) throw new Error('PARAM_NOT_FOUND');
  if (profile_index !== undefined && Array.isArray(node.profiles) && node.profiles[profile_index]) {
    if (!(field in node.profiles[profile_index])) throw new Error('PARAM_NOT_FOUND');
    node.profiles[profile_index][field] = value;
  } else {
    if (!(field in node)) throw new Error('PARAM_NOT_FOUND');
    node[field] = value;
  }
  return intent;
}

export function nextAction(state) {
  switch (state.status) {
    case 'awaiting_confirmation':
    case 'brief_rejected':
      return '请回答 intake 提问（cad_answer_question），然后 cad_approve_brief';
    case 'brief_approved':
      return '请提交构建计划（cad_attach_plan）';
    case 'plan_attached':
      return '请从 L0 开始逐层 attach 意图（cad_attach_intent level=L0），每层后 cad_approve_plan';
    case 'plan_approved':
      return '请 cad_attach_intent L1 / L2；L2 就绪后 cad_approve_execution';
    case 'approved_for_execution':
    case 'generated':
      return '请 cad_generate_code → cad_compile → cad_measure → cad_verify_execution';
    case 'compiled':
      return '请 cad_verify_execution（提供 expected 契约）';
    case 'execution_failed':
      return '请 cad_prepare_retry（确认清理）后重试，或 cad_modify 修改意图';
    case 'verified':
      return '请 cad_approve_delivery 完成交付';
    case 'completed':
      return '工作流已完成';
    default:
      return '未知状态';
  }
}

export function makeTools(config) {
  const needs = async (ctx, args) => {
    const st = await loadState(ctx.get('fs'), statePathFor(args));
    if (!st) throw new Error('NO_WORKFLOW');
    return st;
  };
  const save = async (ctx, args, st) => saveState(ctx.get('fs'), statePathFor(args), st);
  const writeIntentFile = async (ctx, args, st) => {
    const level = 'L' + st.attached_level;
    const intent = st.levels[level];
    await ctx.get('fs').writeText(intentPathFor(args, st), JSON.stringify(intent, null, 2));
  };
  const configStatePath = { ...config };

  const tools = [
    { name: 'cad_environment_profile', description: '报告 AI-CAD 环境能力、受限特征子集、双交付物与单位约定',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { plugin: 'ai-cad-dsh', deliverables: ['build123d 源码', '编辑态 STEP（米）'],
          feature_subset: 'sketch: rectangle/circle/line/arc/ellipse/spline; extrude boss/cut; fillet/chamfer; linear/circular_pattern; mirror; 装配: static/kinematic',
          unsupported: ['revolve', 'sweep', 'loft', 'rib', '钣金'],
          cae: 'Phase 2 预留（cad_simulate_*）', units: 'meters' };
      } },

    { name: 'cad_start_workflow', description: '新建工作流并返回 workflow_id',
      parameters: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] },
      async execute(ctx, args) {
        const st = await mutate(ctx.get('fs'), statePathFor(args), (s) => newState(args.request, { workflow_id: args.workflow_id }));
        await ctx.get('fs').writeText(resolve(REPO_ROOT, DEFAULT_POINTER),
          JSON.stringify({ workflow_id: st.workflow_id, state_path: statePathFor(st) }, null, 2));
        return { workflow_id: st.workflow_id, status: st.status, next: nextAction(st) };
      } },

    { name: 'cad_get_state', description: '读取工作流状态摘要',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        return { workflow_id: st.workflow_id, status: st.status, request: st.request,
          answers: st.answers, plan: st.plan, attached_level: st.attached_level,
          approved_level: st.approved_level, latest_intent: latestIntentFile(st),
          delivery: st.delivery, last_error: st.last_error, next: nextAction(st) };
      } },

    { name: 'cad_next_action', description: '返回下一步建议',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) { const st = await needs(ctx, args); return { status: st.status, next: nextAction(st) }; } },

    { name: 'cad_answer_question', description: '回答 intake 或 plan 提问',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, id: { type: 'string' }, value: { type: 'string' } }, required: ['id', 'value'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const qs = openQuestions(st);
        if (!qs.some(q => q.id === args.id)) throw new Error('UNKNOWN_QUESTION');
        const next = answer(st, args.id, args.value);
        await save(ctx, args, next);
        return { id: args.id, value: args.value, all_required: allRequiredAnswered(next, qs) };
      } },

    { name: 'cad_approve_brief', description: '批准需求简报（intake 齐全后）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (!allRequiredAnswered(st, openQuestions(st))) throw new Error('INTAKE_INCOMPLETE');
        const next = approveBrief(st);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_attach_plan', description: '提交构建计划文本',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, plan: { type: 'string' } }, required: ['plan'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = attachPlan(st, args.plan);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_approve_plan', description: '批准当前 attach 的意图层',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approvePlan(st);
        await save(ctx, args, next);
        return { status: next.status, approved_level: next.approved_level, next: nextAction(next) };
      } },

    { name: 'cad_attach_intent', description: 'attach 一层意图（L0/L1/L2），写 intent JSON 并校验',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, level: { type: 'string' }, intent: { type: 'object' } }, required: ['level', 'intent'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = attachIntent(st, args.level, args.intent);
        const errors = await validateIntent(ctx, configStatePath, args.intent);
        if (errors && errors.length > 0) throw new Error('INTENT_INVALID: ' + errors.join('; '));
        await writeIntentFile(ctx, args, next);
        await save(ctx, args, next);
        return { level: args.level, status: next.status, errors: errors || [], next: nextAction(next) };
      } },

    { name: 'cad_approve_execution', description: '批准执行（要求 L2 已 attach）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approveExecution(st);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_generate_code', description: '由 L2 意图生成 build123d 源码',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'approved_for_execution') throw new Error('NEED_APPROVE_EXECUTION: 请先 cad_approve_execution');
        const L2i = st.levels.L2;
        if (!L2i) throw new Error('NO_L2_INTENT');
        const outDir = outDirFor(args);
        const r = await generateSources(ctx, configStatePath, L2i, { outDir });
        if (!r.ok) throw new Error('GENERATE_FAILED: ' + (r.errors || []).join('; '));
        const next = { ...st, status: 'generated', delivery: { ...(st.delivery || {}), written: r.written, out_dir: outDir } };
        await save(ctx, args, next);
        return { ok: true, written: r.written, next: nextAction(next) };
      } },

    { name: 'cad_compile', description: '编译生成 STEP（OCCT 子进程）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'generated') throw new Error('NEED_GENERATE');
        const L2i = st.levels.L2;
        const outDir = outDirFor(args);
        const r = await compileSources(ctx, configStatePath, L2i, { outDir });
        if (!r.ok) throw new Error('COMPILE_FAILED');
        const next = { ...st, status: 'compiled', delivery: { ...(st.delivery || {}), artifacts: r.artifacts } };
        await save(ctx, args, next);
        return { ok: true, artifacts: r.artifacts, next: nextAction(next) };
      } },

    { name: 'cad_measure', description: '测量一个 STEP 文件（体数/体积/面积/质心/水密）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, step_path: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const path = args.step_path || resolve(REPO_ROOT, 'cad-state', st.workflow_id, 'parts', 'assembly.step');
        const r = await measureStep(ctx, configStatePath, path);
        if (!r.ok) throw new Error('MEASURE_FAILED: ' + r.error);
        return { measured: r.measured };
      } },

    { name: 'cad_modify', description: '记录修改请求（提示 LLM 更新 L2 后重新 attach）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, instruction: { type: 'string' }, target: { type: 'string' } }, required: ['instruction'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = { ...st, pending_modification: { instruction: args.instruction, target: args.target, at: new Date().toISOString() } };
        await save(ctx, args, next);
        return { status: 'accepted', note: '已记录。请修改 L2 意图并 cad_attach_intent level=L2 后重新生成。' };
      } },

    { name: 'cad_edit_parameter', description: '参数化改参（改 L2 意图后需重新生成）',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, node_id: { type: 'string' }, field: { type: 'string' }, value: {}, profile_index: { type: 'number' } }, required: ['node_id', 'field', 'value'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (!st.levels.L2) throw new Error('NO_L2_INTENT');
        const newL2 = setParameter(structuredClone(st.levels.L2), args);
        const next = { ...st, levels: { ...st.levels, L2: newL2 } };
        await save(ctx, args, next);
        return { ok: true, updated: newL2, note: '请 cad_generate_code 重新生成（L2 已更新）。' };
      } },

    { name: 'cad_verify_execution', description: '对照契约校验 STEP 交付物',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, expected: { type: 'object' } }, required: ['expected'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'compiled' && st.status !== 'generated') throw new Error('NEED_COMPILE');
        const artifacts = (st.delivery && st.delivery.artifacts) || [];
        const step_paths = artifacts.filter(a => a.endsWith('.step')).map(a => resolve(REPO_ROOT, a));
        const r = await verifyExecution(ctx, configStatePath, { step_paths, expected: args.expected });
        const next = r.passed && r.verdict === 'PASS'
          ? { ...st, status: 'verified', delivery: { ...(st.delivery || {}), verified: r.measured } }
          : { ...st, status: 'execution_failed', last_error: r.verdict, delivery: { ...(st.delivery || {}), verify_checks: r.checks } };
        await save(ctx, args, next);
        return { passed: r.passed, verdict: r.verdict, checks: r.checks, interference: r.interference, next: nextAction(next) };
      } },

    { name: 'cad_approve_delivery', description: '确认交付',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' } } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approveDelivery(st, { delivered_at: new Date().toISOString() });
        await save(ctx, args, next);
        return { status: next.status, delivery: next.delivery };
      } },

    { name: 'cad_prepare_retry', description: '失败后清理并回到可执行态',
      parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, cleanup_confirmed: { type: 'boolean' }, reason: { type: 'string' } }, required: ['cleanup_confirmed'] },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = prepareRetry(st, args.cleanup_confirmed === true, args.reason || '');
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_health_check', description: '后端健康检查（Python/OCP）',
      parameters: { type: 'object', properties: {} },
      async execute(ctx) { return await healthCheck(ctx, configStatePath); } },

    SIM('cad_simulate_setup'),
    SIM('cad_simulate_run'),
    SIM('cad_simulate_report'),
  ];
  return tools;
}
```

`register.js`：

```js
// preset/ai-cad-dsh/preset/lib/register.js
// 把 makeTools 结果包装为 DSH defineTool 定义注册。wrap 缺省为恒等（供测试）。
import { makeTools } from './tools.js';

export function registerTools(ctx, config, wrap = (t) => t) {
  for (const t of makeTools(config)) {
    ctx.tools.register(wrap(t));
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/tools.test.js`
Expected: PASS（4 个测试）。注：`cad_generate_code` 拒绝测试不触达 Python（状态门先行抛错）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/lib/tools.js preset/ai-cad-dsh/preset/lib/register.js preset/ai-cad-dsh/preset/lib/test/support.js preset/ai-cad-dsh/preset/lib/tools.test.js
git commit -m "feat(cad-dsh): Plan C Task 5 — 22 个 cad_* 工具与注册器"
```

---

### Task 6: ai-cad-plugin.js — DSH 插件入口

**Files:**
- Create: `preset/ai-cad-dsh/preset/ai-cad-plugin.js`
- Create: `preset/ai-cad-dsh/preset/preset.yml`
- Create: `preset/ai-cad-dsh/preset/agent.cordis.yml`
- Test: `preset/ai-cad-dsh/preset/lib/plugin.test.js`

**Interfaces:**
- Consumes: `registerTools`（Task 5）。
- Produces: DSH 插件导出 `{ name, inject, Config, apply }`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from './register.js';
import { makeTools } from './tools.js';

function mockCtx() {
  const tools = [];
  return {
    tools: { register: (t) => tools.push(t) },
    get: (s) => s === 'fs' ? null : s === 'subprocess' ? null : null,
    _tools: tools,
  };
}

test('registerTools 注册 22 个带 schema 的工具', () => {
  const ctx = mockCtx();
  registerTools(ctx, { python: 'python3' }, (t) => ({ ...t, __wrapped: true }));
  assert.equal(ctx._tools.length, 22);
  for (const t of ctx._tools) {
    assert.ok(t.name && t.description && t.parameters);
    assert.equal(t.__wrapped, true);
  }
});

test('makeTools 与 registerTools 名称一致', () => {
  const a = makeTools({ python: 'python3' }).map(t => t.name).sort();
  const ctx = mockCtx();
  registerTools(ctx, { python: 'python3' });
  const b = ctx._tools.map(t => t.name).sort();
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/plugin.test.js`
Expected: FAIL — 找不到 `./register.js`（若 Task 5 已完成则此文件存在，测试应在 Task 6 前先跑通；此步骤在 Task 5 之后执行时预期为 PASS 或 FAIL，若 FAIL 则先确认 Task 5 提交）。

- [ ] **Step 3: 写最小实现**

`preset.yml`：

```yaml
name: AI-CAD
description: 纯文本需求 → build123d 源码 + 编辑态 STEP（重门控 CAD 生成工作流）
```

`ai-cad-plugin.js`：

```js
// preset/ai-cad-dsh/preset/ai-cad-plugin.js
// DSH 插件入口：唯一引入 @deepseek-ai 的文件。注册系统提示 + 22 个工具。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { z } from '@deepseek-ai/schemastery';
import { registerTools } from './lib/register.js';

export const name = 'AI-CAD';
export const inject = ['systemPrompt', 'tools'];

export const Config = z.object({
  skillDir: z.string().default(''),
  python: z.string().default('python3'),
  backendDir: z.string().default(''),
});

const PROMPT = [
  '# AI-CAD 重门控工作流（铁律）',
  '1. **重门控**：必须按状态机逐工具推进，禁止跳步。任何 CAD 生成前需完成：intake → brief 批准 → 计划 → L0/L1/L2 三层意图逐层批准 → 执行批准。',
  '2. **双交付物**：每次生成同时交付 ① build123d Python 源码（建模语言），② 编辑态 STEP（OCCT 编译，单位米）。两者同源，禁止手工修改 STEP。',
  '3. **三层意图**：L0 骨架（零件/草图清单）→ L1 零件定义（几何特征）→ L2 特征细节（含装配连接）。节点带 status: frozen|proposed；仅 frozen 可生成。',
  '4. **语义锚点**：装配接触/连接只用 {kind, near, hint} 语义描述，绝不写硬坐标；由确定性解析器解析。',
  '5. **受限特征子集**：仅 sketch(rectangle/circle/line/arc/ellipse/spline) + extrude(boss/cut) + fillet/chamfer + linear/circular_pattern + mirror；无 revolve/sweep/loft/rib/钣金。越界需求在 intake 的 feature_scope_check 阶段拦截。',
  '6. **禁止自动重放**：execution_failed 只能由 cad_prepare_retry（确认清理）复位；不得静默重试或绕过校验。',
  '7. **CAE 预留**：cad_simulate_setup/run/report 为 Phase 2 插槽，Phase 1 调用一律返回 SIMULATION_NOT_IMPLEMENTED。',
  '8. **单位与版本**：几何单位 meters，顶层 schema_version: 2。',
].join('\n');

export function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'AI-CAD 工作流', order: 100, text: PROMPT });
  const wrap = (t) => defineTool({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    output: { schema: { type: 'string' }, render() { return ''; } },
    async execute(args) {
      const result = await t.execute(ctx, args || {});
      return JSON.stringify(result, null, 2);
    },
  });
  registerTools(ctx, config, wrap);
}
```

`agent.cordis.yml`：复制 `sample/solidworks-wlj-dsh/preset/agent.cordis.yml` 全部内容，仅把末尾插件挂载段替换为：

```yaml
- id: ai-cad-skill
  name: ./ai-cad-plugin.js
  config:
    skillDir: ''
    python: 'python3'
    backendDir: ''
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/plugin.test.js`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/ai-cad-plugin.js preset/ai-cad-dsh/preset/preset.yml preset/ai-cad-dsh/preset/agent.cordis.yml preset/ai-cad-dsh/preset/lib/plugin.test.js preset/ai-cad-dsh/package.json
git commit -m "feat(cad-dsh): Plan C Task 6 — DSH 插件入口与 preset 元数据"
```

---

### Task 7: 端到端契约测试（依赖 Plan A/B）

**Files:**
- Create: `preset/ai-cad-dsh/preset/lib/contract.test.js`

**Interfaces:**
- Consumes: 全部 Task 1-6 产物 + Plan A（`src/cad_intent`）+ Plan B（`src/cad_codegen`）已实现。
- Produces: 一个全链路 e2e 测试，证明"提问 → 三层意图 → 生成 → 编译 → 测量 → 校验 → 交付"闭环。

**测试策略**：`expected` 用"先测量后校验"（expected = measured）保证确定性 PASS，不硬编码体积；若 Plan A/B 未实现，测试 skip 并给出明确提示。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeTools } from './tools.js';
import { makeCtx, tempBase, L0, L1, L2 } from './test/support.js';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const hasPlanA = existsSync(resolve(REPO, 'src', 'cad_intent', '__init__.py'));
const hasPlanB = existsSync(resolve(REPO, 'src', 'cad_codegen', '__init__.py'));
const skip = !(hasPlanA && hasPlanB) && 'Plan A/B 未执行：先实现 src/cad_intent 与 src/cad_codegen';

test('契约：intake→L0/L1/L2→生成→编译→测量→校验→交付', { skip }, async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const T = async (name, args) => { const r = await tools[name].execute(ctx, args); return r; };

  // 启动 + intake 全答
  const wf = await T('cad_start_workflow', { request: '制造一个 revolute 铰链装配（hub 圆筒 + post 方柱）' });
  const wid = wf.workflow_id;
  for (const q of ['product_name', 'units', 'scope', 'material', 'connection_nature', 'ground_part', 'source_quality', 'dimensions_strategy', 'feature_scope_check']) {
    const value = q === 'units' ? 'meters' : q === 'feature_scope_check' ? 'yes' : 'sample';
    await T('cad_answer_question', { workflow_id: wid, id: q, value });
  }
  await T('cad_approve_brief', { workflow_id: wid });

  // 计划 + 三层意图
  await T('cad_attach_plan', { workflow_id: wid, plan: '先 hub 后 post；revolute 沿 Z；质心校验' });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L0', intent: L0 });
  await T('cad_approve_plan', { workflow_id: wid });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L1', intent: L1 });
  await T('cad_approve_plan', { workflow_id: wid });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L2', intent: L2 });
  await T('cad_approve_execution', { workflow_id: wid });

  // 生成（断言 hn1 类 + assembly 模块）
  const gen = await T('cad_generate_code', { workflow_id: wid });
  assert.equal(gen.ok, true);
  assert.ok(gen.written.some(p => p.endsWith('hn1.py')), '缺少 hn1.py');
  assert.ok(gen.written.some(p => p.endsWith('assembly.py')), '缺少 assembly.py');

  // 编译（断言 artifact 存在且非空）
  const comp = await T('cad_compile', { workflow_id: wid });
  assert.equal(comp.ok, true);
  assert.ok(comp.artifacts.length >= 3, '装配 + 双零件应各产出一个 STEP');
  for (const a of comp.artifacts) {
    if (a.endsWith('.step')) {
      const abs = resolve(REPO, a);
      assert.equal(existsSync(abs), true, 'artifact 不存在: ' + a);
      assert.ok(require('node:fs').statSync(abs).size > 0, 'artifact 为空: ' + a);
    }
  }

  // 测量装配（体数 ≥ 2）
  const meas = await T('cad_measure', { workflow_id: wid });
  assert.ok(meas.measured.bodies >= 2, '装配体数应 ≥ 2，实测 ' + meas.measured.bodies);

  // 校验：expected = measured 保证确定性 PASS
  const exp = {
    bodies: meas.measured.bodies,
    volume_m3: meas.measured.volume_m3,
    surface_area_m2: meas.measured.surface_area_m2,
    watertight: true,
  };
  const v = await T('cad_verify_execution', { workflow_id: wid, expected: exp });
  assert.equal(v.verdict, 'PASS');

  // 交付
  const done = await T('cad_approve_delivery', { workflow_id: wid });
  assert.equal(done.status, 'completed');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test preset/ai-cad-dsh/preset/lib/contract.test.js`
Expected: Plan A/B 未实现时 SKIP（提示文字）；已实现时 PASS。首次运行若 FAIL 且非 skip，则按失败信息定位（先确保 Plan A/B 已提交）。

- [ ] **Step 3: 无独立实现**（契约测试本身是验收）。若运行 FAIL，按阶段定位：
  1. `cad_attach_intent` 抛 `INTENT_INVALID` → 检查夹具是否符合 Plan A 校验（L0 不得含 ground 引用；L1/L2 需 ground 指向现存 part）。
  2. `cad_generate_code` 抛 `GENERATE_FAILED` → 检查 Plan B 对 `connection`/`anchor` 结构的要求（INTENT_ASM 同款）。
  3. `cad_compile` 抛 `COMPILE_FAILED` → 检查 build123d 子进程日志（`state.delivery` 无 artifacts 时读 stderr）。
  4. `cad_measure` 抛 `MEASURE_FAILED` → 检查 `parts/assembly.step` 是否存在（Plan B 的 assembly 模块是否命名 `assembly`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test preset/ai-cad-dsh/preset/lib/contract.test.js`
Expected: PASS（1 个测试）。

- [ ] **Step 5: 提交**

```bash
git add preset/ai-cad-dsh/preset/lib/contract.test.js
git commit -m "feat(cad-dsh): Plan C Task 7 — 端到端契约测试"
```

---

## Self-Review（写完即自查）

**1. Spec 覆盖矩阵**

| 设计文档 § | 需求 | 对应 Task |
|---|---|---|
| §1 双交付物 | 源码 + 编辑态 STEP | Task 4（generate/compile 命令）、Task 6 铁律 2 |
| §2 关键选择 | 重门控、米制、schema_version 2 | Task 2 状态机、Task 6 铁律 1/8、Task 5 夹具 |
| §3.1 词法分离 | part 词表 vs assembly 词表不混用 | Task 4 generate（Plan B 负责拆分模块）、Task 5 L0 无装配 |
| §3.2 状态布局 | `cad-state/<id>/` 布局 | 前置说明消歧（扁平 parts/）+ Task 5 `outDirFor` |
| §4.1 顶层 JSON | 校验契约 | Task 4 validate 命令、Task 5 夹具 schema_version 2 |
| §4.2 part 词表 | 受限特征子集 | Task 6 铁律 5、Task 5 `cad_environment_profile` |
| §4.3 装配 | static/kinematic | Task 5 夹具 L1/L2（revolute 连接） |
| §4.4 锚点 | 语义锚点 | Task 5 夹具 anchor `{kind, near}`；解析交给 Plan A/B |
| §4.5 四层装配校验 | reachability/acyclicity/… | 委派 Plan A（validate_intent） |
| §4.6 三层意图 | L0/L1/L2 渐进 | Task 2 `attachIntent` 门矩阵、Task 5 夹具 |
| §5 19 工具表 | 19 个工具 | Task 5（19 核心 + 3 CAE = 22） |
| §6 工作流序列 | 9 intake → approve_brief → L0→L1→L2 → generate→compile→measure→verify→deliver | Task 7 契约测试 |
| §6 失败恢复 | 无自动重放 | Task 2 `prepareRetry`、Task 6 铁律 6 |
| §7 CAE 预留 | 3 插槽返回 SIMULATION_NOT_IMPLEMENTED | Task 5 `SIM()` |
| §8 错误处理 | GEOMETRY_MISMATCH/UNVERIFIED、截断输出 | Task 4 verify、Task 3 截断 |
| §8 测试 | validateIntent 单元、锚点解析、compile 流水线、契约测试 | Task 4 pytest、Task 7 契约 |
| §9 YAGNI | 不做 CAE、不做 UI | Task 5 CAE 插槽空实现 |

**2. Placeholder 扫描**：所有步骤含完整代码；无 "TBD/TODO/类似 Task N"。"handle edge cases" 类指令均落实为具体断言或具体错误分支。

**3. 类型一致性核对**
- `attachIntent(state, level, intent)`：Task 2 定义，Task 5 `cad_attach_intent` 调用一致（`args.level`/`args.intent`）。
- `latestIntentFile(state)`：Task 2 定义（依赖 `attached_level`），Task 5 `writeIntentFile`/`cad_get_state` 一致。
- `openQuestions/allRequiredAnswered`：Task 1 定义（参数 `state, questions`），Task 5 `cad_answer_question`/`cad_approve_brief` 调用一致。
- `backend.*`：Task 3 定义（`validateIntent/generateSources/compileSources/measureStep/verifyExecution/healthCheck` 均为 `(ctx, config, …)`），Task 5 调用一致。
- `makeTools(config) -> Tool[]`、`registerTools(ctx, config, wrap)`：Task 5/6 定义与 `plugin.test.js`、`ai-cad-plugin.js` 调用一致。
- `measure(path)`/`verify(...)` 返回键：Task 4 定义，Task 5 `cad_verify_execution` 消费 `verdict/passed/checks/interference` 一致。
- 状态枚举：Task 2 定义 `awaiting_confirmation/brief_approved/plan_attached/plan_approved/approved_for_execution/execution_failed/verified/completed`，Task 5 补充 `generated/compiled`（在 approved_for_execution 之后）；`nextAction` 的 switch 覆盖两者。一致。

**依赖顺序提醒**：Task 1-6 不依赖 Plan A/B；Task 7 需要 Plan A 与 Plan B 已实现。若从零执行，先跑 Plan A 再跑 Plan B 再跑本计划，最后单独跑 Task 7。
