// preset/ai-cad-dsh/preset/ai-cad-plugin.js
// DSH 插件入口：唯一引入 @deepseek-ai 的文件。注册系统提示 + 22 个工具。
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { registerTools } from './lib/register.js';
import { pickOutput, serializeResult } from './lib/wrap.js';

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
  '9. **静态预览图**：cad_show_step 返回的 preview 字段带静态预览 PNG 路径（仓库相对路径，如 cad-state/<id>/preview.png）；紧随其调用 show_image(path=该路径) 把预览图显示到对话。show_image 失败（如文件缺失）要如实报告错误，不得静默跳过。',
].join('\n');

export function apply(ctx, config) {
  ctx.systemPrompt.section({ name: 'AI-CAD 工作流', order: 100, text: PROMPT });
  const wrap = (t) => defineTool({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    // output.render 的返回值就是模型看到的 tool-result 内容（dsh-tools createSuccessResult）。
    // 历史 bug：render() 无条件 return ''，使模型拿不到任何工具结果（session 里 tool-result content 为空）。
    // wlj 参照插件的标准写法：返回 [{ type: 'text', text }] 内容块。
    // pickOutput：工具自带 output（cad_show_step 的 presentationMeta 投递客户端 manifest、
    // show_image 的 render 返回 [text, image] 内容块）原样用；其余 23 个 cad_* 走默认 render
    // （JSON 序列化结果给模型）。决策逻辑在 lib/wrap.js（零依赖可测）。
    output: pickOutput(t),
    async execute(args) {
      const result = await t.execute(ctx, args || {});
      // 带自定义 output 的工具 execute 结果不 stringify，原样交 createSuccessResult
      // （render/presentationMeta 收到对象：showImageContent 组 image 块、clientManifest 投影）。
      return serializeResult(t, result);
    },
  });
  registerTools(ctx, config, wrap);
}
