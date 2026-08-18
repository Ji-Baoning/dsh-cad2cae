// preset/ai-cad-dsh/preset/lib/tools.test.js
// Task 5 测试：22 个工具的形状、CAE 插槽、状态门拒绝、setParameter（A10 裁定版）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTools, setParameter, nextAction } from './tools.js';
import { makeCtx, tempBase, writeState, answeredIntake, L2 } from './test/support.js';

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
  const out = setParameter(intent, { node_id: 'hn1', field: 'depth', value: 0.01 });
  assert.equal(out.parts.find(n => n.id === 'hn1').depth, 0.01);
  assert.throws(() => setParameter(intent, { node_id: 'nope', field: 'x', value: 1 }), /PARAM_NOT_FOUND/);
});

test('cad_attach_intent 拒绝非法 intent（INTENT_INVALID 门禁）', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const base = answeredIntake('wf-1');
  // status=plan_attached、attached_level/approved_level=-1（answeredIntake 默认）：L0 attach 合法。
  await writeState(ctx, base, { ...base, status: 'plan_attached', plan: 'p' });
  await assert.rejects(() => tools.cad_attach_intent.execute(ctx, {
    workflow_id: 'wf-1', level: 'L0',
    intent: { schema_version: 2, units: 'inches', parts: [] },
  }), /INTENT_INVALID/);
});

test('cad_edit_parameter 门禁与 re-arm', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const withL2 = (status) => ({ ...answeredIntake('wf-1'), status, levels: { L2: structuredClone(L2) } });

  // compiled → 改参成功，re-arm 到 approved_for_execution，L2 修改落盘，note 提示重新生成。
  await writeState(ctx, null, withL2('compiled'));
  const r = await tools.cad_edit_parameter.execute(ctx, { workflow_id: 'wf-1', node_id: 'hn1', field: 'depth', value: 0.01 });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'approved_for_execution');
  assert.match(r.note, /cad_generate_code/);
  const back = await tools.cad_get_state.execute(ctx, { workflow_id: 'wf-1' });
  assert.equal(back.status, 'approved_for_execution');
  const saved = JSON.parse(await ctx.get('fs').readText('cad-state/wf-1/state.json'));
  assert.equal(saved.levels.L2.parts.find(n => n.id === 'hn1').depth, 0.01);

  // execution_failed → 必须先 cad_prepare_retry 确认清理。
  await writeState(ctx, null, withL2('execution_failed'));
  await assert.rejects(() => tools.cad_edit_parameter.execute(ctx, { workflow_id: 'wf-1', node_id: 'hn1', field: 'depth', value: 0.02 }),
    /NEED_PREPARE_RETRY/);

  // verified → 已交付不可改参。
  await writeState(ctx, null, withL2('verified'));
  await assert.rejects(() => tools.cad_edit_parameter.execute(ctx, { workflow_id: 'wf-1', node_id: 'hn1', field: 'depth', value: 0.02 }),
    /EDIT_NOT_ALLOWED/);
});
