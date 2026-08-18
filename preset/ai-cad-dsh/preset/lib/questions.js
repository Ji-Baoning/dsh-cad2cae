// preset/ai-cad-dsh/preset/lib/questions.js
// 纯数据 + 纯函数：intake/plan 提问清单与"回答齐全"判定。不接触状态机。

export const INTAKE_QUESTIONS = [
  { id: 'product_name', label: '产品/部件名称', hint: '一句话描述交付对象', required: true },
  { id: 'units', label: '几何单位', hint: 'meters 为默认推荐', required: true,
    options: [{ value: 'meters', label: '米（推荐）' }, { value: 'mm', label: '毫米' }] },
  { id: 'scope', label: '本次交付范围', required: true,
    options: [{ value: 'part', label: '单个零件' }, { value: 'assembly', label: '装配体' }] },
  { id: 'material', label: '材料', hint: '如 AL6061；不确定填"未指定"', required: true },
  { id: 'connection_nature', label: '装配连接性质', required: true,
    options: [{ value: 'none', label: '无/单零件' }, { value: 'static', label: '静态（焊接/螺栓/胶接）' },
              { value: 'kinematic', label: '运动学（铰链/滑动等运动副）' }] },
  { id: 'ground_part', label: '基准（接地）部件', required: true,
    options: [{ value: 'auto', label: '自动选择' }, { value: 'part_id', label: '指定部件 id' },
              { value: 'none', label: '无（单零件）' }] },
  { id: 'source_quality', label: '需求文本完整度自评', required: true,
    options: [{ value: 'high', label: '完整（尺寸/顺序/连接都明确）' },
              { value: 'medium', label: '大致完整，个别缺失' },
              { value: 'low', label: '不完整，需补充' }] },
  { id: 'dimensions_strategy', label: '尺寸策略', required: true,
    options: [{ value: 'parametric', label: '参数化（可改参）' }, { value: 'absolute', label: '固定数值' }] },
  { id: 'feature_scope_check', label: '受限特征子集确认', hint: '无 revolve/sweep/loft/rib/钣金', required: true,
    options: [{ value: 'yes', label: '已确认不越界' }, { value: 'no', label: '需求超出子集' }] },
];

export const PLAN_QUESTIONS = [
  { id: 'feature_order', label: '特征构建顺序', hint: '哪些特征先建、依赖关系', required: true },
  { id: 'parametric_intent', label: '参数化意图', hint: '哪些尺寸/位置应参数化以便改参', required: true },
  { id: 'plan_risks', label: '可预见风险点', hint: '几何或装配上可能出问题之处', required: true },
  { id: 'verification_plan', label: '验收校验项', hint: '体数/体积/质心/装配干涉', required: true },
];

export function openQuestions(state) {
  if (state.status === 'awaiting_confirmation' || state.status === 'brief_rejected') return INTAKE_QUESTIONS;
  return PLAN_QUESTIONS;
}

export function allRequiredAnswered(state, questions) {
  return questions.every(q => {
    if (!q.required) return true;
    const v = state.answers?.[q.id];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

export function answerValue(state, id) {
  return state.answers?.[id];
}
