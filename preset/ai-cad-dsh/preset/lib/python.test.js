import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPython, BackendError } from './python.js';

const exec = promisify(execFile);

function makeSubprocess() {
  return {
    async spawn(opts) {
      const { argv, stdio, graceMs } = opts;
      const execOpts = { encoding: 'utf8' };
      const stdoutLimit = stdio.stdout.collect.limit;
      const stderrLimit = stdio.stderr.collect.limit;
      let result;
      try {
        result = await exec(argv[0], argv.slice(1), execOpts);
      } catch (e) {
        result = { stdout: e.stdout || '', stderr: e.stderr || String(e.message) };
        result.code = e.code;
      }
      const collected = {
        // 真实 dsh subprocess 契约：readFrom(0) 返回 { text, nextOffset, lossy } 对象。
        stdout: { readFrom: async () => ({ text: (result.stdout || '').slice(0, stdoutLimit), nextOffset: 0, lossy: false }) },
        stderr: { readFrom: async () => ({ text: (result.stderr || '').slice(0, stderrLimit), nextOffset: 0, lossy: false }) },
      };
      return { done: Promise.resolve({ exitCode: result.code === undefined ? 0 : result.code }), collected };
    },
  };
}

const ctx = { get: (s) => s === 'subprocess' ? makeSubprocess() : null };

test('runPython 成功返回 stdout', async () => {
  const out = await runPython(ctx, { argv: ['node', '-e', 'console.log("hi")'], cwd: process.cwd() });
  assert.equal(out.trim(), 'hi');
});

test('runPython 非零退出抛 BackendError(BACKEND_EXIT_*)', async () => {
  await assert.rejects(
    () => runPython(ctx, { argv: ['node', '-e', 'process.exit(3)'], cwd: process.cwd() }),
    (e) => e instanceof BackendError && e.code === 'BACKEND_EXIT_3' && e.exitCode === 3,
  );
});

test('runPython 把 stderr 并入错误消息且截断', async () => {
  await assert.rejects(
    () => runPython(ctx, { argv: ['node', '-e', 'console.error("boom".repeat(5000)); process.exit(1)'], cwd: process.cwd() }),
    (e) => e instanceof BackendError && e.message.length <= 2000 && e.stderr.includes('boom'),
  );
});
