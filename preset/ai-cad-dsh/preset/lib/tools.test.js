// preset/ai-cad-dsh/preset/lib/tools.test.js
// Task 5 测试：23 个工具的形状、CAE 插槽、状态门拒绝、setParameter（A10 裁定版）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTools, setParameter, nextAction } from './tools.js';
import { makeCtx, tempBase, writeState, answeredIntake, L2 } from './test/support.js';
import { INTAKE_QUESTIONS, PLAN_QUESTIONS } from './questions.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 与 tools.js 同款推导：本文件位于 preset/ai-cad-dsh/preset/lib/，4 级上溯 = 仓库根。
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('恰好 23 个工具且 name 唯一', () => {
  const tools = makeTools({ python: 'python3' });
  assert.equal(tools.length, 23);
  assert.equal(new Set(tools.map(t => t.name)).size, 23);
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

test('cad_show_step 在未 compile 时被拒绝', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  await writeState(ctx, null, { ...answeredIntake('wf-1'), status: 'approved_for_execution', levels: { L2: structuredClone(L2) } });
  await assert.rejects(() => tools.cad_show_step.execute(ctx, { workflow_id: 'wf-1' }), /NEED_COMPILE/);
});

test('cad_show_step 返回 manifest（compiled 后 wiring 通）', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  await writeState(ctx, null, { ...answeredIntake('wf-1'), status: 'compiled', levels: { L2: structuredClone(L2) } });
  const r = await tools.cad_show_step.execute(ctx, { workflow_id: 'wf-1' });
  assert.equal(r.ok, true);
  assert.equal(r.manifest.version, 1);
  assert.equal(r.manifest.viewer, 'assembly');
  assert.equal(r.manifest.parts.length, 2);
  assert.equal(r.manifest.parts[0].id, 'c1');
  assert.ok(r.manifest.parts[0].measure.error); // 测试无真实 STEP → 响亮报缺，不静默
  assert.equal(r.manifest.connections[0].id, 'J1');
});

test('cad_show_step manifest 失败 → MANIFEST_FAILED（cmd_manifest {ok:false} 路径可达）', async () => {
  // 最终审查修复：cmd_manifest 现在把 build_manifest 失败转成 {ok:false,error}（exit 0），
  // 使 tools.js 的 MANIFEST_FAILED 分支真正可达；此前 build_manifest 抛错会经 main() 顶层
  // except 打印 ok:false 再 exit(1)，runPython 抛 BACKEND_EXIT_1，永远轮不到 MANIFEST_FAILED。
  const id = 'wf-mf-' + Date.now();
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  await writeState(ctx, null, { ...answeredIntake(id), status: 'compiled', levels: { L2: structuredClone(L2) } });
  // 坏 placements.json 落在真实 out_dir（REPO_ROOT/cad-state/<id>，gitignore 内）：子进程读的是
  // 真实文件系统（不经 mock fs），build_manifest 的 json.load 抛 JSONDecodeError → ok:false。
  const outDir = join(REPO_ROOT, 'cad-state', id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'placements.json'), '{ 不是合法 json', 'utf8');
  try {
    await assert.rejects(() => tools.cad_show_step.execute(ctx, { workflow_id: id }), /MANIFEST_FAILED/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('只有 cad_show_step 自带 output（其余 22 个走 wrap 默认 render）', () => {
  const tools = makeTools({ python: 'python3' });
  assert.deepEqual(tools.filter(t => t.output !== undefined).map(t => t.name), ['cad_show_step']);
});

test('cad_show_step.output.render 只给模型文本摘要（不 dump manifest 明细）', () => {
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const value = JSON.stringify({ ok: true, manifest: {
    version: 1, workflow_id: 'wf-1', viewer: 'assembly',
    parts: [{ id: 'c1', part_ref: 'hn1', step: 'cad-state/x/hn1.step',
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], measure: {} }],
    connections: [], assembly_step: 'cad-state/x/assembly.step',
  } });
  const blocks = tools.cad_show_step.output.render({}, value);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /3D 预览就绪/);
  assert.doesNotMatch(blocks[0].text, /workflow_id/); // 摘要而非原始 JSON dump
});

test('cad_show_step.output.presentationMeta 产出客户端契约 manifest（step_b64/name/measure 键名）', () => {
  // 真实文件系统（REPO_ROOT/cad-state/<id>，gitignore 内）：presentationMeta 经 node fs
  // 读 STEP 字节做 base64。写入一个真实 STEP 文件断言 step_b64 与 measure 键名转换。
  const id = 'wf-meta-' + Date.now();
  const outDir = join(REPO_ROOT, 'cad-state', id);
  mkdirSync(outDir, { recursive: true });
  const stepRel = join('cad-state', id, 'hn1.step');
  const stepContent = 'ISO-10303-21;\nFAKE STEP DATA\n';
  writeFileSync(join(REPO_ROOT, stepRel), stepContent, 'utf8');
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const backendManifest = {
    version: 1, workflow_id: id, viewer: 'assembly',
    parts: [{ id: 'c1', part_ref: 'hn1', step: stepRel,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      measure: { volume_m3: 0.001, surface_area_m2: 0.02, centroid_m: [0, 0, 0], watertight: true } }],
    connections: [{ id: 'J1', type: 'kinematic', a: 'c1', b: 'c2' }],
    assembly_step: join('cad-state', id, 'assembly.step'),
  };
  try {
    const meta = tools.cad_show_step.output.presentationMeta({}, JSON.stringify({ ok: true, manifest: backendManifest }));
    assert.ok(meta && meta.manifest, 'presentationMeta 应返回 { manifest }');
    const p = meta.manifest.parts[0];
    assert.equal(p.name, 'hn1');
    assert.equal(p.step_b64, Buffer.from(stepContent).toString('base64'));
    assert.deepEqual(p.measure, { volume: 0.001, surface_area: 0.02, centroid: [0, 0, 0], watertight: true });
    assert.equal(meta.manifest.assembly_step, join('cad-state', id, 'assembly.step'));
    assert.equal(meta.manifest.connections[0].id, 'J1');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('cad_show_step.output.presentationMeta 对非 manifest 值返回 undefined（不产出 meta）', () => {
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  assert.equal(tools.cad_show_step.output.presentationMeta({}, JSON.stringify({ ok: false, error: 'x' })), undefined);
  assert.equal(tools.cad_show_step.output.presentationMeta({}, 'not json'), undefined);
});
