#!/usr/bin/env node
// install-dsh-preset.mjs
// 把本仓库的 AI-CAD 预设安装进 DSH 本地预设根（默认 ~/.dsh/.agent-presets/），
// 并自动改写已装副本 agent.cordis.yml 的 backendDir 指向本仓库 src/ 绝对路径。
// 另自动在已装副本建立 node_modules/@deepseek-ai/{dsh-tools,schemastery} 符号链接，
// 指向 harness 安装内的同名包——插件入口 import '@deepseek-ai/dsh-tools' 走 Node
// 原生解析、需沿插件文件位置向上找到 node_modules，否则无法挂载（"Cannot find package"）。
// 零依赖：仅用 node 内置模块，跨平台（Windows / Linux / macOS）。
//
// 用法：
//   node install-dsh-preset.mjs             幂等安装（已就绪则提示并退出 0）
//   node install-dsh-preset.mjs --force     删除已装目录后全新复制
//   node install-dsh-preset.mjs --id <id>   自定义预设 id（默认 ai-cad）
//   node install-dsh-preset.mjs --dry-run   只打印将要做什么，不写盘
//   node install-dsh-preset.mjs --help
//
// DSH home 解析顺序与 dsh-home-paths 一致：$DSH_HOME（非空白）优先，否则 ~/.dsh。

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = join(REPO_ROOT, 'preset', 'ai-cad-dsh', 'preset');
const DEFAULT_ID = 'ai-cad';
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/;
const USER_PRESET_DIR = '.agent-presets';
const COMPOSITION = 'agent.cordis.yml';
const METADATA = 'preset.yml';
const PLUGIN = 'ai-cad-plugin.js';

// ── 路径解析（纯函数，便于测试）──────────────────────────────

export function resolveDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.dsh');
}

export const presetSourceDir = (repo = REPO_ROOT) => join(repo, 'preset', 'ai-cad-dsh', 'preset');
export const presetTargetDir = (home, id) => join(home, USER_PRESET_DIR, id);
export const backendDirValue = (repo = REPO_ROOT) => join(repo, 'src').replace(/\\/g, '/');

// ── 复制（排除测试 / 缓存文件）───────────────────────────────

/** 相对路径判定：排除 pycache、pyc、node 测试文件、lib/test。 */
function shouldInclude(srcRoot, path) {
  const rel = relativePosix(srcRoot, path);
  if (rel === '') return true;
  if (rel === '__pycache__' || rel.startsWith('__pycache__/')) return false;
  if (rel.endsWith('.pyc')) return false;
  if (rel.endsWith('.test.js')) return false;
  if (rel === 'lib/test' || rel.startsWith('lib/test/')) return false;
  return true;
}

function relativePosix(from, to) {
  return relative(from, to).replace(/\\/g, '/');
}

export async function copyPreset(src, dst, base = src) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (!shouldInclude(base, s)) continue;
    if (entry.isDirectory()) await copyPreset(s, d, base);
    else if (entry.isFile()) await fs.copyFile(s, d);
  }
}

// ── harness 依赖（node_modules 符号链接）────────────────────────

const HARNESS_DEPS = ['dsh-tools', 'schemastery'];

/** 判断路径是否为目录。 */
async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 在 PATH 上定位 dsh 可执行文件，向上回溯找到含 node_modules/@deepseek-ai/
 * {dsh-tools,schemastery} 的 dsh 包根，返回两个包的绝对目录；找不到返回 null。
 * 跨平台：Windows 找 dsh.exe、PATH 分隔符用 ';'。
 */
