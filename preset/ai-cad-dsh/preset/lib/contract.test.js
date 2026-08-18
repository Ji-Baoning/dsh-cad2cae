// preset/ai-cad-dsh/preset/lib/contract.test.js
// Task 7 端到端契约测试：intake → L0/L1/L2 → 生成 → 编译 → 测量 → 校验 → 交付。
// 依赖 Task 1-6 产物 + Plan A（src/cad_intent）+ Plan B（src/cad_codegen）。
// 测试策略：expected 用"先测量后校验"（expected = measured）保证确定性 PASS，不硬编码体积。
// 若 Plan A/B 未实现则 skip 并给出明确提示。
//
// 注意：本测试经 makeCtx 的 temp fs 把 REPO_ROOT 绝对路径重映射到临时目录，但 outDirFor 的
// 真实路径（resolve(REPO_ROOT, 'cad-state', <id>, ...)）会落到仓库根 cad-state/ 下
// （见 makeCtx 注释；实测 generate/compile 产物落在临时目录）。.gitignore 由控制器收尾处理。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeTools } from './tools.js';
import { makeCtx, tempBase, L0, L1, L2 } from './test/support.js';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const hasPlanA = existsSync(resolve(REPO, 'src', 'cad_intent', '__init__.py'));
const hasPlanB = existsSync(resolve(REPO, 'src', 'cad_codegen', '__init__.py'));
const skip = !(hasPlanA && hasPlanB) && 'Plan A/B 未执行：先实现 src/cad_intent 与 src/cad_codegen';

test('契约：intake→L0/L1/L2→生成→编译→测量→校验→交付', { skip }, async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' });
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));
  const T = async (name, args) => { const r = await tools[name].execute(ctx, args); return r; };

  // 启动 + intake 全答
  const wf = await T('cad_start_workflow', { request: '制造一个 revolute 铰链装配（hub 圆筒 + post 方柱）' });
  const wid = wf.workflow_id;
  for (const q of ['product_name', 'units', 'scope', 'material', 'connection_nature', 'ground_part', 'source_quality', 'dimensions_strategy', 'feature_scope_check']) {
    const value = q === 'units' ? 'meters' : q === 'feature_scope_check' ? 'yes' : 'sample';
    await T('cad_answer_question', { workflow_id: wid, id: q, value });
  }
  await T('cad_approve_brief', { workflow_id: wid });

  // 计划 + 三层意图
  await T('cad_attach_plan', { workflow_id: wid, plan: '先 hub 后 post；revolute 沿 Z；质心校验' });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L0', intent: L0 });
  await T('cad_approve_plan', { workflow_id: wid });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L1', intent: L1 });
  await T('cad_approve_plan', { workflow_id: wid });
  await T('cad_attach_intent', { workflow_id: wid, level: 'L2', intent: L2 });
  await T('cad_approve_execution', { workflow_id: wid });

  // 生成（断言 hn1 类 + assembly 模块）
  const gen = await T('cad_generate_code', { workflow_id: wid });
  assert.equal(gen.ok, true);
  assert.ok(gen.written.some(p => p.endsWith('hn1.py')), '缺少 hn1.py');
  assert.ok(gen.written.some(p => p.endsWith('assembly.py')), '缺少 assembly.py');

  // 编译（断言 artifact 存在且非空）
  const comp = await T('cad_compile', { workflow_id: wid });
  assert.equal(comp.ok, true);
  assert.ok(comp.artifacts.length >= 3, '装配 + 双零件应各产出一个 STEP');
  for (const a of comp.artifacts) {
    if (a.endsWith('.step')) {
      const abs = resolve(REPO, a);
      assert.equal(existsSync(abs), true, 'artifact 不存在: ' + a);
      assert.ok(statSync(abs).size > 0, 'artifact 为空: ' + a);
    }
  }

  // 测量装配（体数 ≥ 2）
  const meas = await T('cad_measure', { workflow_id: wid });
  assert.ok(meas.measured.bodies >= 2, '装配体数应 ≥ 2，实测 ' + meas.measured.bodies);

  // 校验：expected = measured 保证确定性 PASS
  const exp = {
    bodies: meas.measured.bodies,
    volume_m3: meas.measured.volume_m3,
    surface_area_m2: meas.measured.surface_area_m2,
    watertight: true,
  };
  const v = await T('cad_verify_execution', { workflow_id: wid, expected: exp });
  assert.equal(v.verdict, 'PASS');

  // 交付
  const done = await T('cad_approve_delivery', { workflow_id: wid });
  assert.equal(done.status, 'completed');
});
