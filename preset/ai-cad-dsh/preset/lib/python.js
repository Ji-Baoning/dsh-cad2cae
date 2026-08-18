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
  const stdout = await handle.collected.stdout.readFrom(0);
  const stderr = await handle.collected.stderr.readFrom(0);
  if (exitCode !== 0) {
    const detail = (stderr || stdout || '').trim().slice(0, 2000);
    throw new BackendError('BACKEND_EXIT_' + exitCode, detail, { exitCode, stderr, stdout });
  }
  return stdout;
}