export async function resolveHarnessDeps(env = process.env) {
  const win = process.platform === 'win32';
  const binName = win ? 'dsh.exe' : 'dsh';
  const pathEnv = (env.PATH || '').split(win ? ';' : ':');
  for (const dir of pathEnv) {
    if (!dir) continue;
    let bin;
    try {
      bin = await fs.realpath(join(dir, binName));
    } catch {
      continue; // 该目录下没有 dsh
    }
    // 从真实 bin 文件位置向上回溯（最多 8 层），找 node_modules/@deepseek-ai/dsh-tools
    let cur = dirname(bin);
    for (let i = 0; i < 8; i++) {
      const scope = join(cur, 'node_modules', '@deepseek-ai');
      if (await isDir(join(scope, 'dsh-tools')) && await isDir(join(scope, 'schemastery'))) {
        const deps = {};
        for (const name of HARNESS_DEPS) deps[name] = join(scope, name);
        return deps;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return null;
}

/** 幂等地把已装副本的 node_modules/@deepseek-ai/<pkg> 建为指向 harness 包的符号链接。 */
async function linkHarnessDeps(target, deps) {
  const scope = join(target, 'node_modules', '@deepseek-ai');
  await fs.mkdir(scope, { recursive: true });
  for (const name of HARNESS_DEPS) {
    const link = join(scope, name);
    const real = deps[name];
    let existed = false;
    try {
      const st = await fs.lstat(link);
      existed = true;
      if (st.isSymbolicLink()) {
        if (await fs.realpath(link) === real) continue; // 已指向正确目标
        await fs.unlink(link);
      } else {
        throw new Error(`已存在且不是符号链接，拒绝覆盖：${link}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existed) console.log(`node_modules/@deepseek-ai/${name} 已指向他处，已重链 → ${real}`);
    await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

/** 在已装副本建立 harness 依赖链接；找不到 dsh 时给出可操作提示但不中断安装。 */
async function installDeps(target, deps) {
  if (!deps) {
    console.log('[警告] 未在 PATH 找到 dsh harness，已装副本将缺少 node_modules 链接，选择 AI-CAD 会失败。');
    console.log('        修复：安装 dsh 后重跑本脚本（幂等自愈），或在已装目录下执行：');
    console.log(`        mkdir -p "${join(target, 'node_modules', '@deepseek-ai')}"`);
    console.log(`        ln -s <dsh 包根>/node_modules/@deepseek-ai/dsh-tools   "${join(target, 'node_modules', '@deepseek-ai')}/dsh-tools"`);
    console.log(`        ln -s <dsh 包根>/node_modules/@deepseek-ai/schemastery "${join(target, 'node_modules', '@deepseek-ai')}/schemastery"`);
    return;
  }
  await linkHarnessDeps(target, deps);
}

// ── agent.cordis.yml 改写（零依赖 YAML 的行级编辑）────────────

/** YAML 单引号字符串：路径转正斜杠，' 翻倍转义。 */
function yamlQuote(value) {
  return `'${value.replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

/** 定位 ai-cad-skill 顶层块 [start, end) 的行号区间；找不到抛错。 */
function locateSkillBlock(lines) {
  const start = lines.findIndex((line) => /^- id: ai-cad-skill\s*$/.test(line));
  if (start === -1) {
    throw new Error(`找不到顶层 "- id: ai-cad-skill" 行——preset 配方已变化，请同步本脚本`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- id:\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [start, end];
}

/** 读取 ai-cad-skill 块内的 backendDir 现值；无则返回 undefined。 */
export function readCompositionBackendDir(text) {
  const lines = text.split(/\r?\n/);
  const [start, end] = locateSkillBlock(lines);
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^\s*backendDir:\s*(.*)$/);
    if (m) return parseYamlScalar(m[1]);
  }
  return undefined;
}

function parseYamlScalar(raw) {
  const v = raw.trim();
  if (v.startsWith("'")) {
    const body = v.endsWith("'") ? v.slice(1, -1) : v.slice(1);
    return body.replace(/''/g, "'");
  }
  if (v.startsWith('"')) {
    return v.endsWith('"') ? v.slice(1, -1) : v.slice(1);
  }
  return v;
}

/** 把 ai-cad-skill 块的 backendDir 改写为给定绝对路径，返回新全文。 */
export function editComposition(text, backendDir) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const [start, end] = locateSkillBlock(lines);
  const block = lines.slice(start, end);
  const target = yamlQuote(backendDir);

  const row = block.findIndex((line) => /^\s*backendDir:/.test(line));
  if (row !== -1) {
    const indent = (block[row].match(/^(\s*)/) ?? ['', ''])[1];
    block[row] = `${indent}backendDir: ${target}`;
  } else {
    // 块内无 backendDir：插在 python:（或 skillDir:）行后，缩进沿用配置键
    let anchor = block.findIndex((line) => /^\s*python:/.test(line));
    if (anchor === -1) anchor = block.findIndex((line) => /^\s*skillDir:/.test(line));
    let indent = '    ';
    if (anchor === -1) {
      anchor = block.length - 1;
    } else {
      indent = (block[anchor].match(/^(\s*)/) ?? ['', ''])[1];
    }
    block.splice(anchor + 1, 0, `${indent}backendDir: ${target}`);
  }

  lines.splice(start, end - start, ...block);
  return lines.join(eol);
}

// ── 前置校验与 CLI ───────────────────────────────────────────

async function requireFile(dir, name) {
  try {
    const st = await fs.stat(join(dir, name));
    if (!st.isFile()) throw new Error('不是普通文件');
  } catch (error) {
    throw new Error(`仓库预设结构不完整：缺少 ${join(dir, name)}（${error.message}）`);
  }
}

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { id: DEFAULT_ID, force: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--force': opts.force = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      case '--id':
        i++;
        if (i >= argv.length) throw new UsageError('--id 需要一个值');
        opts.id = argv[i];
        break;
      default:
        throw new UsageError(`未知参数：${argv[i]}（用 --help 查看用法）`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`AI-CAD DSH 预设安装脚本

用法：
  node install-dsh-preset.mjs [选项]

选项：
  --id <id>      自定义预设 id（默认 ${DEFAULT_ID}，须匹配 ${PRESET_ID}）
  --force        目标已存在时删除后全新复制（默认幂等）
  --dry-run      只打印将执行的动作，不写盘
  --help         显示本帮助

说明：
  · 把 preset/ai-cad-dsh/preset/ 安装到 DSH 本地预设根
    （\${DSH_HOME:-~/.dsh}/.agent-presets/<id>/）。
  · 自动改写已装副本 agent.cordis.yml 的 backendDir 为本仓库 src/ 绝对路径。
  · 自动把已装副本 node_modules/@deepseek-ai/{dsh-tools,schemastery} 链接到
    harness 安装内的同名包（插件 import 需要）；找不到 dsh 时给出手动修复提示。
  · 仓库源文件保持原样（不改动）；复制时排除测试与缓存文件。`);
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (!PRESET_ID.test(opts.id)) {
    throw new UsageError(`预设 id "${opts.id}" 非法：须匹配 ${PRESET_ID}（小写字母开头，可含数字与中划线）`);
  }

  const home = resolveDshHome();
  const source = presetSourceDir();
  const target = presetTargetDir(home, opts.id);
  const backend = backendDirValue();

  await requireFile(source, METADATA);
  await requireFile(source, COMPOSITION);
  await requireFile(source, PLUGIN);

  // 定位 harness 依赖（dsh-tools/schemastery），供已装副本建 node_modules 链接
  const deps = await resolveHarnessDeps();
  const depsLabel = deps
    ? `将建立 node_modules/@deepseek-ai/{dsh-tools,schemastery} 链接 → ${dirname(deps['dsh-tools'])}`
    : '未找到 dsh harness（将跳过 node_modules 链接，并给出手动修复提示）';

  let state;
  try {
    const comp = await fs.readFile(join(target, COMPOSITION), 'utf8');
    const current = readCompositionBackendDir(comp);
    state = current === undefined
      ? 'needs-fix'
      : normalizePath(current) === normalizePath(backend) ? 'ready' : 'needs-fix';
  } catch {
    state = 'absent';
  }
  const stateLabel = { absent: '未安装', ready: '已就绪', 'needs-fix': 'backendDir 过时或缺失' }[state];
  const action = opts.force
    ? '强制重装（删除后复制）'
    : state === 'absent' ? '全新安装' : state === 'ready' ? '无需改动（确保依赖链接存在）' : '改写副本 backendDir';

  if (opts.dryRun) {
    console.log(`[dry-run] 预设 id：${opts.id}`);
    console.log(`[dry-run] 源目录：${source}`);
    console.log(`[dry-run] 目标目录：${target}`);
    console.log(`[dry-run] backendDir：${backend}`);
    console.log(`[dry-run] node_modules：${depsLabel}`);
    console.log(`[dry-run] 当前状态：${stateLabel}`);
    console.log(`[dry-run] 动作：${action}`);
    return 0;
  }

  if (state === 'absent') {
    await fs.mkdir(join(home, USER_PRESET_DIR), { recursive: true });
    await copyPreset(source, target);
    await rewriteBackendDir(target, backend);
    await installDeps(target, deps);
    console.log(`已安装到 ${target}`);
  } else if (opts.force) {
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(join(home, USER_PRESET_DIR), { recursive: true });
    await copyPreset(source, target);
    await rewriteBackendDir(target, backend);
    await installDeps(target, deps);
    console.log(`已删除旧目录并重装到 ${target}`);
  } else if (state === 'needs-fix') {
    await rewriteBackendDir(target, backend);
    await installDeps(target, deps);
    console.log(`目标已存在，backendDir 已更新为 ${backend}`);
  } else {
    // 已就绪：也确保依赖链接存在（自愈——用户可能手动删过 node_modules）
    await installDeps(target, deps);
    console.log(`已就绪（backendDir 已指向 ${backend}）`);
  }

  console.log('────────────────────────────────');
  console.log(`预设：AI-CAD（id: ${opts.id}）`);
  console.log(`位置：${target}`);
  console.log(`backendDir：${backend}`);
  console.log(`node_modules：${deps ? '已链接 harness 依赖（dsh-tools/schemastery）' : '未链接（见上方警告）'}`);
  console.log('DSH 中：新会话选择 AI-CAD 即可使用 22 个 cad_* 工具。');
  console.log('提示：若 dsh web 已运行过失败导入，请重启 dsh web 后再选择 AI-CAD。');
  console.log(`卸载：rm -rf ${target}`);
  return 0;
}

async function rewriteBackendDir(target, backend) {
  const comp = await fs.readFile(join(target, COMPOSITION), 'utf8');
  const rewritten = editComposition(comp, backend);
  if (rewritten !== comp) {
    await fs.writeFile(join(target, COMPOSITION), rewritten, 'utf8');
  }
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

// 仅直接运行本文件时执行安装；被测试 import 时不触发副作用。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof UsageError) {
        console.error(`[install-dsh-preset] ${error.message}`);
        console.error('用法：node install-dsh-preset.mjs [--id <id>] [--force] [--dry-run]');
        process.exitCode = 2;
      } else {
        console.error(`[install-dsh-preset] 安装失败：${error.message}`);
        process.exitCode = 1;
      }
    });
}
