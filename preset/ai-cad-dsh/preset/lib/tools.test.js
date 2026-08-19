// preset/ai-cad-dsh/preset/lib/tools.test.js
// Task 5 测试：22 个工具的形状、CAE 插槽、状态门拒绝、setParameter（A10 裁定版）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTools, setParameter, nextAction } from './tools.js';
import { makeCtx, tempBase, writeState, answeredIntake, L2 } from './test/support.js';
import { INTAKE_QUESTIONS, PLAN_QUESTIONS } from './questions.js';

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

test('cad_get_state / cad_next_action 暴露 open_questions（模型无需翻源码猜提问 id）', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const base = answeredIntake('wf-1');

  // awaiting_confirmation → 返回 9 条 intake 提问（id/label/hint/options 完整）。
  await writeState(ctx, null, base);
  const st = await tools.cad_get_state.execute(ctx, { workflow_id: 'wf-1' });
  assert.deepEqual(st.open_questions.map(q => q.id), INTAKE_QUESTIONS.map(q => q.id));
  assert.ok(st.open_questions[0].label && st.open_questions[0].id === 'product_name');
  const na = await tools.cad_next_action.execute(ctx, { workflow_id: 'wf-1' });
  assert.deepEqual(na.open_questions.map(q => q.id), INTAKE_QUESTIONS.map(q => q.id));

  // 进入 plan_attached → 换成 4 条 plan 提问。
  await writeState(ctx, null, { ...base, status: 'plan_attached', plan: 'p' });
  const st2 = await tools.cad_get_state.execute(ctx, { workflow_id: 'wf-1' });
  assert.deepEqual(st2.open_questions.map(q => q.id), PLAN_QUESTIONS.map(q => q.id));
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
  const saved = JSON.parse(await ctx.get('fs').readText(await ctx.get('fs').resolve('cad-state/wf-1/state.json')));
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
