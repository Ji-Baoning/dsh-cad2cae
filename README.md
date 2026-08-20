# dsh-cad2cae

运行于 DeepSeek Harness (DSH) 的 AI CAD 生成插件：把自然语言需求经「意图层校验 → build123d 源码生成 → OCCT 编译」的门禁化流水线，产出可编辑、可验证的 STEP 模型。

**阶段**：MVP（功能完整、两套测试全绿；个人规模，暂无 CI、无版本发布） · **运行时**：Python ≥ 3.10 · Node ≥ 18 · build123d 0.11.1 · OCCT

## 项目简介

CAD 工程师和设计团队希望直接从自然语言需求得到可编辑的 CAD 模型，而不必手写几何脚本，同时保证设计意图、可追溯性与门禁化验证。dsh-cad2cae 正是为此构建的 DSH 插件：先对意图层做严格校验（图可达性 / 无环性 / 静态完备 / 运动学一致性、强制米制、标识符白名单），再确定性生成可编辑的 build123d 源码，并通过 OCCT 子进程编译为可编辑 STEP（零件 + 装配）。生成结果在交付前按契约实测闭环（测量 / 验证），任一环节失败都响亮报错而不静默降级。系统分三层实现：Plan A 纯标准库意图校验器、Plan B 代码生成与编译流水线、Plan C DSH 插件层（24 工具 + 纯函数状态机 + JSON 子进程后端），当前功能完整且两套测试全绿。

## 安装

**环境依赖**：Python ≥ 3.10（build123d 0.11.1、cadquery-ocp-novtk 7.9.3.1.1、OCCT）；Node ≥ 18（ESM）。

**安装与测试**：

```bash
python -m pytest -q                    # Python 套件：137 passed（含 tests/test_cad_backend + tests/test_dsh_preset）
node --test patch-harness.test.mjs     # harness 补丁 fixture 测试（仓库根）
cd preset/ai-cad-dsh
npm install                            # 测试依赖（lib/*.js 本身零依赖）
npm test                               # Node 套件：54 passed
```

**作为 DSH preset 使用**：运行安装脚本，把预设装入 DSH 本地预设根，并自动改写副本的 `backendDir` 指向本仓库 `src/`、在副本内建立 `node_modules/@deepseek-ai/{dsh-tools,schemastery}` 符号链接（指向 harness 安装内的同名包——插件入口的 `import '@deepseek-ai/dsh-tools'` 依赖它解析）：

```bash
node install-dsh-preset.mjs            # 幂等安装到 ~/.dsh/.agent-presets/ai-cad/（已就绪则直接提示）
node install-dsh-preset.mjs --force    # 覆盖重装
node install-dsh-preset.mjs --dry-run  # 预检（只打印将做什么，不写盘）
```

脚本遵守 DSH 的 home 解析（`$DSH_HOME` 优先，默认 `~/.dsh`），支持 `--id <id>` 自定义预设 id；仓库源文件保持原样，复制时排除测试与缓存文件。找不到 dsh harness 时会警告并给出手动建链接的命令。安装后 DSH 会话选择 **AI-CAD** 即可（24 个工具：23 个 `cad_*` + `show_image`）；**若 dsh web 进程曾加载过失败版本的预设，需重启 dsh web 后再选择**（Node 的 ESM 失败导入会按路径缓存，改名入口也只能绕开一次）。

**harness text-only 补丁**：安装脚本会自动把 text-only 序列化补丁（`patch-harness.mjs`）应用到 harness 的 DeepSeek 适配器（`dsh-llm-deepseek/lib/index.js`）——这是 `show_image` 在纯文本模型会话可用的前置条件。补丁幂等：已打则跳过；harness 升级导致源串不匹配时**警告并跳过，绝不写坏文件**；升级 DSH 后重跑本脚本即自愈。`--no-patch` 可跳过补丁（例如你自行管理适配器时）。

### 3D 预览（cad_show_step）

- 安装脚本会**构建并注册 3D 预览客户端插件**（`preset/ai-cad-dsh/web` → DSH web profile）：浏览器端 occt-import-js（WASM）直接解析 STEP 字节，渲染可交互 3D 视口 + 零件树（显隐/高亮）+ 测量面板。
- `--no-web` 可跳过客户端插件安装；`node install-web-plugin.mjs --force` 单独重装。
- 使用：compile 成功后 agent 调用 `cad_show_step`，对话中同一张 3D 卡片原地更新，旧调用收敛为细条。
- `cad_show_step` 返回的 `preview` 字段还带**静态预览 PNG**（`cad-state/<id>/preview.png`，numpy 软件光栅化，不依赖 GL/X）：agent 紧随其调用 `show_image`（见下）把预览图放进消息流。预览渲染失败不影响 3D 卡片本身（单件失败仅跳过并记录）。
- 工具数 23 → 24（`show_image` 为本计划新增；`cad_show_step` 独立计）。

### 静态预览图（show_image）

- `show_image(path, [alt])` 把一张图片（PNG/JPEG/WebP/GIF）显示到 DSH web 对话中：图片显示在消息流里（UI 渲染原图），模型只收到文本摘要信封（路径 + 尺寸/字节元数据）。
- 与内置 `read_image` 的区别：`read_image` 要求当前模型接受图像输入（视觉模型）；`show_image` **不需要**——图片是给用户看的，纯文本模型（如 deepseek-v4-flash）经适配器 text-only 补丁把 image 块折成 `[图片: …]` 占位喂给模型，会话不崩。
- 错误路径响亮报错（`PATH_REQUIRED` / `UNSUPPORTED_IMAGE_FORMAT` / `NO_ATTACHMENT_SERVICE` / `FILE_NOT_FOUND` / 图片格式错配透传），agent 不得静默跳过。

**后端 CLI 直调**：

```bash
python preset/ai-cad-dsh/preset/python/backend_cli.py --backend-dir src <health|validate|generate|compile|measure|verify|manifest> --payload '<json>' [--out-dir <dir>]
```

## 文档

- 设计规格：[2026-08-17-ai-cad-dsh-plugin-design.md](docs/superpowers/specs/2026-08-17-ai-cad-dsh-plugin-design.md)
- 实现计划：
  - [Plan A · 意图校验器](docs/superpowers/plans/2026-08-17-plan-a-intent-validator.md)
  - [Plan B · 代码生成 / 编译](docs/superpowers/plans/2026-08-17-plan-b-codegen-compile.md)
  - [Plan C · DSH 插件层](docs/superpowers/plans/2026-08-17-plan-c-dsh-plugin.md)

目前尚无独立的架构文档 / 快速上手手册 / CONTRIBUTING.md —— 架构与开发约定请以上述设计规格与三份实现计划为准。

## 贡献

仓库使用 **Conventional Commits**（`feat|fix|test|chore|docs(scope): …`），scope 取 `cad-intent` / `cad-codegen` / `cad-dsh` / `ai-cad`。改动后两套测试必须保持全绿：根目录 `python -m pytest`、仓库根 `node --test patch-harness.test.mjs`，与 `preset/ai-cad-dsh` 下的 `npm test`。

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
