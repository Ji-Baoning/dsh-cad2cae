# AI 自动生成机械 CAD + 自动仿真 —— 技术进展调研与实现路径报告

> 调研日期：2026-08-15
> 调研方式：5 个并行研究方向 × 多关键词 WebSearch + 关键来源深度阅读，60+ 独立来源交叉核实
> 项目定位（据需求）：机械工程 **3D 参数化 CAD（含 2D 草图）** 自动生成 + 生成后**自动仿真（力学 FEA 为主，兼顾多物理场）**
> 置信度：中–高。多数结论多来源一致；单来源或厂商口径已在文中明确标注

---

## 目录

- [0. 执行摘要](#0-执行摘要)
- [1. 领域总览：两条技术路线与四个行业共识](#1-领域总览两条技术路线与四个行业共识)
- [2. 学术研究进展：生成式 CAD](#2-学术研究进展生成式-cad)
- [3. 传统 CAD/PLM/CAE 厂商的 AI 布局](#3-传统-cadplmcae-厂商的-ai-布局)
- [4. AI 原生初创与 Text-to-CAD 产品](#4-ai-原生初创与-text-to-cad-产品)
- [5. AI 驱动自动仿真与 CAE 自动化](#5-ai-驱动自动仿真与-cae-自动化)
- [6. 开源生态与技术栈（可直接落地）](#6-开源生态与技术栈可直接落地)
- [7. 关键空白与差异化机会](#7-关键空白与差异化机会)
- [8. 实现路径建议](#8-实现路径建议)
- [9. 风险与注意事项](#9-风险与注意事项)
- [10. 方法论、局限与待核实项](#10-方法论局限与待核实项)
- [11. 关键来源索引](#11-关键来源索引)

---

## 0. 执行摘要

1. **生成式 CAD 已成热点但远未成熟**。学术界从 DeepCAD（2021）开创"把 CAD 建模当作可学习的命令序列"后，2024–2026 进入**大语言模型/多模态大模型 + 代码生成**与**扩散模型**双主导时期。**所有玩家（学术、大厂、初创）都能生成"看起来像零件"的东西，但没有任何一家稳定地满足可制造性**（圆角/倒角相切丢失、薄壁小特征失败、装配级不可用）——这是全行业公认的瓶颈。

2. **输出格式是分水岭**。业界共识：**"STEP 才是专业格式，STL/mesh 是 JPEG"**。可编辑的参数化 B-Rep（特征树）/CAD 程序是工业可用底线；纯 mesh/隐式场输出不能用于机加工。这决定了技术路线的根本分歧（见 §1）。

3. **传统大厂没有可复制的端到端产品**。Autodesk 的 Neural CAD（AU 2025 发布）到 2026 年中仍未上线，被媒体直接评价为"AI washing"；西门子"60 秒 text→FEA"是 2026-06 原型；达索 LEO 2026 年中才计划上线。已落地能力都是**单点**：草图自动约束（AutoConstrain）、2D 智能图块、AI 加工建议、**仿真代理模型**（SimAI / PhysicsAI / COMSOL DNN / SIMULIA 虚拟孪生物理行为）。

4. **AI 驱动自动仿真已走通三大路线**：① LLM 编排仿真工作流（ChatCFD / Foam-Agent 在 OpenFOAM 上"一次跑通成功率"82–88%；结构 FEA 方向的 agent 化研究明显更少，是空窗）；② 基于历史仿真数据的**代理模型**（Ansys SimAI / Altair PhysicsAI，分布内精度几个百分点、秒级预测）；③ 几何前处理/自动网格的 AI 化（"meshing tax" 是仿真最大时间黑洞）。**关键纪律：AI 代理模型输出不能直接交付，最优解必须回真实求解器复算**；ASME V&V 20/40 正被扩展为 ML 代理模型可信度标准。

5. **最关键的发现：市面上没有一家打通「Text-to-CAD → 自动仿真 → 自动迭代」的完整闭环**。但学术界已验证这条路径可行——2026 年首尔大学 *Self-Improving CAD Agents with FEA as Feedback*（用 CalculiX FEA 作为反馈闭环修复 CAD 程序）是最直接的先行证据。**这正是本项目的差异化空间**。

6. **开源技术栈已基本齐备**：OpenCASCADE（唯一开源 B-Rep 内核）+ CadQuery/build123d（Python 层）+ FreeCAD（草图约束求解器 PlanGCS + FEM/CalculiX）+ 一批 MCP server + 若干端到端开源 pipeline。可以低成本搭建垂直闭环 MVP（见 §8 路径 A）。

---

## 1. 领域总览：两条技术路线与四个行业共识

### 1.1 两条技术路线

| | 路线 A：LLM/代码智能体 → 传统几何内核 | 路线 B：专门训练的生成式模型 → 直接输出 B-Rep |
|---|---|---|
| 原理 | "text → code → CAD"。LLM 生成 OpenSCAD / CadQuery / build123d / FreeCAD 脚本，或封装 B-Rep 引擎 API（KCL、FeatureScript） | 训练序列 Transformer 或扩散模型直接生成 CAD 命令序列 / B-Rep 结构 |
| 代表 | CAD-Coder、CAD-GPT、CADSmith、Zoo（ML-ephant）、Adam Copilot、Onshape FeatureScript MCP、CadQuery-LLM | DeepCAD、SkexGen、Text2CAD、CAD-MLLM、CADCrafter、BrepGen、SGS-1 |
| 输出 | 可编辑脚本/特征树 → STEP | STEP（命令序列经内核编译）或直接 B-Rep |
| 优点 | 可读可编辑、带设计意图、贴近工程师、无需训练数据、落地快 | 生成质量上限高、支持多模态输入（文本/图像/点云/草图） |
| 缺点 | 尺寸/几何漂移、复杂曲面弱、LLM 写代码有错误率 | 参数化约束弱、可编译率低、需大量数据+算力、多数数据集非商用 |

Zoo 官方明确反对 mesh-first/diffusion 路线，称其产出"编译后的输出而非源代码"，不可编辑、不流形、无制造意图（[Why AI Must Generate Parametric CAD](https://docs.zoo.dev/blog/why-ai-must-generate-parametric-cad)）。2025 年多项基准证实：**直接生成 mesh/隐式场已不被看作"CAD"**。

### 1.2 四个行业共识

1. **可制造性是最大瓶颈**（多来源共识）：圆角/倒角相切、薄壁小特征、装配一致性，几乎所有 text-to-CAD 工具都不稳定。
2. **可编译/有效性是第二瓶颈**：即便最强模型，在"可执行代码 → 有效几何 → 工程可用"三级瀑布中前两级就大量失败（[MUSE](https://huggingface.co/papers/2605.28579)、[Hephaestus-CCX](https://arxiv.org/abs/2605.17448)）。
3. **几何前处理是仿真的最大时间黑洞**：CAE 前处理中几何清理/中面抽取可占前处理约 70%，团队普遍花 30–50% 总仿真时间，业界称"meshing tax"（[AI 几何准备与网格综述](https://scite.ai/reports/a-survey-of-ai-methods-8GkDaPYm)）。
4. **AI 代理模型的信任问题**：分布内精度可到几个百分点并给置信度分数，但分布外失效；行业纪律是"最优解必须回真实求解器复算"，验证/认证框架（ASME V&V 40）正在成形但标准化方法尚未出台。

---

## 2. 学术研究进展：生成式 CAD

### 2.1 数据集（研究/评测的基础）

| 数据集 | 规模 | 内容 | 许可 | 链接 |
|---|---|---|---|---|
| **DeepCAD** | 178,238 模型 | 草图-拉伸构造序列（Onshape 公共文档） | 代码 MIT，数据按研究用途 | [GitHub](https://github.com/rundiwu/DeepCAD) |
| **Fusion 360 Gallery** | ~20,000 设计 / 重建子集 8,625 序列 / 装配 8,251 | 人类 CAD 设计序列 + Fusion 360 Gym MDP 环境 | **仅非商用研究** | [GitHub](https://github.com/AutodeskAILab/Fusion360GalleryDataset) |
| **ABC** | 100 万+ B-Rep 模型（STEP） | 平均 ~236 曲面 patch，基本无标签 | **谨慎**：NYU 标 MIT，但官网称模型版权归原作者（Onshape ToU） | [官网](https://deep-geometry.github.io/abc-dataset/) |
| **SketchGraphs** | 1,500 万 CAD 草图 + 约束图 | 图 G=(V,E)，节点几何图元、边约束 | 研究用途 | [GitHub](https://github.com/PrincetonLIPS/SketchGraphs) |
| **Text2CAD** | ~170K 模型 + ~660K 分级文本标注 | Mistral + LLaVA-NeXT 自动标注 DeepCAD | **CC BY-NC-SA（非商用）** | [GitHub](https://github.com/SadilKhan/Text2CAD) |
| **Omni-CAD** | 453,220 实例 | 命令序列+文本+8 视点图像+点云（多模态） | 随 CAD-MLLM 发布 | [项目页](https://cad-mllm.github.io/) |
| **AutoMate** | 451,967 零件 / 255,211 装配 / 1.29M mates | Onshape 爬取，装配 mate 预测基准 | 开放 | [Zenodo](https://zenodo.org/records/7750955) |

> 重要澄清：**Text2CAD 不是 Autodesk Research 的产品**，作者来自 DFKI、RPTU Kaiserslautern-Landau、MindGarage、BITS Pilani（[Text2CAD 论文](https://huggingface.co/papers/2409.17106)）。Autodesk 相关数据集是 Fusion 360 Gallery。
> "**CAD-ASTRA**"：多轮中英文检索均无法证实存在，疑似名称有误或为内部项目，未采纳。

### 2.2 3D 参数化 CAD 生成——方法家族对照

| 家族 | 代表作 | 优点 | 局限 |
|---|---|---|---|
| Transformer 自回归序列 | DeepCAD、SkexGen、Text2CAD、CAD-MLLM、CAD-Llama | 结构简单、可控、与 LLM 兼容 | 词表受限、长序列误差累积、编译失败率高 |
| B-Rep 直接生成/扩散 | SolidGen、BrepGen、DTGBrepGen | 直接出可编辑 B-Rep、支持自由曲面 | 算力高、约束与可制造性弱 |
| 序列扩散 | CADCrafter、GenCAD-3D | 质量与可编译性优于自回归 | 依赖 VAE 码本、控制精细度有限 |
| LLM/代码生成 | LLM4CAD、CAD-GPT、CAD-Coder、CADSmith | 可读可编辑、贴近工程师 | 尺寸/几何漂移、需内核+视觉校验循环 |
| LLM Agent + FEA 反馈 | Self-Improving FEA agents、ToolCAD、MDO Agent | 面向真实工程指标闭环 | 首轮通过率极低、依赖仿真器成本 |
| GAN / VAE / RL | DeepCAD-latent-GAN、Fusion 360 Gym | 采样快 / 可证明可执行 | 参数化 CAD 中 GAN 已边缘化 |

**代表性成果与量化指标**：
- **DeepCAD**（[ICCV 2021](https://github.com/rundiwu/DeepCAD)）：领域开创者，首个 CAD 构造序列生成，Transformer 自动编码器 + WGAN 潜在空间。
- **Text2CAD**（[NeurIPS 2024 Spotlight](https://github.com/SadilKhan/Text2CAD)）：首个端到端文本→参数化 CAD，BERT + 自回归 Transformer，F1/Chamfer/invalid-ratio 评估。
- **CAD-MLLM**（[2024](https://github.com/CAD-MLLM/CAD-MLLM)）：Vicuna-7B+LoRA，统一文本/图像/点云多模态输入；在 95% 点云被删的极端情况下鲁棒性显著优于 DeepCAD。
- **CAD-Coder**（[NeurIPS 2025](https://huggingface.co/models/gudo7208/CAD-Coder)）：Qwen2.5-7B 两阶段训练（SFT 110K + GRPO 几何奖励），平均 Chamfer 6.54 vs Text2CAD 的 29.29——**代码生成路线在几何精度上反超序列生成路线**。
- **CADCrafter**（[CVPR 2025](https://mlanthology.org/cvpr/2025/chen2025cvpr-cadcrafter/)）：图像→可编辑 CAD，VAE+Latent DiT 扩散 + DPO，命令准确率 84.62%、无效率压到 3.6%（已是优秀水平）。团队含魔芯科技（KOKONI）、NTU、西湖大学、浙大等。
- **BrepGen**（[SIGGRAPH 2024](https://github.com/JackZhouSz/BrepGen)）：首个支持自由曲面/双曲率曲面的 B-Rep 扩散生成。
- **OpenECAD**（[2024](https://arxiv.org/abs/2406.09913)）：轻量 VLM（0.55B–3.1B）图像→依赖式 CAD，可执行率 >93%，远超 GPT-4o-mini（32–46%）——**轻量模型+结构化表示可大幅提升可编译性**。
- **CADSmith**（[GitHub](https://github.com/jabarkle/CADSmith)）：5 智能体（Planner/Coder/Executor/VLM Validator/Refiner）协作，全流程 100% 可执行、中位 Chamfer 0.48，相对零样本均值降 38 倍——**多智能体 + 内核验证 + 视觉审查是当前最稳的代码生成架构**。
- **Fusion 360 Gym**（[SIGGRAPH 2021](https://arxiv.org/abs/2010.02392)）：把"重建 CAD 程序"建模为 MDP，神经引导搜索在 100 次交互内恢复 67.5% 测试设计——**强化学习可作为可执行性保证的手段**。

### 2.3 2D 草图 / 草绘生成（本项目定位的关键模块）

- **数据集**：**SketchGraphs**（Princeton，1,500 万工程草图 + 约束图）是 2D 草图生成与自动约束的事实基准（[GitHub](https://github.com/PrincetonLIPS/SketchGraphs)）。
- **通用矢量草图**：SketchRNN（2017）、Sketchformer / Sketchformer++（[CVPR 2020](https://github.com/leosampaio/sketchformer)，Transformer 矢量草图 SOTA）。
- **工程草图（带约束）生成**：
  - **CurveGen / TurtleGen**（[CVPR 2021 WS](https://ar5iv.labs.arxiv.org/html/2104.09621)）：无需约束求解器即可生成有效草图；CurveGen Unique 99.9% / Valid 81.5%。
  - **SketchGen**（[NeurIPS 2021](https://mlanthology.org/neurips/2021/para2021neurips-sketchgen/)）：Transformer 生成带约束的 CAD 草图，输出经约束求解器正则化。
  - **SketchDNN**（[ICML 2025](https://icml.cc/virtual/2025/poster/46031)）：连续-离散联合扩散，SketchGraphs 上 FID 16.04→7.80，**当前 CAD 草图生成 SOTA**。
- **手绘草图→CAD**：**Sketch2CAD**（[SIGGRAPH 2020](https://github.com/Enigma-li/Sketch2CAD)）、**Free2CAD**（[TOG 2022](https://github.com/Enigma-li/Free2CAD)）：平板手绘笔划→CAD 建模命令（拉伸/圆/约束），可导入 FreeCAD/SolveSpace；仍需人工标定尺寸。
- **矢量工程图→参数化 CAD**：**Drawing2CAD**（[2025](https://ar5iv.labs.arxiv.org/html/2508.18733)）：seq2seq 双解码器解耦命令类型与参数。

**关键工程认知（重要）**：DeepCAD/Text2CAD 的"CAD 构造序列"是**符号化的特征树 token，不是约束图**。代码式内核（CadQuery/build123d/OpenSCAD）的 sketch 是**程序化几何**，"参数化"由 Python 变量表达。**真正的"约束 + 尺寸驱动"草图只存在于 FreeCAD Sketcher（PlanGCS 求解器）和 Onshape（FeatureScript）等商用草绘器里**。如果你的"2D 草图"指的是带尺寸约束的工程草图，执行后端应选 FreeCAD（或 Onshape REST API），而不是纯代码式内核。（[约束求解器调研](https://quaoar.su/blog/category/geometric-constraint-solver)）

### 2.4 2025–2026 最新趋势：LLM Agent + 可制造性基准

- **CADBench**（MIT DeCoDE Lab，2026）：18,000 样本、6 来源族、5 模态、6 指标。核心发现：**专用 mesh-to-CAD 模型在理想输入下显著优于代码生成 VLM，但都远未可靠**，复杂度越高退化越明显（[HF](https://huggingface.co/datasets/DeCoDELab/CADBench)）。
- **MUSE**（2026）：面向**可制造/功能/可装配**的文本→CAD 装配生成基准，106 例，三级评审（代码→几何→设计意图）；最强模型在工程级准则上成功率有限（[项目页](https://dong7313.github.io/muse-benchmark/)）。
- **Self-Improving CAD Generation Agents with FEA as Feedback**（[arXiv 2026](https://arxiv.org/abs/2605.17448)，首尔大学）：**用有限元仿真（CalculiX）作为反馈闭环修复 CadQuery 程序**——首个 Attempt 中 GPT-5.5/Claude Code 严格通过率为**零**；加入蓝图 schema + 21 视图渲染 + FEA 反馈后，Box-IoU 从 0.444 提升到 0.592。配套新基准 Hephaestus-CCX（50 例）。→ **这是"生成→仿真→迭代"路径最直接的学术证据，与你项目同题。**
- **CADGenBench**（2026）：validity-gated CAD 得分，2026-08 榜单头部仅 ~60%（build123d-mcp + Claude Opus 5），通用模型（Claude Fable 5 37.3%）远低于专用 agent（[BenchmarkList](https://benchmarklist.com/benchmarks/cadgenbench/)）。
- **Parametric CAD Bench**（2026）：评估"agent 能否产出工程师可编辑的 FreeCAD 文档"，暴露典型失败模式 "pocket didn't cut"（参数树正确、几何错）；简易 verify-loop 比专用 CLI 综合分高 0.06–0.09（[HF](https://huggingface.co/datasets/gnucleus-ai/cad-gen-freecad-bench)）。
- **LLM4CAD-Editor / LLM4CAD-DSL**（2026）：用特征名（而非坐标）引用几何的 DSL，参数级编辑解析准确率 96.3%（[arXiv:2606.20607](https://arxiv.org/abs/2606.20607)）。

### 2.5 评估方式（生成质量如何度量）

- **几何误差**：Chamfer 距离、IoU/SIoU、F1（按线/弧/圆/拉伸分类）、点云 MMD/JSD/Coverage。
- **拓扑有效性 / 可编译性**：invalid rate（程序能否被 CAD 内核编译）、SegE/DangEL/SIR/FluxEE（CAD-MLLM 提出）、validity-gated score（CADGenBench）。
- **约束/特征可编辑性**：spec_score（参数树）+ geom_score（几何）拆分的做法（Parametric CAD Bench）；"pocket didn't cut" 即"树对几何错"的度量漏洞。
- **可制造性/工程有效性**：MUSE 三级协议、Hephaestus-CCX 的 FEA 严格通过率（应力/位移/屈曲/振动/热）、CADCLAW（"CAD 的 pytest"，装配自动验证门，见 §6.6）。
- **注意**：2026 年多个基准强调**单纯几何相似度不足以度量 CAD 质量**，需"可执行 → 有效几何 → 工程可用"分级。

---

## 3. 传统 CAD/PLM/CAE 厂商的 AI 布局

> 图例：🟢 已发布可用 | 🟡 演示/预告/内测 | ⚪ 论文/研究原型

### 3.1 Autodesk
- 🟢 **Fusion AutoConstrain**：ML 自动为草图加约束/自动标注，2025 年初上线；配套论文用 RLHF 式"design alignment"后训练，把草图全约束率从基线 9% 提到 93%（[研究博客](https://www.research.autodesk.com/blog/ai-alignment-in-cad-design-teaching-machines-to-understand-design-intent-in-autoconstrain/)）。→ **对"2D 草图"模块最有借鉴意义。**
- 🟢 **AutoCAD Smart Blocks**（BDETECT/BSEARCH，2025–2026）：ML 自动识别同类对象转图块（[官方博客](https://www.autodesk.com/blogs/autocad/autocad-2026/)）。
- 🟡 **Autodesk Assistant in Fusion**（技术预览，2026-06）：自然语言→约 1 分钟出**可编辑原生参数化模型**（非网格）；独立测试"500mL 塑料瓶"实测体积 480–520mL 需手动缩放——本质是"高级宏生成器/意图翻译器"，非自主工程师（[第三方实测](https://nanjixiong.com/forum.php?mod=viewthread&tid=180781)）。
- ⚪ **Project Bernini**（2024 研究）：生成式几何概念验证，多模态输入→1 分钟出多个可用 3D 形状；大神经网络直接操作几何，不走 CAD 内核；从未商用。
- ⚪ **Neural CAD**（[AU 2025](https://www.engineering.com/autodesk-introduces-neural-cad-at-au-2025/) 发布）：在专业 CAD 几何（B-Rep）上直接推理的生成式基础模型，宣称可生成**可编辑的 2D/3D 几何**；但截至 2026-08 **未上线**，2026-06 论文仍称"technology is still evolving"，媒体评价 **"AI washing"**（[批判性核查](https://www.engineering.com/autodesks-neural-cad-looks-good-on-paper/)）。

### 3.2 Dassault Systèmes
- 战略上明确 **"我不是大语言模型的信徒"**，主张"工业语言模型"（垂直行业、基于工程内容训练，必要时才调大模型控成本）；与 NVIDIA 合作"工业世界模型"（[官方博客](https://blog.3ds.com/topics/company-news/how-dassault-systemes-is-building-tomorrows-business-with-ai-in-2025/)）。
- 🟡 **Virtual Companions**（2026-02）：AURA（"MBA 协调器"，已可用）/ **LEO**（"工程师"，机械结构+运动仿真+制造，**计划 2026 年中上线**）/ MARIE（"科学家"，2026 下半年）。LEO 演示了"初稿→草图→3D 参数化→代理模型做 FEA"（[engineering.com](https://www.engineering.com/dassault-unveils-ai-powered-virtual-companions/)）。
- 🟡 **SOLIDWORKS AURA**：预测意图、自动从 3D 模型生成 2D 草图/图纸（实体与约束检测）；2025 年在 SOLIDWORKS Labs 内测，GA 随 2026 版。
- 🟢 **SIMULIA Virtual Twin Physics Behavior**：用 SIMULIA 求解器数据训练 ML 替代模型，近实时预测；"40 小时流程→MODSIM 4 小时→加 AI 后 4 分钟甚至秒级"；集成 NVIDIA PhysicsNeMo（[SIMULIA 官方博客](https://blog.3ds.com/brands/simulia/what-makes-simulia-approach-ai-unique/)）。

### 3.3 Siemens
- 🟢 **NX 已上线 AI 模块**：Command Prediction（ML 推荐命令）、Voice Command Assistant、Select Similar Faces（按 Value Based Licensing 加购）。
- 🟡 **Design Copilot NX**：自然语言→设计选项；独立评测将"文本生成几何"列为**最不生产可用**的一类——"还不能为必须保公差的零件生成可靠几何"（[Leo AI NX 指南](https://www.getleo.ai/blog/best-ai-tools-nx-2026)）。
- 🟢 **NX X Manufacturing MMS / NX 2606**：AI 加工建议（逐面生成刀路建议、可学习个性化）；NX 2606 新增**无历史数据依赖的生成式 AI 工艺推荐**（仅给几何即可出完整可行工艺）、AI 自动参数化刀具创建；宣称新编程员上手时间降 60%（[NX 2606 中文](https://www.gdcad.com/newsinfo/11236611.html)）。
- 🟡 **自主仿真（Autonomous Simulation）原型**（[官方博客](https://blogs.sw.siemens.com/art-of-the-possible/autonomous-simulation/)，2026-06-16）：设计师自然语言提需求（"这个铝制把手上模拟 200 磅 Y 方向、2mm 分辨率"），agent 通过几何推理（识别安装面/承载面/对称面）→ 无头求解器 → agentic 编排（选材料/指认面/赋 BC/离散化/求解/报告），**60 秒内输出验证报告**。明确是 prototype，非在售产品。→ **这是"自动仿真"路径的厂商级参照。**
- 2025 年完成对 **Altair** 的收购，产品并入 Simcenter 品牌。

### 3.4 PTC
- 🟢 **Creo 13 / Creo+ AI Assistant**（2026-06-10）：设计环境内聊天式工程指导，分层 Advise（可用）/Assist（Beta）/Automate（Alpha）；Beta 版可 AI 直接读 3D 模型提取洞察（[PTC 新闻稿](https://investor.ptc.com/resources/news/news-details/2026/PTC-Brings-AI-Powered-Guidance-to-the-Design-Environment-with-Creo-13/)）。
- 🟢 **Onshape AI Advisor**（2025-04）：嵌在设计环境的实时步骤式指导，基于 Amazon Bedrock；路线图含 agent 工作流、自动几何创建、**FeatureScript 生成**。
- 🟢 **FeatureScript MCP Server**（[Onshape Labs，2026-08-14](https://www.engineering.com/ptc-adds-natural-language-tools-for-onshape-cad-automation/)）：基于 Model Context Protocol，让 Claude/ChatGPT/Gemini 用自然语言构建/测试/调试 Onshape FeatureScript 自定义特征。→ **少数"已上线、可复用的 AI 写 CAD 代码"产品，是路线 A 的厂商背书。**

### 3.5 CAE 厂商（仿真代理模型是主流落地形态）
- 🟢 **Ansys SimAI**：云原生 AI 仿真平台，单算法覆盖全物理、非参数化、网格无关；用既往仿真数据训练（通常 30–100 算例、默认约 2 天），几分钟预测新设计；附置信度分数；PyAnsys SDK（[官方](https://www.ansys.com/products/ai)）。
- 🟢 **Ansys 2026 R1**（Synopsys 整合后首个版本，首次引入 agentic AI）：**Mechanical Mesh Agent**（AI 智能网格，支持自然语言网格请求"给这个几何按这些约束生成网格"）、**GeomAI**（从参考几何学出"设计语言"生成拓扑变体）、**Discovery Validation Agent**、**TwinAI**（Temporal Fusion Transformer 混合建模）、SimAI Pro（桌面）/Premium（云）分级、Engineering Copilot 升级到 GPT-4 级（[中文解析](https://www.softxiaoer.com/articles/ansys-2026-r1ai/)）。
- 🟢 **Altair PhysicsAI**：直接在 3D 网格上学习的几何深度学习引擎，**宣称仅需 7–10 个仿真案例即可训练预测模型**（GCNS/TNS/SER 三种架构，2025.1）；轨道车辆案例"效率提升 1000x、预测精度 99.7%"、转向架方案评估从 3 周→1 小时（[Release Notes](https://2025.help.altair.com/2025.1/hwsolvers/altair_help/topics/release_notes/rn_2025_physicsai_r.htm)）。
- 🟢 **COMSOL 6.2–6.4 内置 DNN 代理模型**：Surrogate Model Training 研究节点、GPU 训练、**ONNX 导出**；官方无 LLM 助手（"COMSOL AI 副驾驶"是第三方 CompLabs 产品，[论文](https://www.comsol.com/paper/ai-copilot-for-automating-simulation-setup-in-comsol-multiphysics-145242)，视觉语言模型解析 STEP 几何自动赋 BC/网格）。
- ⚪ **Hexagon/MSC、ESI（Keysight）**：无已发布的生成式 AI 产品，仅营销口径。

### 3.6 国产厂商
- 🟢 **中望软件**：AI-structure Copilot（2025-12，与清华陆新征团队合作）——国产 CAD 平台首款生成式结构设计 AI 助手，墙梁布置从约 2 小时缩至 3–10 分钟（[官网](https://www.zwsoft.cn/news/294-15512.html)）。**但官方明言"尚未自行开发 CAx 大模型，与 DeepSeek 无实际业务合作""尚无应用落地的 CAx 垂类大模型产品，也未有收入"**（[格隆汇](https://dxpress.gelonghui.com/live/2331624)）。
- 🟡 **华天软件 CrownCAD**：云架构三维 CAD；宣称自然语言描述即可初步生成三维模型、AI 自动网格划分/施加载荷边界条件、仿真后给结构优化建议，形成"设计-仿真-反馈-优化"闭环——**均为厂商/媒体口径，缺独立验证**。
- 🟢 **设序科技（DesignOrder）**：**与你项目形态最接近的国产玩家**。产品"闪设"（闪设 3D 智能设计 + 闪设 2D 自动出图）→ 2026 升级为"则形 AI"平台；三大 AI 引擎战略：**几何 AI（3D Agent）→ 物理 AI（求解强度/刚度/流场，研发与 POC 阶段）→ 制造 AI（2D Agent，可制造性判断）**；商业模式转向 RaaS（结果即服务，约 1/3 营收）；客户比亚迪、本田、中国商飞、宇通、中车等；累计融资超 3 亿人民币（[36氪](https://m.36kr.com/p/3506932610587778)、[投资界](https://m.pedaily.cn/news/566752)）。
- 🟢 **适创科技**：铸造 CAE 云平台"智铸超云"+ 铸造工艺设计智能体 SupreXI + 工艺控制智能体 SupreHub（智能模温控制废品率降至 5% 以内）——**验证了"垂直域 CAE 智能体化"可商用**，但聚焦铸造单工艺域。
- **华为云**：做算力+平台+行业大模型（盘古 5.5、工业数据转换引擎 iDEE、MBMCenter），不直接做"生成 CAD 几何"的产品。

**小结**：大厂没有可复制的端到端产品；已落地的都是单点能力（AutoConstrain、Smart Blocks、MMS、SimAI/PhysicsAI、Mesh Agent）。**最近似的端到端参照是独立玩家**：Zoo（Text-to-CAD + Design Studio）、设序科技（几何→物理→制造三引擎）。

---

## 4. AI 原生初创与 Text-to-CAD 产品

> 状态快照：已收购/转型 = ParaMatters（2022 被 Carbon）、Monolith AI（2025 被 CoreWeave）、Physna/Thangs（消费线 2024-12 卖 Shapeways，转国防）。活着且活跃 = Zoo、Karman+、Backflip、Neural Concept、Kyrall、Leo AI、Adam/CADAM、Spectral、ToffeeX、nTop、Hyperganic。

### 4.1 Zoo（原 KittyCAD）—— AI 原生 CAD 头号玩家
- 定位：AI-native CAD 平台，产品 **Zoo Design Studio**（2025-05 发布，浏览器内 CAD，集成点选建模 + KCL 代码编辑 + 生成式 AI）+ 核心 **Text-to-CAD**（prompt 生成可编辑 B-Rep）。2021 年成立于洛杉矶，创始人为 **Jessie Frazelle（CEO）、Jordan Noone（Relativity Space 前 CTO）、Jenna Bryant**；前 Autodesk CEO **Carl Bass 仅为天使投资人，与 Autodesk 无公司关联**（[Digital Engineering 档案](https://www.digitalengineering247.com/company/zoo/)）。
- 输入→输出：文本 prompt → **STEP + glTF**（B-Rep 实体，非 mesh）；另支持 STL/Parasolid/OBJ/PLY。
- 底层技术：**CAD-first，非 diffusion**。ML 平台叫 **ML-ephant**（文本→结构化几何操作序列，如"extrude sketch by 50mm"），几何执行靠自研 GPU-native **KittyCAD Geometry Engine**（B-Rep 内核）+ Design API（[技术博客](https://docs.zoo.dev/blog/why-ai-must-generate-parametric-cad)）。
- 公开量化：300,000 早期用户、超 100 万 Text-to-CAD 设计（[TMCnet](https://www.tmcnet.com/usubmit/2025/05/28/10201155.htm)）。融资口径冲突：约 $10M（2023-10 seed $5M）vs PitchBook 的 $35.5M（2025-02 $30M 轮）（多来源不一致，待核实）。定价 API 按秒计费（约 $0.0083/s）。
- **已核实局限**（多来源共识）：复杂多特征件失败（壁面异常角度相交、卡扣不可用）；圆角相切丢失、曲面扭曲；60° 燕尾槽这类角度驱动几何失效；小尺寸/浮点精度极限下"内核无法算出有效形状"；**不支持大型装配；无 FEA/仿真、无 CAM、无 PLM 集成**（[Wevolver 实测](https://www.wevolver.com/article/we-tested-7-text-to-cad-tools-are-they-actually-useful-for-engineers)）。

### 4.2 其他关键玩家
- **Karman+**：融资已核实（CB Insights 共 $45M，2025-02 $20M seed），但产品技术细节**无法从公开渠道独立证实**（单来源，待核实）。
- **Backflip AI**（$30M Series A，a16z 领投）：scan/STL/mesh → **可编辑参数化 CAD**（含特征树），宣称把逆向一个零件从 $1,500 降到 $10。
- **Neural Concept**（$100M C 轮，2025-12）：物理感知、CAD-native 企业 AI，客户 GM/GE Vernova/Safran/雷诺/多个 F1 车队；宣布 2026 初发布"突破性生成式 CAD 能力"——**仿真正向生成**路线的巨头级玩家。
- **Kyrall**：文本/草图/图片/规格文档 → 可编辑参数化 CAD，导出 STEP，支持装配，集成 Onshape；**局限**：DFM 仅覆盖三轴铣 + FDM/SLA/SLS，无仿真/CAM。
- **Leo AI**："大型机械模型"，自称用超 10 亿 CAD 装配体 + 超 100 万页工程标准训练；流程刻意非"直接出形状"——先问澄清问题→搜 PDM/PLM 找复用件→跑工程计算→生成可编辑参数化装配→合规检查；客户 HP/NVIDIA/Intel/Scania。
- **Adam / CADAM**（YC W25，开源）：双 agent（OpenSCAD 参数化 + mesh 生成），浏览器端，GPL-3.0 ~4.5k star；商业版 Adam Copilot 用 OpenCascade/build123d 生成 **.STEP**，$40–$1000/月；HN 争议：支持者认为标准件可用，反对者称输出缺紧固/装配可行性与公差分析（[Launch HN](https://app.hncompanion.com/item?id=48572553)）。
- **Spectral Labs SGS-1**（2025-09）：B-Rep 生成式模型，输入图片/3D mesh → 输出 STEP 格式 B-Rep 零件；**公开实测局限**：中高复杂度件几何质量骤降、几乎所有尺寸不准、孔不完整、圆角不相切——**不可制造**（[Leo 对比评测](https://www.getleo.ai/blog/text-to-cad-tools-comparison-guide)）。
- **ToffeeX**：热流体组件的物理驱动生成式设计（拓扑优化+多物理仿真+制造约束），客户 Airbus/Rolls-Royce/Toyota。
- **MecAgent**（$3M seed，2025）：自然语言→在 SOLIDWORKS/Inventor 内运行的宏；复杂曲面是显著短板。

### 4.3 3D 资产生成工具（不涉足机械 CAD）
Meshy/Tripo/Luma Genie 等文本→3D 工具**均输出 mesh、无 STEP/DXF、无参数、尺寸不可控**，不可用于机加工。"精度是视觉的，不是尺寸的"（[Tripo 评测](https://www.tripo3d.ai/blog/10-best-ai-3d-printing-model-generators-for-2026)）。

### 4.4 大厂/开源 text-to-CAD 工程尝试
- **OpenSCAD + LLM**：主流"text→code→CAD"范式；CSG 限制（无圆角/样条/有机面）。
- **FreeCAD + MCP**：`freecad-mcp` workbench 可被 ChatGPT 驱动（create_object、execute_code、**run_fem_analysis** 等），实测做出书架、螺旋桨（[Fabbaloo](https://www.fabbaloo.com/news/freecad-mcp-integration-lets-chatgpt-create-and-edit-3d-cad-models)）。
- **Onshape FeatureScript MCP Server**（官方）+ 社区 `onshape-mcp`。
- **BlenderLLM**（开源）：Qwen2.5-Coder-7B 微调，指令→Blender Python 脚本；配套 BlendNet 数据集 + CADBench 基准（[GitHub](https://github.com/FreedomIntelligence/BlenderLLM)）。
- **AgentSCAD**：自然语言→**已验证**的 OpenSCAD 工件（几何修复+制造校验，artifact-first）（[GitHub](https://github.com/Kevoyuan/AgentSCAD)）。
- **CAD-Coder**（ASME 2025）：视觉-语言模型直接输出 CadQuery 代码。

---

## 5. AI 驱动自动仿真与 CAE 自动化

### 5.1 AI 求解器 / 代理模型（PINN / 神经算子 / PhysicsNeMo）
- **PINN（Raissi 2019）与神经算子（FNO/DeepONet）**是两条主线。2025 综述给出选型经验法则：**>1000 样本用数据驱动神经算子；100–1000 用混合（PINO）；<100 用 PINN；单次查询直接用经典求解器，>10 次多查询才值得用神经算子**；推理加速 10³–10⁵×，盈亏平衡点 10–50 次查询之后（[综述](https://www.emergentmind.com/papers/2511.04576)）。
- **NVIDIA PhysicsNeMo**（前 Modulus）：开源物理 AI 框架，内置 DoMINO（CFD 代理）与 Transolver；支撑"Real Time Wind Tunnel" blueprint（宣称相对传统流程最高 1200×，Ansys Fluent 在 320×GH200 上 25 亿网格整车仿真约 6 小时）。
- **结构力学新架构**：Point-DeepONet（SDF 点云输入，预测 3D 位移/应力，在 20 万节点网格上用 5% 节点训练，R² 位移 0.987/应力 0.923，比非线性有限元快约 400×）。
- **对 PINN 的严厉批评**：2025 年论文指出 PINN/XAI 在经典力学精确解案例上仍失败，解释不稳定、假精度误导工程决策（[论文](https://www.sciencedirect.com/science/article/pii/S0360835225008502)）——**这是工业怀疑论的核心证据，代理模型不可直接替代求解器**。

### 5.2 LLM 编排仿真工作流（学术，2025–2026）
- **CFD 方向已成熟**：
  - **ChatCFD**（[arXiv:2506.02019](https://arxiv.org/abs/2506.02019)）：多模态 + RAG 多 agent 端到端 OpenFOAM；**315 案例执行成功率 82.1%**，单案例约 $0.208；错误定位器是最关键组件。
  - **Foam-Agent 2.0**（[NeurIPS 2025](https://neurips.cc/virtual/2025/loc/san-diego/122973)）：基于 **MCP** 的可组合服务；**CFDLLMBench 110 例 88.2% 成功率**。
  - **MetaOpenFOAM 2.0**：13 任务 Pass@1 86.9%，单案例约 $0.15。
  - **AutoCFD**：LoRA 微调 Qwen2.5-7B，88.7% 求解精度；**结论：领域微调优于纯 RAG**（[论文](https://www.sciencedirect.com/science/article/pii/S2095034925000261)）。
- **结构 FEA 方向是空窗**（对你的项目是机会）：
  - **FeaGPT**（[arXiv:2510.21993](https://arxiv.org/abs/2510.21993)）：首个"对话式完整 几何-网格-仿真-分析"框架。关键机制：**语义拓扑映射**——BC/载荷用语义位置描述符（"左边缘""孔边界"）由几何分析器映射到实际表面；FreeCAD（参数化 CAD）+ Gmsh（物理感知网格）+ CalculiX（求解器，JSON 自动配置）；验证 7 叶压气机/12 叶涡轮（110,000 rpm）。
  - **九个 LLM 自动化 FEA 的系统评测**（*Applied Sciences* 2025）：求解器输入生成强（78–88% 成功率、位移误差 <1%）；**几何/网格生成较弱（简单形状 70%、装配 56%）；布尔运算 0% 成功率——装配体几何是当前 LLM-FEA 最大瓶颈**（单来源摘要，待核实）。
  - **PAMF**（2026）：两个微调 LLM agent 自动网格生成，成功率 88.4%、66.8% 的网格误差 <10%，较传统快 3.69×。
  - **AutoSiMP**：自然语言→拓扑优化全自动，含专用**边界条件生成器**、8 项质量检查、失败闭路重试。
  - **美国 SBIR 资助的 APERI 项目**：用 Claude 3.7 Sonnet + OpenAI o4-mini 在 Sandia 求解器上自动化固体力学仿真——**美国国家实验室正以政府资金推动该方向**（[SBIR](https://www.sbir.gov/awards/217820)）。
- **边界条件/载荷自动生成**是最成熟的 LLM-CAE 切入点：FeaGPT（语义拓扑映射）、COMSOL Copilot（视觉语言模型解析几何）、AutoSiMP（BC 生成器）等多团队独立验证可行。

### 5.3 几何前处理与 AI 网格（最大时间黑洞）
- 业界口径：几何清理与中面抽取可占前处理约 70%；团队花 30–50% 总仿真时间在几何清理（"meshing tax"）。
- 厂商级 AI 清理已商用：**Flexcompute GeometryAI**（AI agent 读"脏 CAD"自动修隙/修交叠，水密模型+几何感知表面网格）、**Xitadel XIPA**（CNN 特征识别+特征族分类）、**Neural4D Direct3D-S2**（神经 SDF 重建整个体）；Altair/HyperMesh/SpaceClaim/Simcenter 的自动化清理与中面抽取已成熟。
- AI 网格研究：**AMBER**（NeurIPS 2025，分层 GNN 预测尺寸场做自适应 FEM 网格，泛化到未见几何）、DRL 网格、DL-Polycube/NeuralPoly（六面体/quad）。**结论：自适应网格 AI 已接近可工程化；全自动六面体/复杂装配网格仍是研究级。**
- 关键共识：**LLM 还不能可靠直接生成网格**，需外部网格（Gmsh）+ 确定性几何内核兜底。

### 5.4 生成式设计 + 仿真闭环（正在出现的形态）
- **Luminary Cloud + nTop + NVIDIA PhysicsNeMo**（2025-03）：nTop 参数化几何引擎（秒级生成变体）+ Luminary GPU 原生平台（并行数百高保真仿真）+ PhysicsNeMo（代理预测），物理驱动设计优化从"周/月"缩到"小时"（[官网](https://luminary.ai/resources/luminary-cloud-and-ntop-streamline-ai-physics-and-cut-engineering-design-time-from-months-to-hours-with-nvidia-technology/)）。
- **Ansys GeomAI + SimAI 闭环**：GeomAI 生成设计变体，SimAI 秒级评估，optiSLang 驱动优化——官方定位即"生成式设计 + 仿真驱动优化"统一工作流。
- **Hyperganic**：算法生成式工程（晶格/TPMS/火箭发动机），收购 DirectFEM 引入有限胞元法做"设计内即时仿真"（宣称较常规仿真快最多 80%）。
- **SimScale Engineering AI**（2026-05 开放）：agentic AI 从工程规格文档提取意图，自动编排 CAD 准备/网格/求解器配置/云端执行/验证报告全流程（[Businesswire](https://www.businesswire.com/news/home/20260507641171/en/)）——**目前最接近"意图→已验证设计"的产品化尝试**。

### 5.5 可信度 / 验证 / 认证
- **分布内可信、分布外失效**是全行业共识；最佳实践"最优解回真实求解器复算"（Ansys/Altair/SimScale 均明示）。
- **ASME V&V 20 + V&V 40** 正被扩展为"ML 代理模型可信度评估"，核心是**基于使用情境（COU）的风险分级可信度评估**；已出现对 NACA 0012 RANS 代理预测可信度评估的工作（[OSTI](https://www.osti.gov/biblio/3028632)）。**但标准化方法仍未出台——这是开放性缺口，也是你的项目可以建立的差异化壁垒。**
- 适航/认证语境：代理模型"前景光明但认证门槛未破"。

### 5.6 厂商 AI 仿真产品速查
| 产品 | 能力 | 状态 |
|---|---|---|
| Ansys SimAI | 全物理代理模型，30–100 算例训练 | 🟢 |
| Ansys 2026 R1 Mesh Agent / GeomAI / TwinAI | AI 网格 / 生成式几何 / 数字孪生 | 🟢 |
| Altair PhysicsAI | 7–10 算例训练，GCNS/TNS/SER | 🟢 |
| COMSOL 6.2–6.4 DNN 代理 | 内置代理模型训练 + ONNX 导出 | 🟢 |
| SIMULIA Virtual Twin Physics Behavior | 求解器数据训练的替代模型 | 🟢 |
| SimScale Physics AI + Engineering AI | 代理模型（宣称最高 2700×）+ agentic 编排 | 🟢 |
| Rescale Data Intelligence + MCP Server | 仿真数据底座 + agent 驱动仿真设置 | 🟢 |
| 华为盘古（气象/科学计算） | 不做结构 FEA 替代 | 🟢 平台 |

---

## 6. 开源生态与技术栈（可直接落地）

### 6.1 CAD 内核与 Python 层
- **OpenCASCADE (OCCT)**：**唯一可用的开源 B-Rep 内核**，LGPL-2.1+特殊例外（商用友好），原生读写 STEP/IGES/glTF/OBJ/STL。局限：布尔/圆角在真实几何（相切、薄片）上会失败；约 10 万面效率可达，商用内核百万级；**圆角（倒角）对生产几何显著更弱**（[对比](https://www.hendoi.in/blog/parasolid-vs-acis-vs-open-cascade)）。
- **Python 层**（按生态成熟度）：
  - **CadQuery**（Apache-2.0，5.6k star）：生态最成熟，STEP/IGES/STL 导出。
  - **build123d**（Apache-2.0，2.9k star）：CadQuery 的 Pythonic 重构，Builder + Algebra 双 API，更适合"大型可维护模型"。
  - **pythonocc-core**（LGPL-3.0）：OCCT 全量 SWIG 绑定。
  - **FreeCAD**（LGPL-2.1，32.9k star）：完整 Python API + **Sketcher + FEM 工作台**，最大生态。
  - **Replicad**：OpenCASCADE-WASM 的 JS 库，浏览器端内核。
- **商用内核**：Parasolid（Siemens）是鲁棒性标杆，ACIS（Dassault）为 AutoCAD 所用——均**闭源、按 royalty**。选型主要被 licensing 而非技术决定。

### 6.2 2D 草图与约束求解器
| 求解器 | 许可 | 说明 |
|---|---|---|
| **PlanGCS** | LGPL | **FreeCAD Sketcher 与 SALOME 的求解器**，约 12 类约束（距离/水平/垂直/角度/半径/相切/相等/共线） |
| **SolveSpaceLib** | GPL | 嵌入式约束求解器成熟可靠，但 GPL 是闭源集成障碍 |
| CadQuery SketchConstraintSolver | Apache-2.0 | nlopt 优化式求解 |
| build123d 约束 | Apache-2.0 | 构造器式相切/终止约束，非通用求解器 |

### 6.3 LLM + CAD 集成（MCP 生态，star 为 2026-08 实测）
- **freecad-mcp**（neka-nat，1.8k star，MIT）：最流行的 FreeCAD MCP server；示例含 **cantilever_fem.py**（生成几何→FreeCAD FEM→CalculiX 的无界面流程）。
- **freecad-ai**（ghbalf，426 star）：AI 工作台，支持 20+ LLM 提供商，LLM 生成 Python 后沙箱校验执行。
- **build123d-mcp**（pzfreo，46 star）：同一模型的 CADGenBench 得分 0.360→0.457、有效性 88%→100%。
- **onshape-mcp**（hedless，126 star）：草图/特征/装配/FeatureScript，导出 STEP/Parasolid。
- **cad-cae-copilot**（armpro24-blip，47 star）：**"text-to-CAD + text-to-CAE"，真实 build123d/OCCT 几何、可编辑参数、稳定拓扑指针、确定性批评**——与你项目形态直接对应。
- **OpenSCAD MCP 系**：多个，用于渲染/校验/参数扫描。
- **商业 API**：Autodesk Platform Services（APS，前 Forge：Model Derivative / Design Automation）、Onshape REST API v6、SolidWorks COM API、NX Open（需许可）。
- **text-to-STEP 直接生成**（实验性）：**STEP-LLM**（[GitHub](https://github.com/JasonShiii/STEP-LLM)，Llama-3.2-3B 直接输出 ISO 10303-21 STEP 文本）、**StepForge**（SFT+GRPO 几何奖励）。

### 6.4 数据集与基准——许可红黄灯（务必注意）
| | 商用安全性 | 说明 |
|---|---|---|
| 🟢 **可商用** | CadQuery/build123d（Apache）、OCCT（LGPL+例外）、pythonocc（LGPL-3）、FreeCAD（LGPL-2.1）、Gmsh、meshio（MIT）、PyVista（MIT）、dolfinx（LGPL-3） | 代码/库层 |
| 🟡 **需尽调** | **ABC**（NYU 标 MIT，但官方指向 Onshape ToU，模型版权归原作者）、DeepCAD 数据集（代码 MIT，数据按研究用途） | 训练语料需逐模型尽调 |
| 🔴 **禁止商用** | **Fusion 360 Gallery**（仅非商用研究）、**Text2CAD**（CC BY-NC-SA）、**BrepGen**（代码/数据/权重禁止商用，仅研究 GPL v3）、SolveSpace（GPL） | 只能用于评测/原型 |
| **评测基准（开放）** | CADBench（DeCoDELab，18k 样本）、CAD-Judge（编译器式形态学判分）、CAD-Eval（STL 水密/单构件检查）、P3D-Bench | 用于自动评估生成质量 |

**实务建议**：商用训练语料优先自建 + ABC（逐模型尽调）+ 自己渲染的 STEP/网格；把 Fusion360/Text2CAD 仅用于**评测**。

### 6.5 自动仿真开源栈（headless 可脚本化）
- **FreeCAD FEM（CalculiX）+ Gmsh + meshio + PyVista** 一条链完全可脚本化：`ObjectsFem.makeAnalysis / makeSolverCalculixCcxTools / makeMaterialSolid / makeConstraintFixed / makeConstraintForce`，Gmsh 网格，读 `.frd` 提取应力/位移；支持 static/frequency/thermomech/check/buckling（[FreeCAD FEM Python 教程](https://wiki.freecad.org/FEM_Tutorial_Python)）。
- **CalculiX**（ccx）：Abaqus-like 输入，隐/显式；Python 驱动可用 **pyccx**（GMSH-SDK 直接网格，结果转 VTK）、pygccx、beso（拓扑优化）。
- **FEniCSx**（dolfinx）、**Elmer FEM**：开源多物理求解框架。
- **OpenFOAM**：CFD 标准，经 PyFoam/FOAM 命令驱动。
- **PyAnsys / PyMAPDL / PyFluent**：需要 Ansys 许可，不适合零成本流水线。

### 6.6 端到端开源 pipeline（生成 CAD → 仿真/验证）
- **FeaGPT**（[arXiv:2510.21993](https://arxiv.org/abs/2510.21993)）：Geometry-Mesh-Simulation-Analysis（GMSA）agentic 管线，FreeCAD + Gmsh + CalculiX。
- **MDO Agent**（[arXiv:2511.17511](https://arxiv.org/abs/2511.17511)）：Designer / Modeler（CadQuery）/ Verifier（FEA）/ Optimizer 四代理 ReAct 闭环。
- **Self-Improving CAD Generation Agents with FEA as Feedback**（[Semantic Scholar](https://www.semanticscholar.org/paper/Self-Improving-CAD-Generation-Agents-with-Finite-as-Son-Park/d0a730b52a9e03563a1bb1143fc7d50bdf7f256e)）：要求生成**多部件 STEP**，用 FEA 作为反馈信号。
- **CADCLAW**（[GitHub](https://github.com/sunnyday-technologies/CADCLAW)，16 star）："**CAD 的 pytest**"——STEP 装配的自动验证门（干涉检测、结构分析、尺寸/公差校验），基于 CadQuery，MIT 发起。→ **这个库的思路建议纳入你的产品**（可制造性验证门）。
- **MARB**（sunnyday-technologies）：机械装配就绪度基准，用 CADCLAW 自动判分。
- **cedrickchee/text-to-cad**：Codex/Claude 代理，导出 STEP/STL/3MF/DXF/URDF。

### 6.7 工程落地要点（避免踩坑）
1. **数值精度陷阱（OCCT）**：STEP 写精度参数默认 0.0001；导入出现"面尺寸小于容差"会产生非法形状（用 FixFaceSize healing）；布尔在默认容差下失败（FreeCAD 引入 BooleanFuzzy）；**圆角在 C1 相切面上失败（10 年未修复）**，STEP 往返可能损坏圆角。建议：显式设精度/fuzzy、做 ShapeFix/BRepCheck 修复、多内核交叉验证（FreeCAD + pythonocc + 一个商业导入器）。
2. **LLM 写代码错误率（实测）**：OpenSCAD ~0.4 错/次；**build123d ~1.4–1.7（3–4×）**；CadQuery 更难。给 build123d 注入"内省生成的 API 参考"可把错误率降约 40→33，但仍高于 OpenSCAD（[grandpacad 基准](https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d)）。→ **引擎能力越强、越难被当前模型正确写出，必须配内核验证 + 视觉审查循环。**
3. **可制造性**：倒角/圆角/抽壳是 DeepCAD/Fusion360 缺失的操作（多为 sketch-extrude）；输出须过"水密/单构件/最小特征尺寸"检查（CAD-Eval、CAD-Judge）。
4. **GPU/训练成本**：小 LoRA 微调在单卡 4090/24GB 量级可行（CAD-HLLM = Qwen2.5-7B LoRA）；B-rep 扩散（BrepGen）需更高算力且不可商用；StepForge 用 4×H100。

---

## 7. 关键空白与差异化机会

综合 5 个方向的调研，可以确认以下空白：

1. **「Text-to-CAD → 自动仿真 → 自动迭代」的完整闭环没有任何一家做到**。Zoo/Leo/Kyrall 只做生成不做仿真；SimScale/Ansys 只做仿真不做生成式 CAD；学术界已验证可行（FEA-as-feedback）但只是论文。**这是本项目最核心的差异化定位。**
2. **结构 FEA 方向的 agent 化研究明显少于 CFD**。ChatCFD/Foam-Agent 把 OpenFOAM 跑到了 82–88% 成功率，FEA 侧只有 FeaGPT、Abaqus 插件、SBIR 项目等零星工作——**力学 FEA 是相对空窗，切入时机好**。
3. **可信度/可认证性没有任何产品内建**。ASME V&V 40 的"使用情境风险分级"框架在成形但没有标准化实现；如果能在产品里内建"分布内置信度 + 分布外检测 + 求解器兜底 + 验证报告"，就能建立工程师信任壁垒。
4. **2D 草图（带约束）的生成与参数化回接没有好产品**。大多数学术工作做的是"程序化草图"或"符号特征树"，真正"约束+尺寸驱动"草图的 AI 生成仍是空白——正好对应你"含 2D 草图"的定位。

---

## 8. 实现路径建议

> 三条路径不是互斥的，而是**按数据/算力/时间预算选择或组合**。推荐以路径 A 为主干，路径 C 提供 2D 草图与 FEM 模块，路径 B 作为中长期演进。

### 路径 A：LLM Agent + 代码生成（CadQuery/build123d + OCCT 内核）—— ✅ 推荐首选

**架构**：多智能体闭环，参考 CADSmith 五智能体与 Self-Improving FEA agents：

```
用户需求(文本/2D草图/参考图)
   → Planner 拆解设计意图
   → Coder 生成 build123d/CadQuery 代码（注入内省 API 参考）
   → Executor：OCCT 内核编译 + BRepCheck/ShapeFix + 精度/fuzzy 设置 → 出 STEP
   → Validator：VLM 三视图审查 + 水密/单构件检查（CAD-Eval/CADCLAW 思路）
   → Refiner：反馈修复循环
   → 自动仿真：FreeCAD FEM(CalculiX) 或 pyccx，Gmsh 网格
   → FEA 反馈回 Refiner（参考 Self-Improving FEA agents）
```

**为什么是首选**：
- 无需训练数据、无需 GPU，用现有闭源/开源 LLM 即可起步；3–6 个月可出 MVP。
- 输出是可编辑的 Python 脚本 + STEP，保留设计意图和参数化，贴近工程师。
- 学术界最优验证架构（CADSmith 100% 可执行、Chamfer 降 38 倍）就是这一路线。

**关键坑与对策**：
- LLM 写代码错误率高（build123d ~1.4–1.7 错/次）→ 内省 API 参考注入 + 内核验证循环（错误在 Executor 层被捕获，不产生脏几何）。
- OCCT 圆角/布尔弱 → 限制生成到"草图+拉伸/切除+标准倒角"的制造友好子集，复杂圆角降级或提示；多内核交叉验证。
- 2D 草图 → 用 FreeCAD Sketcher（PlanGCS）作为草图后端，LLM 生成"约束脚本"而非裸坐标（参考 AutoConstrain 的"全约束"目标）。

### 路径 B：自研生成式模型（序列/扩散 B-Rep）—— 中期演进，建立壁垒

**路线**：
1. **代码生成微调**（投入低、见效快）：Qwen2.5-7B 用 Text-to-CadQuery 数据 SFT + GRPO 几何奖励（参考 CAD-Coder，单卡 24–48GB 可训）。→ 提升"通用 LLM"写 CAD 代码的准确率。
2. **多模态生成模型**：训练/微调 Text2CAD-CAD-MLLM 式模型，支持文本/图像/点云/2D 草图输入（CAD-MLLM 是 DeepSeek AI + 港大等中国团队参与）。
3. **B-Rep 扩散**（远期）：BrepGen 式，支持自由曲面，但算力高、商用受限。

**为什么需要**：路径 A 的生成质量上限受通用 LLM 限制；专用模型在复杂拓扑/多模态输入上有显著优势（CAD-Coder Chamfer 6.54 vs 通用 LLM 29.29）。

**许可警示**：Fusion 360 Gallery / Text2CAD **非商用**，只能评测不能训练；训练语料需自建或 ABC 逐模型尽调。

### 路径 C：FreeCAD 全栈（MCP 驱动）—— 2D 草图约束最强的快速原型

**架构**：`freecad-mcp`（1.8k star）驱动 Claude/GPT → create_object / execute_code / **run_fem_analysis**；FreeCAD 内完成 草图（PlanGCS 约束求解）+ 建模 + FEM（CalculiX）闭环。

**为什么可选**：2D 草图约束需求满足最好（真正的约束+尺寸驱动）；端到端建模+仿真在一个软件内；有开源验证范例（cantilever_fem.py、FeaGPT）。

**局限**：FreeCAD 脚本 API 复杂、LLM 错误率高、UI/性能不适合大规模生产；适合**作为路径 A 的草图模块和 FEM 后端**而非独立主架构。

### 推荐组合与阶段路线图

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1（0–3 月）：垂直闭环 MVP                                │
│   LLM → build123d/CadQuery 代码 → OCCT 内核 → STEP            │
│   输入：文本 + 简单 2D 草图；仿真：FreeCAD FEM/CalculiX 静态FEA  │
│   交付：一个可编辑零件 + 自动 FEA 报告                          │
├─────────────────────────────────────────────────────────────┤
│ Phase 2（3–9 月）：可靠性与自动化                               │
│   + VLM 视觉审查 + FEA 反馈闭环（参考 Self-Improving FEA agents）│
│   + CADCLAW 式自动验证门（水密/干涉/尺寸公差/最小特征）           │
│   + 自动评测集（CADBench/CAD-Judge/Text2CAD 评测，注意许可）     │
│   + 装配体支持（AutoMate 数据/Onshape 变量表思路）               │
├─────────────────────────────────────────────────────────────┤
│ Phase 3（9–18 月）：专业化与多物理场                            │
│   + 自建数据集微调领域模型（路径 B：CAD-Coder 式 LoRA）          │
│   + 代理模型加速仿真（30–100 个高保真算例训 PhysicsAI/SimAI 式    │
│     代理，秒级预测；最优解回求解器兜底）                         │
│   + 多物理场：热-结构耦合（FreeCAD thermomech）、CFD（OpenFOAM） │
│   + 可信度内建：分布内置信度 + 分布外检测 + 验证报告（对齐 V&V40） │
└─────────────────────────────────────────────────────────────┘
```

**差异化定位一句话**：做**"从生成式 CAD 直达验证"的垂直闭环**——不是再造一个通用 text-to-CAD，也不是再造一个通用求解器，而是把"生成 → 自动仿真 → 可制造性/力学验证 → 迭代"做成面向机械结构 FEA 的、**带可信度背书**的完整产品。

---

## 9. 风险与注意事项

1. **可制造性是全行业的硬骨头**：圆角相切、薄壁、装配一致性连 Zoo/Backflip 都解决不好。定位预期管理：MVP 阶段应限定到"制造友好特征子集"。
2. **数据许可地雷**：学术界最好的数据集（Fusion 360 Gallery、Text2CAD、BrepGen）**禁止商用**；商用训练语料是最难的部分，需要自建或对 ABC 逐模型尽调。
3. **仿真可信度**：AI/LLM 生成的仿真设置必须人工/规则校验（物料、边界条件、单位）；代理模型输出不能直接交付，必须求解器兜底；建议从立项起对齐 ASME V&V 40 的"使用情境"文档化。
4. **OCCT 数值精度陷阱**：布尔失败、圆角损坏、STEP 往返精度，必须在生成管线里做 ShapeFix/BRepCheck + 精度设置。
5. **市场窗口判断**：大厂（Neural CAD）未落地、agent 级产品（SimScale Engineering AI）刚开始，2026–2027 仍是窗口期；但同时"AI 生成速度已超过验证速度"（[sunn3d](https://sunn3d.com/2026/04/24/will-ai-generated-cad-outrun-vv/)）——**验证/可信度能力本身就是稀缺品**。
6. **成本**：LLM agent 仿真单案例约 $0.15–0.2（CFD 已证），FEA 侧相近；代理模型训练算力是隐性大头，推理几乎零成本。

---

## 10. 方法论、局限与待核实项

- **方法**：5 个并行研究子代理 × 每代理 20–50 次 WebSearch 多关键词检索（英文为主、中文为辅）+ 关键来源深度阅读。部分代理在深读阶段用 curl 抓取原文核实（传统厂商方向深读了 Neural CAD 批判、Siemens 自主仿真、Dassault Virtual Companions、Onshape MCP 四篇；开源栈方向用 GitHub API 核实了全部 star 数）。
- **环境局限**：WebFetch 在部分子代理环境被网络策略拦截，部分量化数字来自多来源搜索摘要交叉核对，未能逐篇打开原文。凡"单来源/待核实"已在文中标注。
- **数据冲突已标注**：Zoo 融资额（约 $10M vs PitchBook $35.5M）、Karman+ 产品能力（仅融资可核实）等。
- **待核实项**：CAD-ASTRA（未证实存在）、SketchSolve（无实质来源）、APS 对 STEP 翻译的官方支持清单、Applied Sciences 九 LLM FEA 评测细节、华天 CrownCAD AI 能力（厂商口径）、安世亚太 iGPT 认证说法（厂商口径）、Neural4D "-99%" 数字（厂商自述）、Autodesk Assistant 独立测试细节（第三方中文来源）。
- 建议对关键数字在正式立项前人工复核原 PDF/官网。

---

## 11. 关键来源索引

### 学术
- [DeepCAD（ICCV 2021）](https://github.com/rundiwu/DeepCAD) — 领域开创者
- [Fusion 360 Gallery（SIGGRAPH 2021）](https://github.com/AutodeskAILab/Fusion360GalleryDataset) — 人类 CAD 序列 + Gym
- [SketchGraphs](https://github.com/PrincetonLIPS/SketchGraphs) — 1,500 万工程草图 + 约束图
- [SkexGen（ICML 2022）](https://proceedings.mlr.press/v162/xu22k.html) — 解纠缠码本自回归
- [Text2CAD（NeurIPS 2024）](https://github.com/SadilKhan/Text2CAD) — 首个文本→参数化 CAD
- [CAD-MLLM（2024）](https://github.com/CAD-MLLM/CAD-MLLM) — 多模态条件 CAD 生成
- [BrepGen（SIGGRAPH 2024）](https://github.com/JackZhouSz/BrepGen) — B-Rep 扩散
- [CADCrafter（CVPR 2025）](https://mlanthology.org/cvpr/2025/chen2025cvpr-cadcrafter/) — 图像→可编辑 CAD
- [SketchDNN（ICML 2025）](https://icml.cc/virtual/2025/poster/46031) — 草图生成 SOTA
- [CAD-Coder（NeurIPS 2025）](https://huggingface.co/models/gudo7208/CAD-Coder) — 代码生成路线
- [CADSmith](https://github.com/jabarkle/CADSmith) — 5 智能体制造级 CAD
- [Self-Improving CAD with FEA as Feedback（2026）](https://arxiv.org/abs/2605.17448) — **与本项目同题的先行证据**
- [CADBench（MIT DeCoDE Lab，2026）](https://huggingface.co/datasets/DeCoDELab/CADBench) — 18k 统一评测
- [MUSE（2026）](https://dong7313.github.io/muse-benchmark/) — 可制造/可装配基准
- [LLM for CAD 综述](https://ar5iv.labs.arxiv.org/html/2505.08137) — 首个 LLM×CAD 系统综述
- [Geometric Deep Learning for CAD 综述](https://arxiv.org/abs/2402.17695)

### 厂商
- [Autodesk Neural CAD 批判（engineering.com）](https://www.engineering.com/autodesks-neural-cad-looks-good-on-paper/)
- [Siemens 自主仿真原型（官方博客）](https://blogs.sw.siemens.com/art-of-the-possible/autonomous-simulation/)
- [Dassault Virtual Companions（engineering.com）](https://www.engineering.com/dassault-unveils-ai-powered-virtual-companions/)
- [PTC Onshape FeatureScript MCP（engineering.com）](https://www.engineering.com/ptc-adds-natural-language-tools-for-onshape-cad-automation/)
- [Ansys SimAI](https://www.ansys.com/products/ai) / [Ansys 2026 R1 中文解析](https://www.softxiaoer.com/articles/ansys-2026-r1ai/)
- [Altair PhysicsAI Release Notes](https://2025.help.altair.com/2025.1/hwsolvers/altair_help/topics/release_notes/rn_2025_physicsai_r.htm)
- [COMSOL 内置代理模型](https://www.comsol.com/release/6.2/surrogate-models)
- [中望 AI-structure Copilot](https://www.zwsoft.cn/news/294-15512.html) / [中望官方 CAx 大模型口径](https://dxpress.gelonghui.com/live/2331624)
- [设序科技（36氪）](https://m.36kr.com/p/3506932610587778)

### 初创
- [Zoo 技术博客（CAD-first 论证）](https://docs.zoo.dev/blog/why-ai-must-generate-parametric-cad)
- [Zoo 公司档案（Digital Engineering）](https://www.digitalengineering247.com/company/zoo/)
- [Wevolver 七工具实测](https://www.wevolver.com/article/we-tested-7-text-to-cad-tools-are-they-actually-useful-for-engineers)
- [Leo AI 三工具对比](https://www.getleo.ai/blog/text-to-cad-tools-comparison-guide)
- [Adam/CADAM Launch HN](https://app.hncompanion.com/item?id=48572553)

### 仿真
- [ChatCFD（arXiv:2506.02019）](https://arxiv.org/abs/2506.02019)
- [Foam-Agent 2.0（NeurIPS 2025）](https://neurips.cc/virtual/2025/loc/san-diego/122973)
- [FeaGPT（arXiv:2510.21993）](https://arxiv.org/abs/2510.21993)
- [PINN/神经算子选型综述](https://www.emergentmind.com/papers/2511.04576)
- [PINN 缺陷批评](https://www.sciencedirect.com/science/article/pii/S0360835225008502)
- [ASME V&V 应用于 ML 代理可信度](https://www.osti.gov/biblio/3028632)
- [SimScale Engineering AI（2026-05）](https://www.businesswire.com/news/home/20260507641171/en/)

### 开源技术栈
- [Open CASCADE](https://en.wikipedia.org/wiki/Open_CASCADE_Technology) / [CadQuery](https://github.com/CadQuery/cadquery) / [build123d](https://github.com/gumyr/build123d) / [FreeCAD](https://github.com/FreeCAD/FreeCAD)
- [freecad-mcp](https://github.com/neka-nat/freecad-mcp) / [build123d-mcp](https://github.com/pzfreo/build123d-mcp) / [cad-cae-copilot](https://github.com/armpro24-blip/cad-cae-copilot)
- [CADCLAW（CAD 的 pytest）](https://github.com/sunnyday-technologies/CADCLAW)
- [STEP-LLM](https://github.com/JasonShiii/STEP-LLM) / [StepForge](https://github.com/nyaniv/StepForge)
- [FreeCAD FEM Python 教程](https://wiki.freecad.org/FEM_Tutorial_Python)
- [grandpacad：OpenSCAD vs CadQuery vs build123d](https://grandpacad.com/en/blog/openscad-vs-cadquery-vs-build123d)
- [sunn3d：AI 生成 CAD 与 V&V 赛跑](https://sunn3d.com/2026/04/24/will-ai-generated-cad-outrun-vv/)
