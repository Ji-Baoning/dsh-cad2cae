// preset/ai-cad-dsh/preset/lib/state.js
// 工作流状态机：状态跃迁的唯一权威 + fs 读写薄封装。纯函数，不引入任何外部依赖。
// 状态枚举：awaiting_confirmation → brief_approved → plan_attached → plan_approved
//           → approved_for_execution → (execution_failed | verified) → completed
// 消费 Task 1 的 openQuestions / allRequiredAnswered 做 intake 完整性门禁。

import { openQuestions, allRequiredAnswered } from './questions.js';

export const DEFAULT_POINTER = 'cad-state/current.json';
const LEVELS = ['L0', 'L1', 'L2'];

export function newState(request, opts = {}) {
  return {
    workflow_id: opts.workflow_id || 'cad-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'awaiting_confirmation',
    request,
    answers: {},
    plan: '',
    levels: {},
    attached_level: -1,
    approved_level: -1,
    delivery: {},
    cleanup_confirmed: false,
    last_error: undefined,
    history: [],
  };
}

function push(s, event, extra = {}) {
  return { ...s, history: [...s.history, { at: new Date().toISOString(), event, ...extra }] };
}

export function answer(state, id, value) {
  return push({ ...state, answers: { ...state.answers, [id]: value } }, 'answer', { id, value });
}

// 裁定 A1：先做 intake 完整性门禁（接口承诺），再检查状态并跃迁。
export function approveBrief(state) {
  if (!allRequiredAnswered(state, openQuestions(state))) {
    throw new Error('INTAKE_INCOMPLETE');
  }
  if (state.status !== 'awaiting_confirmation' && state.status !== 'brief_rejected') {
    throw new Error('WRONG_STATE');
  }
  return push({ ...state, status: 'brief_approved' }, 'approve_brief');
}

export function attachPlan(state, planText) {
  if (state.status !== 'brief_approved') throw new Error('WRONG_STATE');
  return push({ ...state, status: 'plan_attached', plan: planText }, 'attach_plan');
}

// 跃迁门矩阵：L0 需从未 attach 且从未 approve；L1 需已 approve 到 0；L2 需已 approve 到 1。
// 裁定 A3：状态门允许 plan_attached（attachPlan 后立即 attach L0）与 plan_approved。
export function attachIntent(state, level, intent) {
  const idx = LEVELS.indexOf(level);
  if (idx < 0) throw new Error('BAD_LEVEL');
  if (state.status !== 'plan_attached' && state.status !== 'plan_approved') {
    throw new Error('WRONG_STATE');
  }
  const gates = { 0: () => state.attached_level === -1 && state.approved_level === -1,
                  1: () => state.approved_level === 0,
                  2: () => state.approved_level === 1 };
  if (!gates[idx]()) throw new Error('LEVEL_GATE_VIOLATION');
  return push({ ...state, attached_level: idx, levels: { ...state.levels, [level]: intent } }, 'attach_intent', { level });
}

// 裁定 A2：不抛 NO_INTENT_ATTACHED——无 intent 时 approved_level = -1 属合法状态。
export function approvePlan(state) {
  if (state.status !== 'plan_attached' && state.status !== 'plan_approved') throw new Error('WRONG_STATE');
  return push({ ...state, status: 'plan_approved', approved_level: state.attached_level, attached_level: -1 },
              'approve_plan');
}

export function approveExecution(state) {
  if (state.status !== 'plan_approved') throw new Error('WRONG_STATE');
  if (state.attached_level < 2) throw new Error('LEVEL_L2_REQUIRED');
  return push({ ...state, status: 'approved_for_execution' }, 'approve_execution');
}

export function approveDelivery(state, result) {
  if (state.status !== 'verified') throw new Error('WRONG_STATE');
  return push({ ...state, status: 'completed', delivery: result }, 'approve_delivery');
}

export function prepareRetry(state, cleanupConfirmed, reason) {
  if (state.status !== 'execution_failed') throw new Error('WRONG_STATE');
  if (!cleanupConfirmed) throw new Error('CLEANUP_NOT_CONFIRMED');
  return push({ ...state, status: 'approved_for_execution', cleanup_confirmed: true, last_error: reason },
              'prepare_retry', { reason });
}

export function latestIntentFile(state) {
  const idx = Math.max(0, state.attached_level);
  return 'intent-' + LEVELS[idx] + '.json';
}

export async function loadState(fs, statePath) {
  const target = await resolveStatePath(fs, statePath);
  try {
    const text = await fs.readText(target);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveState(fs, statePath, state) {
  await fs.writeText(await resolveStatePath(fs, statePath), JSON.stringify(state, null, 2));
}

export async function mutate(fs, statePath, fn) {
  const cur = (await loadState(fs, statePath)) || newState('', {});
  const next = fn(cur);
  await saveState(fs, statePath, next);
  return next;
}

export async function resolveStatePath(fs, statePath) {
  const p = statePath || DEFAULT_POINTER;
  if (p === DEFAULT_POINTER) {
    try {
      const pointer = JSON.parse(await fs.readText(await fs.resolve(DEFAULT_POINTER)));
      return pointer.state_path;
    } catch {
      return await fs.resolve(DEFAULT_POINTER);
    }
  }
  return await fs.resolve(p);
}
