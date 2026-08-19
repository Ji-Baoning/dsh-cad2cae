// preset/ai-cad-dsh/preset/lib/python.js
// DSH subprocess 服务封装：统一超时、收集、错误分类。不关心具体命令。

export class BackendError extends Error {
  constructor(code, message, { exitCode, stderr, stdout } = {}) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export async function runPython(ctx, { argv, cwd, stdoutLimit = 8388608, stderrLimit = 65536, graceMs = 120000 }) {
  const sub = ctx.get('subprocess');
  const handle = await sub.spawn({
    argv,
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { collect: { limit: stdoutLimit } },
      stderr: { collect: { limit: stderrLimit } },
    },
    graceMs,
  });
  const { exitCode } = await handle.done;
  // 真实 dsh subprocess 契约：readFrom(0) 返回 { text, nextOffset, lossy } 对象而非字符串，
  // 必须取 .text（历史 bug：直接当字符串用导致 stdout.slice is not a function）。
  const out = (await handle.collected.stdout.readFrom(0)).text;
  const err = (await handle.collected.stderr.readFrom(0)).text;
  if (exitCode !== 0) {
    const detail = (err || out || '').trim().slice(0, 2000);
    throw new BackendError('BACKEND_EXIT_' + exitCode, detail, { exitCode, stderr: err, stdout: out });
  }
  return out;
}
