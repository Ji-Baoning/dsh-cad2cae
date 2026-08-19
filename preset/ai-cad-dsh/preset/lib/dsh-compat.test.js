// preset/ai-cad-dsh/preset/lib/dsh-compat.test.js
// 回归测试：DSH 挂载兼容性——防止三个历史 bug 复发：
//   1) 插件入口 import '@deepseek-ai/dsh-tools' 缺 node_modules（安装脚本负责建链接）；
//   2) schemastery 用命名导入 { z }（其 ESM 入口只导出默认值，必须 import z from）；
//   3) 工具 parameters 写成原始 JSON Schema 包裹式 {type:'object',properties,required:[]}，
//      而 dsh-tools defineTool 要求"属性映射"格式 {参数名:{type, required:true}}，
//      且每个 type:'object' 节点必须显式 additionalProperties:true/false。
// 本文件零依赖（不 import @deepseek-ai，可用 node --test 直接运行）；
// 另含一个"找到 harness 则跑真实 defineTool、否则跳过"的可选集成测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTools } from './tools.js';
import { newState, answer, approveBrief, attachPlan, saveState } from './state.js';
import { INTAKE_QUESTIONS } from './questions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_SRC = join(__dirname, '..', 'ai-cad-plugin.js');

// dsh-tools defineTool 作者编译支持的 type 集合（含 author-only 的 json）
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object', 'json']);
const OBJECT_ONLY_KEYS = ['additionalProperties', 'properties', 'required'];

/** 断言一个"值 schema"节点符合 dsh 作者编译规则。 */
function assertValueSchema(node, path) {
  assert.ok(node && typeof node === 'object' && !Array.isArray(node), `${path} 必须是 schema 对象`);
  if (node.oneOf !== undefined) {
    assert.ok(Array.isArray(node.oneOf) && node.oneOf.length >= 2, `${path}.oneOf 必须是至少两个 schema 的数组`);
    node.oneOf.forEach((branch, i) => assertValueSchema(branch, `${path}.oneOf[${i}]`));
    return;
  }
  const type = node.type;
  assert.ok(typeof type === 'string' && SCHEMA_TYPES.has(type),
    `${path}.type 必须为 ${[...SCHEMA_TYPES].join('/')} 之一（当前：${JSON.stringify(type)}；旧包裹式或 {} 均会被拒）`);
  if (node.required !== undefined) {
    assert.equal(node.required, true, `${path}.required 必须为 true（dsh 属性映射用每属性 required:true，不是顶层数组）`);
  }
  switch (type) {
    case 'object':
      assert.equal(typeof node.additionalProperties, 'boolean',
        `${path}.additionalProperties 必须显式为 true/false（dsh defineTool 强制要求）`);
      if (node.properties !== undefined) {
        assert.ok(node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties),
          `${path}.properties 必须是 schema 映射`);
        for (const [name, child] of Object.entries(node.properties)) assertValueSchema(child, `${path}.properties.${name}`);
      }
      break;
    case 'array':
      if (node.items !== undefined) assertValueSchema(node.items, `${path}.items`);
      break;
    default:
      break;
  }
}

/** 断言工具的 parameters 是 dsh 属性映射格式（不是原始 JSON Schema 包裹式）。 */
function assertParameterMap(params, path) {
  assert.ok(params && typeof params === 'object' && !Array.isArray(params),
    `${path} 必须是属性映射对象 {参数名: schema}`);
  // 旧包裹式 {type:'object', properties:{...}, required:[...]} 的任何顶层痕迹都判失败
  for (const banned of [...OBJECT_ONLY_KEYS, 'items', 'oneOf', 'enum', 'const']) {
    assert.equal(params[banned], undefined,
      `${path} 不应有顶层 ${banned}（旧包裹式残留；dsh defineTool 会把 parameters 当属性映射编译）`);
  }
  for (const [name, schema] of Object.entries(params)) assertValueSchema(schema, `${path}.${name}`);
}

test('22 个工具 parameters 全部符合 dsh defineTool 属性映射格式', () => {
  const tools = makeTools({ python: 'python3' });
  assert.equal(tools.length, 22);
  for (const tool of tools) assertParameterMap(tool.parameters, `${tool.name}.parameters`);
});

test('插件入口 schemastery 使用默认导入（import z from，非命名导入 { z }）', async () => {
  const src = await readFile(PLUGIN_SRC, 'utf8');
  assert.match(src, /^import\s+z\s+from\s+'@deepseek-ai\/schemastery';/m,
    'schemastery ESM 入口只导出默认值，必须 import z from（历史 bug 2）');
  assert.doesNotMatch(src, /import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*'@deepseek-ai\/schemastery'/,
    '禁止 import { z } from @deepseek-ai/schemastery');
  assert.match(src, /import\s*\{[^}]*\bdefineTool\b[^}]*\}\s*from\s*'@deepseek-ai\/dsh-tools';/,
    'dsh-tools 需命名导入 defineTool');
});

