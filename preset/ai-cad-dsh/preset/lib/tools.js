// preset/ai-cad-dsh/preset/lib/tools.js
// 23 个 cad_* 工具的 execute(ctx, args) 完整实现。纯逻辑，不引入 @deepseek-ai。
// 状态机新增状态 generated / compiled（在 approved_for_execution 之后、verified/execution_failed 之前）。
// 裁定落地：A6（cad_measure 默认路径 = cad-state/<id>/assembly.step）、
// A10（setParameter 在 parts 数组中按 node.id 查找）、A11（cad_start_workflow 先写
// cad-state/<id>/state.json 再写指针文件）。
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newState, answer, approveBrief, attachPlan, attachIntent, approvePlan,
  approveExecution, approveDelivery, prepareRetry, latestIntentFile,
  loadState, saveState, DEFAULT_POINTER,
} from './state.js';
import { openQuestions, allRequiredAnswered } from './questions.js';
import {
  validateIntent, generateSources, compileSources, measureStep,
  verifyExecution, healthCheck, backendOp,
} from './backend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function statePathFor(args) {
  // 仓库相对路径（wlj 同款）：fs 服务把相对路径解析到工作区根（resolveStatePath 已路由）。
  return args.workflow_id ? join('cad-state', args.workflow_id, 'state.json') : DEFAULT_POINTER;
}
function outDirFor(args) {
  const id = args.workflow_id || 'default';
  return resolve(REPO_ROOT, 'cad-state', id);
}
function intentPathFor(args, state) {
  const id = args.workflow_id || 'default';
  return join('cad-state', id, latestIntentFile(state));
}

const SIM = (name) => ({ name, description: `CAE 仿真插槽（预留）：${name}。Phase 1 未实现。`,
  parameters: { workflow_id: { type: 'string' } },
  async execute() { return { status: 'SIMULATION_NOT_IMPLEMENTED', message: `${name} 属于 CAE（Phase 2），Phase 1 仅 CAD 生成。` }; } });

export function setParameter(intent, { node_id, field, value, profile_index }) {
  // A10 裁定：parts 为节点数组，按 node.id === node_id 查找；node 或 field 不存在抛 PARAM_NOT_FOUND。
  const node = (intent.parts || []).find(n => n && n.id === node_id);
  if (!node) throw new Error('PARAM_NOT_FOUND');
  if (profile_index !== undefined && Array.isArray(node.profiles) && node.profiles[profile_index]) {
    if (!(field in node.profiles[profile_index])) throw new Error('PARAM_NOT_FOUND');
    node.profiles[profile_index][field] = value;
  } else {
    if (!(field in node)) throw new Error('PARAM_NOT_FOUND');
    node[field] = value;
  }
  return intent;
}

export function nextAction(state) {
  switch (state.status) {
    case 'awaiting_confirmation':
    case 'brief_rejected':
      return '请回答 intake 提问（cad_answer_question），然后 cad_approve_brief';
    case 'brief_approved':
      return '请提交构建计划（cad_attach_plan）';
    case 'plan_attached':
      return '请从 L0 开始逐层 attach 意图（cad_attach_intent level=L0），每层后 cad_approve_plan';
    case 'plan_approved':
      return '请 cad_attach_intent L1 / L2；L2 就绪后 cad_approve_execution';
    case 'approved_for_execution':
      return '请 cad_generate_code → cad_compile → cad_measure → cad_verify_execution';
    case 'generated':
      return '请 cad_compile → cad_measure → cad_verify_execution';
    case 'compiled':
      return '请 cad_verify_execution（提供 expected 契约）';
    case 'execution_failed':
      return '请 cad_prepare_retry（确认清理）后重试；修改意图需先 cad_prepare_retry 再 cad_edit_parameter';
    case 'verified':
      return '请 cad_approve_delivery 完成交付';
    case 'completed':
      return '工作流已完成';
    default:
      return '未知状态';
  }
}

