// preset/ai-cad-dsh/preset/lib/plugin.test.js
// Task 6 测试：注册器与工具名集合的一致性。仅依赖 ./register.js + ./tools.js，
// 不引入 @deepseek-ai（可用 node --test 直接运行）。
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

test('registerTools 注册 23 个带 schema 的工具', () => {
  const ctx = mockCtx();
  registerTools(ctx, { python: 'python3' }, (t) => ({ ...t, __wrapped: true }));
  assert.equal(ctx._tools.length, 23);
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