test('插件入口 output.render 返回内容块而非空串（历史 bug：render() return \'\' 使模型看不到工具结果）', async () => {
  const src = await readFile(PLUGIN_SRC, 'utf8');
  // dsh-tools createSuccessResult 把 output.render 的返回值作为 tool-result 内容；
  // 无条件返回空串 = 模型永远看不到工具返回（session 里 tool-result content: ""）。
  assert.doesNotMatch(src, /render\s*\(\s*\)\s*\{[^}]*return\s*''\s*;?\s*\}/,
    'render 不得无条件返回空串');
  assert.match(src, /render\(\s*_?args[^)]*\)\s*\{\s*return\s*\[\s*\{\s*type:\s*['"]text['"]/,
    'render 应返回 [{ type: "text", text }] 内容块（wlj 参照插件同款）');
});

test('（可选）真实 dsh-tools defineTool 编译全部 22 个工具；找不到 harness 则跳过', async (t) => {
  const { resolveHarnessDeps } = await import('../../../../install-dsh-preset.mjs');
  const deps = await resolveHarnessDeps();
  if (!deps) {
    t.skip('未找到 dsh harness，跳过真实 defineTool 集成测试');
    return;
  }
  const { defineTool } = await import(pathToFileURL(join(deps['dsh-tools'], 'lib', 'index.js')).href);
  const tools = makeTools({ python: 'python3' });
  for (const tool of tools) {
    assert.doesNotThrow(() => defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: { schema: { type: 'string' }, render() { return ''; } },
      async execute() { return ''; },
    }), `${tool.name} 必须能被真实 dsh-tools defineTool 编译`);
  }
});

// ── 运行时契约回归（修复两个真实挂载后报错）──────────────────────────────
// 挂载成功后 dsh web 里报过两个运行时错：
//   cad_health_check  → stdout.slice is not a function（runPython 未取 readFrom().text）
//   cad_start_workflow → Cannot read properties of undefined (reading 'trim')
//                      （fs.writeText 直传字符串路径，未先 fs.resolve 得 target 对象）
// 根因是测试 mock 契约太宽松（resolve 返字符串、readFrom 直接返字符串），把两个 bug 都放过了。
// 下面用"严格 dsh 契约"stub 直接执行工具：resolve 必须返回 { targetKey, displayPath }、
// writeText/readText 只收 target 对象、readFrom 返回 { text }。零依赖、无条件运行。

function makeStrictDshCtx() {
  const store = new Map();
  const fs = {
    async resolve(p) {
      const targetKey = '/ws/' + String(p).replace(/^[/\\]+/, '');
      return { targetKey, displayPath: targetKey };
    },
    async writeText(target, content) {
      if (!target || typeof target.targetKey !== 'string') {
        throw new TypeError('fs.writeText 需要 resolve() 后的 target 对象（真实 dsh 契约）');
      }
      store.set(target.targetKey, content);
    },
    async readText(target) {
      if (!target || typeof target.targetKey !== 'string') {
        throw new TypeError('fs.readText 需要 resolve() 后的 target 对象（真实 dsh 契约）');
      }
      const text = store.get(target.targetKey);
      if (text === undefined) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      return text;
    },
    processPath: (t) => t && t.targetKey,
  };
  const subprocess = {
    async spawn() {
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: async () => ({ text: JSON.stringify({ ok: true, errors: [] }), nextOffset: 0, lossy: false }) },
          stderr: { readFrom: async () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
      };
    },
  };
  return { get: (s) => s === 'fs' ? fs : s === 'subprocess' ? subprocess : null, fs };
}

test('运行时契约：cad_start_workflow / cad_health_check / cad_attach_intent 在严格 dsh 契约下可执行', async () => {
  const ctx = makeStrictDshCtx();
  const tools = Object.fromEntries(makeTools({ python: 'python3' }).map(t => [t.name, t]));

  // 历史 bug：cad_start_workflow 直传字符串给 writeText → 严格 stub 应抛 TypeError。
  const started = await tools.cad_start_workflow.execute(ctx, { request: '生成一个支架' });
  assert.equal(typeof started.workflow_id, 'string');
  const pointer = JSON.parse(await ctx.fs.readText(await ctx.fs.resolve('cad-state/current.json')));
  assert.equal(pointer.workflow_id, started.workflow_id);

  // 历史 bug：runPython 未取 readFrom().text → stdout 是对象，health JSON.parse 必挂。
  const health = await tools.cad_health_check.execute(ctx);
  assert.equal(health.ok, true);

  // writeIntentFile 同款契约：推进到 plan_attached 并落盘后 attach L0，intent 文件应已写入。
  let st = newState('生成一个支架', { workflow_id: started.workflow_id });
  for (const q of INTAKE_QUESTIONS) {
    st = answer(st, q.id, q.id === 'units' ? 'meters' : q.id === 'feature_scope_check' ? 'yes' : 'sample');
  }
  st = approveBrief(st);
  st = attachPlan(st, '构建计划：单件支架');
  await saveState(ctx.fs, `cad-state/${started.workflow_id}/state.json`, st);
  const intent = {
    schema_version: 2, units: 'meters', parts: [
      { id: 'p1', type: 'sketch', ref: { datum: 'front' }, profile: [{ kind: 'rectangle', width: 0.1, height: 0.05 }] },
    ],
  };
  const attached = await tools.cad_attach_intent.execute(ctx, { workflow_id: started.workflow_id, level: 'L0', intent });
  assert.equal(attached.level, 'L0');
  const intentText = await ctx.fs.readText(await ctx.fs.resolve(`cad-state/${started.workflow_id}/intent-L0.json`));
  assert.ok(intentText.includes('rectangle'), 'intent 文件应经 resolve 写入（历史 bug 2 复发会直接抛错）');
});
