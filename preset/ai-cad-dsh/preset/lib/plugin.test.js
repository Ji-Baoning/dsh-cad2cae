// preset/ai-cad-dsh/preset/lib/plugin.test.js
// Task 6 测试：注册器与工具名集合的一致性。仅依赖 ./register.js + ./tools.js，
// 不引入 @deepseek-ai（可用 node --test 直接运行）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from './register.js';
import { makeTools } from './tools.js';
import { pickOutput, serializeResult, defaultOutputRender } from './wrap.js';

function mockCtx() {
  const tools = [];
  return {
    tools: { register: (t) => tools.push(t) },
    get: (s) => s === 'fs' ? null : s === 'subprocess' ? null : undefined,
    _tools: tools,
  };
}

test('registerTools 注册 24 个带 schema 的工具', () => {
  const ctx = mockCtx();
  registerTools(ctx, { python: 'python3' }, (t) => ({ ...t, __wrapped: true }));
  assert.equal(ctx._tools.length, 24);
  for (const t of ctx._tools) {
    assert.ok(t.name && t.description && t.parameters);
    assert.equal(t.__wrapped, true);
  }
});

// ── wrap 决策逻辑（lib/wrap.js，零依赖可测）──
test('pickOutput：无自定义 output 的工具得到默认 string schema + JSON render', () => {
  const t = { name: 'cad_x', parameters: {} };
  const out = pickOutput(t);
  assert.deepEqual(out.schema, { type: 'string' });
  const blocks = out.render({}, { a: 1 });
  assert.deepEqual(blocks, [{ type: 'text', text: '{\n  "a": 1\n}' }]);
});

test('pickOutput：自带 output 的工具原样透传（不被默认覆盖）', () => {
  const custom = { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'custom' }] };
  assert.equal(pickOutput({ name: 'show_image', output: custom }), custom);
});

test('serializeResult：无自定义 output → JSON 字符串；有自定义 output → 原始对象', () => {
  assert.equal(serializeResult({ name: 'cad_x' }, { ok: true }), '{\n  "ok": true\n}');
  assert.deepEqual(serializeResult({ name: 'show_image', output: {} }, { ok: true }), { ok: true });
  assert.deepEqual(serializeResult({ name: 'cad_show_step', output: {} }, { ok: true, manifest: [], preview: null }),
    { ok: true, manifest: [], preview: null });
});

test('defaultOutputRender：字符串原样、对象 JSON 序列化（模型侧文本信封）', () => {
  assert.deepEqual(defaultOutputRender('hi'), [{ type: 'text', text: 'hi' }]);
  assert.equal(defaultOutputRender({ ok: true })[0].text, '{\n  "ok": true\n}');
});

test('makeTools 与 registerTools 名称一致', () => {
  const a = makeTools({ python: 'python3' }).map(t => t.name).sort();
  const ctx = mockCtx();
  registerTools(ctx, { python: 'python3' });
  const b = ctx._tools.map(t => t.name).sort();
  assert.deepEqual(a, b);
});
