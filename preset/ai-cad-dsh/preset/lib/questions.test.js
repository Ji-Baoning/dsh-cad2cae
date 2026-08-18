import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTAKE_QUESTIONS,
  PLAN_QUESTIONS,
  openQuestions,
  allRequiredAnswered,
  answerValue,
} from './questions.js';

test('清单规模：9 项 intake + 4 项 plan', () => {
  assert.equal(INTAKE_QUESTIONS.length, 9);
  assert.equal(PLAN_QUESTIONS.length, 4);
});

test('openQuestions 按状态分流，answerValue 取值，allRequiredAnswered 判定齐全', () => {
  const base = { status: 'awaiting_confirmation', answers: {} };
  assert.deepEqual(openQuestions(base).map(q => q.id), INTAKE_QUESTIONS.map(q => q.id));
  assert.equal(allRequiredAnswered(base, INTAKE_QUESTIONS), false);

  const answered = { ...base, answers: Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, 'x'])) };
  assert.equal(allRequiredAnswered(answered, INTAKE_QUESTIONS), true);
  assert.equal(answerValue(answered, 'product_name'), 'x');

  const planned = { ...answered, status: 'brief_approved' };
  assert.deepEqual(openQuestions(planned).map(q => q.id), PLAN_QUESTIONS.map(q => q.id));
});

test('intake 提问含 feature_scope_check 布尔确认', () => {
  const q = INTAKE_QUESTIONS.find(x => x.id === 'feature_scope_check');
  assert.ok(q && q.options && q.options.some(o => o.value === 'yes'));
});
