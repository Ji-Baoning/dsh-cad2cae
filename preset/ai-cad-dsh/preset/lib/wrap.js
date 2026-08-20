// preset/ai-cad-dsh/preset/lib/wrap.js
// ai-cad-plugin.js wrap() 的纯逻辑（零依赖，不引入 @deepseek-ai，可独立测试）。
//
// 契约：工具对象可自带 `output`（render/presentationMeta）。带 output 的工具：
//   - output 用工具自定义的（render 返回 [text, image] 内容块、presentationMeta 投递客户端 meta）
//   - execute 结果**不 stringify**，原样交给 createSuccessResult（render/presentationMeta 收到对象）
// 无 output 的工具（既有 23 个 cad_*）：默认 string schema + render（JSON 序列化结果给模型）。
export function defaultOutputRender(value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

/** 选 output：工具自带则原样用，否则默认 string schema + JSON 摘要 render。 */
export function pickOutput(t) {
  return t.output ?? { schema: { type: 'string' }, render: (_args, value) => defaultOutputRender(value) };
}

/** 决定 execute 返回值形态：带自定义 output → 原始对象；否则 JSON 字符串（模型侧文本）。 */
export function serializeResult(t, result) {
  return t.output === void 0 ? JSON.stringify(result, null, 2) : result;
}
