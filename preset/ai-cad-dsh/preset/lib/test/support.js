// preset/ai-cad-dsh/preset/lib/test/support.js
// 测试支撑：temp-dir fs + 真实 execFile subprocess + 层级意图夹具（A9 裁定版）。
//
// 关键约定（A11/A6 裁定后）：tools.js 内所有 cad-state 路径都以 REPO_ROOT 绝对路径形式出现
// （如 resolve(REPO_ROOT, 'cad-state', <id>, 'state.json')）。本 mock 的 fs 把以 REPO_ROOT
// 为前缀的绝对路径重映射到 baseDir（临时目录），使全部文件操作在 temp 内完成、绝不触碰真实仓库，
// 同时保持与生产路径语义一致；相对路径（如 DEFAULT_POINTER 'cad-state/current.json'）也落在 baseDir 下。
// 另外在 ctx 上注入 baseDir，供 writeState 使用（tools.test.js 直接把"已答 intake 的 state"传入
// writeState 第二个参数，见下）。
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { INTAKE_QUESTIONS } from '../questions.js';
import { newState, answer } from '../state.js';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
// 本文件位于 preset/ai-cad-dsh/preset/lib/test/，5 级上溯 = 仓库根（与 tools.js 的 4 级上溯同一目录）。
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

export function tempBase() {
  const dir = mkdtempSync(join(tmpdir(), 'cad-dsh-'));
  writeFileSync(join(dir, '.keep'), '');
  return realpathSync(dir);
}

export function makeCtx({ baseDir, python }) {
  // 统一映射：REPO_ROOT 绝对路径 → baseDir 相对；其余路径 → baseDir 下。所有 fs 方法都过这一层，
  // 因此调用方无论传原始绝对路径还是已 resolve 的路径，读写都落在临时目录。
  const map = (p) => {
    const rel = typeof p === 'string' && p.startsWith(REPO_ROOT)
      ? p.slice(REPO_ROOT.length).replace(/^[/\\]+/, '')
      : p;
    return resolve(baseDir, rel);
  };
  const fs = {
    resolve: (p) => map(p),
    async stat(p) {
      try {
        const s = await import('node:fs/promises').then(m => m.stat(map(p)));
        return { size: s.size };
      } catch {
        return null;
      }
    },
    async readText(p) { return readFileSync(map(p), 'utf8'); },
    async writeText(p, text) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(dirname(map(p)), { recursive: true });
      writeFileSync(map(p), text, 'utf8');
    },
    processPath: (p) => p,
  };
  const subprocess = {
    async spawn(opts) {
      const { argv, stdio } = opts;
      const stdoutLimit = stdio.stdout.collect.limit;
      const stderrLimit = stdio.stderr.collect.limit;
      let result;
      try {
        result = await exec(argv[0], argv.slice(1), { encoding: 'utf8' });
        result.code = 0;
      } catch (e) {
        result = { stdout: e.stdout || '', stderr: e.stderr || String(e.message), code: e.code };
      }
      const collected = {
        stdout: { readFrom: async () => (result.stdout || '').slice(0, stdoutLimit) },
        stderr: { readFrom: async () => (result.stderr || '').slice(0, stderrLimit) },
      };
      return { done: Promise.resolve({ exitCode: result.code }), collected };
    },
  };
  return { get: (s) => s === 'fs' ? fs : s === 'subprocess' ? subprocess : null, python, baseDir };
}

// 把 state 写入 <baseDir>/cad-state/<workflow_id>/state.json，与工具的 loadState 路径（REPO_ROOT
// 重映射后）完全一致。第二个参数按接口为 baseDir；tools.test.js 直接传入"已答 intake 的 state"
// （其携带 workflow_id），故目录统一取 ctx.baseDir（makeCtx 注入），state 取第三个参数。
export async function writeState(ctx, base, state) {
  const dir = ctx.baseDir || (typeof base === 'string' ? base : tempBase());
  await ctx.get('fs').writeText(
    join(dir, 'cad-state', state.workflow_id, 'state.json'),
    JSON.stringify(state, null, 2),
  );
}

export function answersFor() {
  return Object.fromEntries(INTAKE_QUESTIONS.map(q => [q.id, q.id === 'units' ? 'meters' : q.id === 'feature_scope_check' ? 'yes' : 'sample']));
}

export function answeredIntake(workflowId) {
  return INTAKE_QUESTIONS.reduce((s, q) => answer(s, q.id, q.id === 'units' ? 'meters' : q.id === 'feature_scope_check' ? 'yes' : 'sample'),
    newState('制造一个铰链装配', { workflow_id: workflowId }));
}

// ── 层级意图夹具（A9 裁定：Plan A/B 数组形式，已实测 validate+generate+compile+OCCT 测量全链路通过）──
// parts 是节点数组（sketch/extrude 平铺，链内 sketch 紧跟 extrude）；模块名 = component 的 part_ref；
// revolute 双侧锚点必须 cylinder；L2 过孔切必须作为 post 链末节点（part_ref 指向链末节点 pn2）。
export const SKETCH_HUB = { id: 'hs1', type: 'sketch', ref: { datum: 'front' },
  profile: [{ kind: 'circle', diameter: 0.06 }] };
export const SKETCH_POST = { id: 'ps1', type: 'sketch', ref: { datum: 'front' },
  profile: [{ kind: 'circle', diameter: 0.04 }] };
export const L0 = { schema_version: 2, units: 'meters', parts: [SKETCH_HUB, SKETCH_POST] };
export const L1 = { schema_version: 2, units: 'meters', ground: 'hn1',
  parts: [
    SKETCH_HUB,
    { id: 'hn1', type: 'extrude', sketch: 'hs1', operation: 'boss', end: 'blind', depth: 0.08 },
    SKETCH_POST,
    { id: 'pn1', type: 'extrude', sketch: 'ps1', operation: 'boss', end: 'blind', depth: 0.02 },
  ],
  assembly: {
    components: [{ id: 'c1', part_ref: 'hn1' }, { id: 'c2', part_ref: 'pn1' }],
    connections: [{ id: 'J1', type: 'kinematic', joint: 'revolute',
      contact: [{ part: 'c1', anchor: { kind: 'cylinder', near: [0.03, 0, 0] } },
                { part: 'c2', anchor: { kind: 'cylinder', near: [0.02, 0, 0.01] } }],
      direction: { axis: [0, 0, 1], rotation: true, translation: false } }],
  } };
export const L2 = structuredClone(L1);
L2.parts.push({ id: 'ps2', type: 'sketch', ref: { datum: 'front' }, profile: [{ kind: 'circle', diameter: 0.02 }] });
L2.parts.push({ id: 'pn2', type: 'extrude', sketch: 'ps2', operation: 'cut', end: 'through_all' });
L2.assembly.components = [{ id: 'c1', part_ref: 'hn1' }, { id: 'c2', part_ref: 'pn2' }];
