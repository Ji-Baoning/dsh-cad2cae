# dsh-cad2cae

运行于 DeepSeek Harness (DSH) 的 AI CAD 生成插件：把自然语言需求经「意图层校验 → build123d 源码生成 → OCCT 编译」的门禁化流水线，产出可编辑、可验证的 STEP 模型。

**阶段**：MVP（功能完整、两套测试全绿；个人规模，暂无 CI、无版本发布） · **运行时**：Python ≥ 3.10 · Node ≥ 18 · build123d 0.11.1 · OCCT

## 项目简介

CAD 工程师和设计团队希望直接从自然语言需求得到可编辑的 CAD 模型，而不必手写几何脚本，同时保证设计意图、可追溯性与门禁化验证。dsh-cad2cae 正是为此构建的 DSH 插件：先对意图层做严格校验（图可达性 / 无环性 / 静态完备 / 运动学一致性、强制米制、标识符白名单），再确定性生成可编辑的 build123d 源码，并通过 OCCT 子进程编译为可编辑 STEP（零件 + 装配）。生成结果在交付前按契约实测闭环（测量 / 验证），任一环节失败都响亮报错而不静默降级。系统分三层实现：Plan A 纯标准库意图校验器、Plan B 代码生成与编译流水线、Plan C DSH 插件层（22 工具 + 纯函数状态机 + JSON 子进程后端），当前功能完整且两套测试全绿。

## 安装

**环境依赖**：Python ≥ 3.10（build123d 0.11.1、cadquery-ocp-novtk 7.9.3.1.1、OCCT）；Node ≥ 18（ESM）。

**安装与测试**：

```bash
python -m pytest -q                    # Python 套件：109 passed
cd preset/ai-cad-dsh
npm install                            # 测试依赖（lib/*.js 本身零依赖）
npm test                               # Node 套件：25 passed
```

**作为 DSH preset 使用**：将 `preset/ai-cad-dsh/preset/` 下的 `preset.yml`、`agent.cordis.yml`、`ai-cad-plugin.js` 装入 DeepSeek Harness，会话选择 **AI-CAD**。插件默认按仓库内布局定位 `src/`；装入外部目录时需在 Config 显式指定 `backendDir`。

**后端 CLI 直调**：

```bash
python preset/ai-cad-dsh/preset/python/backend_cli.py --backend-dir src <health|validate|generate|compile|measure|verify> --payload '<json>' [--out-dir <dir>]
```

## 文档

- 设计规格：[2026-08-17-ai-cad-dsh-plugin-design.md](docs/superpowers/specs/2026-08-17-ai-cad-dsh-plugin-design.md)
- 实现计划：
  - [Plan A · 意图校验器](docs/superpowers/plans/2026-08-17-plan-a-intent-validator.md)
  - [Plan B · 代码生成 / 编译](docs/superpowers/plans/2026-08-17-plan-b-codegen-compile.md)
  - [Plan C · DSH 插件层](docs/superpowers/plans/2026-08-17-plan-c-dsh-plugin.md)

目前尚无独立的架构文档 / 快速上手手册 / CONTRIBUTING.md —— 架构与开发约定请以上述设计规格与三份实现计划为准。

## 贡献

仓库使用 **Conventional Commits**（`feat|fix|test|chore|docs(scope): …`），scope 取 `cad-intent` / `cad-codegen` / `cad-dsh` / `ai-cad`。改动后两套测试必须保持全绿：根目录 `python -m pytest` 与 `preset/ai-cad-dsh` 下的 `npm test`。

核心约定（详见设计规格）：

- 错误必须响亮报错（codegen 一律 `CodegenError`），禁止静默降级 / 静默丢几何；工作流禁止自动重放。
- 常量集中在 `schema.py` / `profile.py` 单一来源，严禁两处硬编码；单位强制米制；id 须匹配 `[A-Za-z_][A-Za-z0-9_]*`。
- `lib/*.js` 不引入 `@deepseek-ai/*`（保持零依赖、可独立测试）。
- 中文注释；`cad-state/` 为 gitignore 的运行时产物，勿提交。

## Bug 与改进

已知问题（均为 Minor，M1–M7）：

- 无环性按连接数而非接触对数计数，多接触连接可能漏判环；
- ground 缺 component 时静默兜底 `comps[0]`；装配场景下干扰检测实际未生效；
- `state.js` 死导出 `mutate`；`intentPathFor` 默认 workflow_id 不一致；
- 交付物布局（`parts/` 与根目录平铺）与 Plan 文档不一致；`through_all` 切深只沿 +法向。

**当前无 Issue 追踪系统**：请以 `fix(cad-*):` / `feat(cad-*):` 前缀提交改动并在 PR 中说明，改动需确保两套测试全绿。路线图：CAE Phase 2 实装 `cad_simulate_*`；二期支持 2D 图纸 / 手绘 / 逆向输入。