export function makeTools(config) {
  const needs = async (ctx, args) => {
    const st = await loadState(ctx.get('fs'), statePathFor(args));
    if (!st) throw new Error('NO_WORKFLOW');
    return st;
  };
  const save = async (ctx, args, st) => saveState(ctx.get('fs'), statePathFor(args), st);
  const writeIntentFile = async (ctx, args, st) => {
    const level = 'L' + st.attached_level;
    const intent = st.levels[level];
    // 真实 dsh fs 契约：writeText 只收 resolve() 后的 target 对象（历史 bug：直传字符串路径
    // 导致 Cannot read properties of undefined (reading 'trim')）。
    const fs = ctx.get('fs');
    await fs.writeText(await fs.resolve(intentPathFor(args, st)), JSON.stringify(intent, null, 2));
  };
  const configStatePath = { ...config };

  const tools = [
    { name: 'cad_environment_profile', description: '报告 AI-CAD 环境能力、受限特征子集、双交付物与单位约定',
      parameters: {},
      async execute() {
        return { plugin: 'ai-cad-dsh', deliverables: ['build123d 源码', '编辑态 STEP（米）'],
          feature_subset: 'sketch: rectangle/circle/line/arc/ellipse/spline; extrude boss/cut; fillet/chamfer; linear/circular_pattern; mirror; 装配: static/kinematic',
          unsupported: ['revolve', 'sweep', 'loft', 'rib', '钣金'],
          cae: 'Phase 2 预留（cad_simulate_*）', units: 'meters' };
      } },

    { name: 'cad_start_workflow', description: '新建工作流并返回 workflow_id',
      parameters: { request: { type: 'string' , required: true } },
      async execute(ctx, args) {
        // A11 裁定：状态写到 cad-state/<workflow_id>/state.json（fs.writeText 自动建父目录），
        // 再写指针文件；避免状态落进 current.json 而指针指向从未写入的路径（后续 NO_WORKFLOW）。
        const st = newState(args.request, { workflow_id: args.workflow_id });
        const statePath = statePathFor(st);
        await saveState(ctx.get('fs'), statePath, st);
        // 先 resolve 得 target 对象再写指针（真实 dsh fs 契约，见 writeIntentFile 注）。
        const fs = ctx.get('fs');
        await fs.writeText(await fs.resolve(DEFAULT_POINTER),
          JSON.stringify({ workflow_id: st.workflow_id, state_path: statePath }, null, 2));
        return { workflow_id: st.workflow_id, status: st.status, next: nextAction(st) };
      } },

    { name: 'cad_get_state', description: '读取工作流状态摘要',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        // open_questions：把当前待答提问（id/label/hint/options）直接给模型，避免模型翻源码猜 id。
        return { workflow_id: st.workflow_id, status: st.status, request: st.request,
          answers: st.answers, plan: st.plan, attached_level: st.attached_level,
          approved_level: st.approved_level, latest_intent: latestIntentFile(st),
          delivery: st.delivery, last_error: st.last_error,
          open_questions: openQuestions(st), next: nextAction(st) };
      } },

    { name: 'cad_next_action', description: '返回下一步建议',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        return { status: st.status, open_questions: openQuestions(st), next: nextAction(st) };
      } },

    { name: 'cad_answer_question', description: '回答 intake 或 plan 提问',
      parameters: { workflow_id: { type: 'string' }, id: { type: 'string' , required: true }, value: { type: 'string' , required: true } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const qs = openQuestions(st);
        if (!qs.some(q => q.id === args.id)) {
          throw new Error('UNKNOWN_QUESTION: 可用提问 id：' + qs.map(q => q.id).join(', '));
        }
        const next = answer(st, args.id, args.value);
        await save(ctx, args, next);
        return { id: args.id, value: args.value, all_required: allRequiredAnswered(next, qs) };
      } },

    { name: 'cad_approve_brief', description: '批准需求简报（intake 齐全后）',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (!allRequiredAnswered(st, openQuestions(st))) throw new Error('INTAKE_INCOMPLETE');
        const next = approveBrief(st);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_attach_plan', description: '提交构建计划文本',
      parameters: { workflow_id: { type: 'string' }, plan: { type: 'string' , required: true } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = attachPlan(st, args.plan);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_approve_plan', description: '批准当前 attach 的意图层',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approvePlan(st);
        await save(ctx, args, next);
        return { status: next.status, approved_level: next.approved_level, next: nextAction(next) };
      } },

    { name: 'cad_attach_intent', description: 'attach 一层意图（L0/L1/L2），写 intent JSON 并校验',
      parameters: { workflow_id: { type: 'string' }, level: { type: 'string' , required: true }, intent: { type: 'object', additionalProperties: true, required: true } },
      async execute(ctx, args) {
        // 状态机流程：attachIntent → validateIntent（错误抛 INTENT_INVALID）→ 写 intent 文件 → saveState。
        const st = await needs(ctx, args);
        const next = attachIntent(st, args.level, args.intent);
        // validateIntent 解析为 { errors: [...] } 对象：解包后再做门禁，否则 .length 为 undefined、门禁永不触发。
        const { errors = [] } = await validateIntent(ctx, configStatePath, args.intent);
        if (errors.length > 0) throw new Error('INTENT_INVALID: ' + errors.join('; '));
        await writeIntentFile(ctx, args, next);
        await save(ctx, args, next);
        return { level: args.level, status: next.status, errors, next: nextAction(next) };
      } },

    { name: 'cad_approve_execution', description: '批准执行（要求 L2 已 attach）',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approveExecution(st);
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_generate_code', description: '由 L2 意图生成 build123d 源码',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'approved_for_execution') throw new Error('NEED_APPROVE_EXECUTION: 请先 cad_approve_execution');
        const L2i = st.levels.L2;
        if (!L2i) throw new Error('NO_L2_INTENT');
        const outDir = outDirFor(args);
        const r = await generateSources(ctx, configStatePath, L2i, { outDir });
        if (!r.ok) throw new Error('GENERATE_FAILED: ' + (r.errors || []).join('; '));
        const next = { ...st, status: 'generated', delivery: { ...(st.delivery || {}), written: r.written, out_dir: outDir } };
        await save(ctx, args, next);
        return { ok: true, written: r.written, next: nextAction(next) };
      } },

    { name: 'cad_compile', description: '编译生成 STEP（OCCT 子进程）',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'generated') throw new Error('NEED_GENERATE');
        const L2i = st.levels.L2;
        const outDir = outDirFor(args);
        const r = await compileSources(ctx, configStatePath, L2i, { outDir });
        if (!r.ok) throw new Error('COMPILE_FAILED');
        const next = { ...st, status: 'compiled', delivery: { ...(st.delivery || {}), artifacts: r.artifacts } };
        await save(ctx, args, next);
        return { ok: true, artifacts: r.artifacts, next: nextAction(next) };
      } },

    { name: 'cad_measure', description: '测量一个 STEP 文件（体数/体积/面积/质心/水密）',
      parameters: { workflow_id: { type: 'string' }, step_path: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        // A6 裁定：默认路径 = cad-state/<workflow_id>/assembly.step（STEP 平铺在 out_dir，不在 parts/ 下）。
        const path = args.step_path || resolve(REPO_ROOT, 'cad-state', st.workflow_id, 'assembly.step');
        const r = await measureStep(ctx, configStatePath, path);
        if (!r.ok) throw new Error('MEASURE_FAILED: ' + r.error);
        return { ok: true, measured: r.measured };
      } },

    { name: 'cad_show_step', description: 'compile 成功后把 STEP 交付物显示为 3D 预览（对话内单卡片，重编译原地更新）',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'compiled' && st.status !== 'verified' && st.status !== 'completed') {
          throw new Error('NEED_COMPILE: 请先 cad_compile');
        }
        const L2i = st.levels && st.levels.L2;
        if (!L2i) throw new Error('NO_L2_INTENT');
        const r = await backendOp(ctx, configStatePath, 'manifest',
          { workflow_id: st.workflow_id, intent: L2i }, { outDir: outDirFor(args) });
        if (!r.ok) throw new Error('MANIFEST_FAILED: ' + (r.error || ''));
        return { ok: true, manifest: r.manifest };
      } },

    { name: 'cad_modify', description: '记录修改请求（提示 LLM 更新 L2 后重新 attach）',
      parameters: { workflow_id: { type: 'string' }, instruction: { type: 'string' , required: true }, target: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = { ...st, pending_modification: { instruction: args.instruction, target: args.target, at: new Date().toISOString() } };
        await save(ctx, args, next);
        return { status: 'accepted', note: '已记录修改请求。修改 L2 请用 cad_edit_parameter；已交付工作流请新建（cad_start_workflow）。' };
      } },

    { name: 'cad_edit_parameter', description: '参数化改参（改 L2 意图后需重新生成）',
      parameters: { workflow_id: { type: 'string' }, node_id: { type: 'string' , required: true }, field: { type: 'string' , required: true }, value: { type: 'json', required: true }, profile_index: { type: 'number' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        // 最终审查：改参门禁 — 仅 approved_for_execution / generated / compiled 可改；
        // execution_failed 需先 cad_prepare_retry 确认清理；verified/completed 已交付不可改。
        if (st.status === 'execution_failed') throw new Error('NEED_PREPARE_RETRY: 请先 cad_prepare_retry 确认清理');
        if (st.status === 'verified' || st.status === 'completed') throw new Error('EDIT_NOT_ALLOWED: 工作流已交付；如需改参请新建工作流');
        if (st.status !== 'approved_for_execution' && st.status !== 'generated' && st.status !== 'compiled') {
          throw new Error('EDIT_NOT_ALLOWED: 当前状态 ' + st.status + ' 不可改参');
        }
        if (!st.levels.L2) throw new Error('NO_L2_INTENT');
        const newL2 = setParameter(structuredClone(st.levels.L2), args);
        const next = { ...st, status: 'approved_for_execution', levels: { ...st.levels, L2: newL2 } };
        await save(ctx, args, next);
        return { ok: true, status: next.status, updated: newL2, note: 'L2 已更新并重新武装执行；请 cad_generate_code 重新生成。' };
      } },

    { name: 'cad_verify_execution', description: '对照契约校验 STEP 交付物',
      parameters: { workflow_id: { type: 'string' }, expected: { type: 'object', additionalProperties: true, required: true } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        if (st.status !== 'compiled' && st.status !== 'generated') throw new Error('NEED_COMPILE');
        const artifacts = (st.delivery && st.delivery.artifacts) || [];
        // A12: 装配工作流中 assembly.step 已是包含全部零件的主交付物，
        // 若与零件 .step 一起校验会被后端求和重复计数（体积/面数翻倍），故只校验 assembly.step。
        const step_paths = (artifacts.some(a => a.endsWith('assembly.step'))
          ? artifacts.filter(a => a.endsWith('assembly.step'))
          : artifacts.filter(a => a.endsWith('.step'))).map(a => resolve(REPO_ROOT, a));
        const r = await verifyExecution(ctx, configStatePath, { step_paths, expected: args.expected });
        const next = r.passed && r.verdict === 'PASS'
          ? { ...st, status: 'verified', delivery: { ...(st.delivery || {}), verified: r.measured } }
          : { ...st, status: 'execution_failed', last_error: r.verdict, delivery: { ...(st.delivery || {}), verify_checks: r.checks } };
        await save(ctx, args, next);
        return { passed: r.passed, verdict: r.verdict, checks: r.checks, interference: r.interference, next: nextAction(next) };
      } },

    { name: 'cad_approve_delivery', description: '确认交付',
      parameters: { workflow_id: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = approveDelivery(st, { delivered_at: new Date().toISOString() });
        await save(ctx, args, next);
        return { status: next.status, delivery: next.delivery };
      } },

    { name: 'cad_prepare_retry', description: '失败后清理并回到可执行态',
      parameters: { workflow_id: { type: 'string' }, cleanup_confirmed: { type: 'boolean' , required: true }, reason: { type: 'string' } },
      async execute(ctx, args) {
        const st = await needs(ctx, args);
        const next = prepareRetry(st, args.cleanup_confirmed === true, args.reason || '');
        await save(ctx, args, next);
        return { status: next.status, next: nextAction(next) };
      } },

    { name: 'cad_health_check', description: '后端健康检查（Python/OCP）',
      parameters: {},
      async execute(ctx) { return await healthCheck(ctx, configStatePath); } },

    SIM('cad_simulate_setup'),
    SIM('cad_simulate_run'),
    SIM('cad_simulate_report'),
  ];
  return tools;
}
