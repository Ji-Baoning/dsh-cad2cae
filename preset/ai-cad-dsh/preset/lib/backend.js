// preset/ai-cad-dsh/preset/lib/backend.js
// 后端 CLI 定位与命令构建：把 Plan A/B 包装为子进程 JSON 往返。
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython, BackendError } from './python.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

export function resolveBackend(config) {
  // A4 裁定：本文件位于 preset/ai-cad-dsh/preset/lib/，需 4 级上溯到仓库根，再进 src
  const backendDir = config.backendDir || join(REPO_ROOT, 'src');
  const cli = join(__dirname, '..', 'python', 'backend_cli.py');
  return { backendDir, cli };
}

export async function backendOp(ctx, config, command, payload, opts = {}) {
  const { backendDir, cli } = resolveBackend(config);
  const argv = [
    config.python || 'python3',
    cli,
    '--backend-dir', backendDir,
    command,
    '--payload', JSON.stringify(payload),
  ];
  if (opts.outDir) argv.push('--out-dir', opts.outDir);
  const stdout = await runPython(ctx, {
    argv,
    cwd: opts.cwd || REPO_ROOT,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new BackendError('BACKEND_INVALID_JSON', '后端输出非 JSON：' + stdout.slice(0, 500));
  }
}

export const validateIntent = (ctx, config, intent) => backendOp(ctx, config, 'validate', intent);
export const generateSources = (ctx, config, intent, opts) => backendOp(ctx, config, 'generate', intent, opts);
export const compileSources = (ctx, config, sources, opts) => backendOp(ctx, config, 'compile', sources, opts);
export const measureStep = (ctx, config, stepPath) => backendOp(ctx, config, 'measure', { step_path: stepPath });
export const verifyExecution = (ctx, config, payload) => backendOp(ctx, config, 'verify', payload);
export const healthCheck = (ctx, config) => backendOp(ctx, config, 'health', {});
