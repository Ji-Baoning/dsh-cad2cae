// preset/ai-cad-dsh/preset/lib/register.js
// 把 makeTools 结果包装为 DSH defineTool 定义注册。wrap 缺省为恒等（供测试）。
import { makeTools } from './tools.js';

export function registerTools(ctx, config, wrap = (t) => t) {
  for (const t of makeTools(config)) {
    ctx.tools.register(wrap(t));
  }
}
