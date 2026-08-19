// preset/ai-cad-dsh/preset/lib/backend.test.js
// 最终审查：固定 backend.js 的接缝 — 后端 CLI 定位、argv 组装、cwd、非 JSON 报错。
// 不依赖 Python：用 canned-output 假 subprocess 捕获 argv/cwd。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { resolveBackend, validateIntent, compileSources } from './backend.js';
import { BackendError } from './python.js';

// 本文件位于 preset/ai-cad-dsh/preset/lib/，4 级上溯 = 仓库根（与 backend.js 的 REPO_ROOT 同目录）。
const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');

// canned-output 假 subprocess：记录每次 spawn 的 argv/cwd，stdout 返回固定内容。
// readFrom 返回真实 dsh 契约的 { text, nextOffset, lossy } 对象（历史 bug：runPython 未取 .text）。
function makeCapturingSubprocess(stdout = '{}') {
  const calls = [];
  return {
    calls,
    async spawn(opts) {
      calls.push({ argv: opts.argv, cwd: opts.cwd });
      const collected = {
        stdout: { readFrom: async () => ({ text: stdout, nextOffset: 0, lossy: false }) },
        stderr: { readFrom: async () => ({ text: '', nextOffset: 0, lossy: false }) },
      };
      return { done: Promise.resolve({ exitCode: 0 }), collected };
    },
  };
}

const ctxFor = (sub) => ({ get: (s) => s === 'subprocess' ? sub : null });

test('resolveBackend 定位 backendDir 与 CLI（默认配置）', () => {
  const { backendDir, cli } = resolveBackend({});
  assert.equal(backendDir, resolve(REPO, 'src'));
  assert.equal(cli, resolve(REPO, 'preset/ai-cad-dsh/preset/python/backend_cli.py'));
});

test('validateIntent 组装 argv、cwd=仓库根，并解析返回对象', async () => {
  const sub = makeCapturingSubprocess(JSON.stringify({ errors: [] }));
  const payload = { schema_version: 2, units: 'meters', parts: [] };
  const out = await validateIntent(ctxFor(sub), { python: 'python3' }, payload);
  assert.deepEqual(out, { errors: [] });
  assert.equal(sub.calls.length, 1);
  const { argv, cwd } = sub.calls[0];
  assert.deepEqual(argv, [
    'python3',
    resolve(REPO, 'preset/ai-cad-dsh/preset/python/backend_cli.py'),
    '--backend-dir', resolve(REPO, 'src'),
    'validate',
    '--payload', JSON.stringify(payload),
  ]);
  assert.equal(cwd, REPO);
});

test('compileSources 追加 --out-dir', async () => {
  const sub = makeCapturingSubprocess(JSON.stringify({ ok: true, artifacts: [] }));
  const out = await compileSources(ctxFor(sub), { python: 'py' }, { sources: [] }, { outDir: '/tmp/cad-out' });
  assert.deepEqual(out, { ok: true, artifacts: [] });
  const { argv } = sub.calls[0];
  assert.equal(argv[argv.length - 2], '--out-dir');
  assert.equal(argv[argv.length - 1], '/tmp/cad-out');
});

test('后端输出非 JSON 抛 BackendError(BACKEND_INVALID_JSON)', async () => {
  const sub = makeCapturingSubprocess('not json at all');
  await assert.rejects(
    () => validateIntent(ctxFor(sub), {}, { schema_version: 2 }),
    (e) => e instanceof BackendError && e.code === 'BACKEND_INVALID_JSON',
  );
});
