import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, answer, approveBrief, attachPlan, attachIntent, approvePlan,
  approveExecution, approveDelivery, prepareRetry, latestIntentFile, resolveStatePath,
} from './state.js';
import { INTAKE_QUESTIONS } from './questions.js';

function intakeComplete() {
  const s0 = newState('制造一个铰链装配', { workflow_id: 'wf-t' });
  return INTAKE_QUESTIONS.length
    ? INTAKE_QUESTIONS.reduce((s, q) => answer(s, q.id, 'x'), s0)
    : s0;
}
function toApprovedForExecution() {
  let s = intakeComplete();
  s = approveBrief(s);
  s = attachPlan(s, '先 hub 后 post；质心校验');
  s = attachIntent(s, 'L0', { schema_version: 2, units: 'meters', parts: {} });
  s = approvePlan(s);
  s = attachIntent(s, 'L1', { schema_version: 2, units: 'meters', parts: { c1: {} }, assembly: {} });
  s = approvePlan(s);
  s = attachIntent(s, 'L2', { schema_version: 2, units: 'meters', parts: { c1: {} }, assembly: {} });
  return approveExecution(s);
}

test('完整流程到达 completed', () => {
  let s = toApprovedForExecution();
  s = prepareRetry({ ...s, status: 'execution_failed' }, true, '编译超时');
  assert.equal(s.status, 'approved_for_execution');
  s = approveDelivery({ ...s, status: 'verified' }, { ok: true });
  assert.equal(s.status, 'completed');
});

test('门禁：intake 未齐全 approveBrief 抛错；未到 L2 approveExecution 抛错', () => {
  assert.throws(() => approveBrief(newState('x', { workflow_id: 'wf-t' })), /INTAKE_INCOMPLETE/);
  const s = approvePlan(attachPlan(approveBrief(intakeComplete()), 'p'));
  assert.throws(() => approveExecution({ ...s, attached_level: 1 }), /LEVEL_L2_REQUIRED/);
});

test('prepareRetry 须确认清理', () => {
  const s = { ...toApprovedForExecution(), status: 'execution_failed' };
  assert.throws(() => prepareRetry(s, false, 'x'), /CLEANUP_NOT_CONFIRMED/);
  assert.equal(prepareRetry(s, true, 'x').status, 'approved_for_execution');
});

test('latestIntentFile 随 level 变化', () => {
  assert.equal(latestIntentFile({ attached_level: 0 }), 'intent-L0.json');
  assert.equal(latestIntentFile({ attached_level: 1 }), 'intent-L1.json');
  assert.equal(latestIntentFile({ attached_level: 2 }), 'intent-L2.json');
  assert.equal(latestIntentFile({ attached_level: -1 }), 'intent-L0.json');
});

test('resolveStatePath 解析指针文件', async () => {
  const fs = { resolve: p => `T:${p}`, readText: async p => JSON.stringify({
    workflow_id: 'wf-1', state_path: 'cad-state/wf-1/state.json',
  }) };
  const target = await resolveStatePath(fs, 'cad-state/current.json');
  assert.equal(target, 'cad-state/wf-1/state.json');
});
