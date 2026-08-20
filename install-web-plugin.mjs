#!/usr/bin/env node
// install-web-plugin.mjs
// 把 preset/ai-cad-dsh/web 的客户端插件（3D 预览卡片，Plan B）装进 DSH web profile：
//   1) 构建 web 包（npm run build 等价物；dist/client.js 已存在则跳过）；
//   2) 在 ${DSH_HOME:-~/.dsh}/profiles/web/node_modules/@ai-cad/ 下建指向仓库 web 包的
//      符号链接——loader 的 require.resolve('<pkg>/package.json') 需要它能被解析；
//   3) 向 profiles/web/cordis.patch.yml 追加 `- insert:` 条目（幂等，id=cad3d-preview）。
// 零依赖、幂等、失败响亮报错，与 install-dsh-preset.mjs 同风格。
//
// 用法：
//   node install-web-plugin.mjs             幂等安装到 DSH web profile
//   node install-web-plugin.mjs --force     重构建 + 重链 + 重写 patch
//   node install-web-plugin.mjs --skip-build 跳过构建（只做链接 + patch）
//   node install-web-plugin.mjs --dry-run   只打印路径，不写盘
//   node install-web-plugin.mjs --self-test 纯函数幂等自检（不经 parseArgs）
//   node install-web-plugin.mjs --help

import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDshHome } from './install-dsh-preset.mjs';

export const WEB_PKG_NAME = '@ai-cad/cad3d-preview';
export const WEB_ENTRY_ID = 'cad3d-preview';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));
export const webPackageDir = () => join(repoRoot, 'preset', 'ai-cad-dsh', 'web');
export const webProfileDir = (home) => join(home, 'profiles', 'web');
export const webPluginLink = (home) => join(webProfileDir(home), 'node_modules', '@ai-cad', 'cad3d-preview');
export const webPatchPath = (home) => join(webProfileDir(home), 'cordis.patch.yml');

/** 构建 web 包；dist/client.js 已存在且 force/skip 未设时跳过（返回 false）。 */
export async function buildWebPackage(force = false, skip = false) {
  if (skip) return false;
  const pkg = webPackageDir();
  const dist = join(pkg, 'dist', 'client.js');
  if (!force) {
    try {
      await fs.access(dist);
      return false; // 已构建，无需重跑
    } catch { /* 缺失，需构建 */ }
  }
  execFileSync(process.execPath, [join(pkg, 'build.mjs')], { cwd: pkg, stdio: 'inherit' });
  return true;
}

/** 在 profile node_modules 下建立指向仓库 web 包的链接（幂等）。 */
export async function linkWebPackage(home, force = false) {
  const link = webPluginLink(home);
  const target = webPackageDir();
  await fs.mkdir(dirname(link), { recursive: true });
  let existed = false;
  try {
    const st = await fs.lstat(link);
    existed = true;
    if (st.isSymbolicLink()) {
      if (await fs.realpath(link) === await fs.realpath(target)) return false; // 已指向正确目标
      if (!force) throw new Error(`链接已存在且指向他处：${link}`);
      await fs.unlink(link);
    } else {
      throw new Error(`已存在且不是符号链接，拒绝覆盖：${link}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // 相对目标：profile 整体迁移后链接仍有效
  const rel = relative(dirname(link), target);
  await fs.symlink(rel, link, process.platform === 'win32' ? 'junction' : 'dir');
  if (existed) console.log(`web 插件链接已重指向 → ${target}`);
  return true;
}

/** 向 cordis.patch.yml 追加 - insert 条目（幂等；entryId 已存在则原样返回）。 */
export function appendPluginPatch(text, entryId = WEB_ENTRY_ID, pkgName = WEB_PKG_NAME) {
  // dsh 首次创建 profile 时 cordis.patch.yml 自带 `[]` 空数组占位符：直接追加会得到
  // `[]` + `- insert:` 两个顶层文档粘连（YAML 解析失败：end of the stream）。先统一移除
  // 占位符行，再按条目是否已存在决定追加或跳过——自愈"占位符 + 条目并存"的坏状态。
  const placeholder = /^[ \t]*\[\][ \t]*(?:\r?\n|$)/m;
  const withoutPlaceholder = text.replace(placeholder, '');
  if (withoutPlaceholder.includes(`- id: ${entryId}`)) return withoutPlaceholder;
  const block = `# ${pkgName} — 3D 预览客户端插件（Plan B 安装脚本注入）\n- insert:\n    - id: ${entryId}\n      name: '${pkgName}'\n`;
  // 非占位符（既有内容已是顶层块列表）：追加一个条目，规范化尾随换行避免残留双空行。
  return withoutPlaceholder.replace(/\n*$/, '') + '\n' + block;
}

/** 完整安装：构建 + 链接 + patch。profile 目录自足创建；patch 缺失按空串容忍。 */
export async function installWebPlugin(home, { force = false, skipBuild = false } = {}) {
  // profile 目录自足创建：CLI 与 install-dsh-preset.mjs 集成共用，缺失时不再 ENOENT
  await fs.mkdir(webProfileDir(home), { recursive: true });
  const built = await buildWebPackage(force, skipBuild);
  const linked = await linkWebPackage(home, force);
  const patchPath = webPatchPath(home);
  let before = '';
  try {
    before = await fs.readFile(patchPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // 缺失按空串处理；其他错误响亮抛出
  }
  const after = appendPluginPatch(before);
  let patched = false;
  if (after !== before) {
    await fs.writeFile(patchPath, after, 'utf8');
    patched = true;
  }
  return { built, linked, patched, pluginDir: webPackageDir(), profileDir: webProfileDir(home) };
}

function parseArgs(argv) {
  const opts = { force: false, dryRun: false, help: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--force': opts.force = true; break;
      case '--skip-build': opts.skipBuild = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help':
      case '-h': opts.help = true; break;
      default: throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return opts;
}

// 仅直接运行本文件时执行 CLI；被测试 import 时不触发副作用。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    // --self-test 在 parseArgs 之前短路（parseArgs 对未知参数 default 抛错，进不去）
    if (args.includes('--self-test')) {
      const text = '# patch\n[]\n';
      const once = appendPluginPatch(text);
      const twice = appendPluginPatch(once);
      if (once === twice && once.includes(`- id: ${WEB_ENTRY_ID}`)) {
        console.log('self-test OK');
        process.exitCode = 0;
      } else {
        console.error('self-test FAIL: appendPluginPatch 非幂等');
        process.exitCode = 1;
      }
    } else {
      const opts = parseArgs(args);
      if (opts.help) {
        console.log('用法：node install-web-plugin.mjs [--force] [--skip-build] [--dry-run]');
        process.exitCode = 0;
      } else if (opts.dryRun) {
        const home = resolveDshHome();
        console.log('[dry-run] web 包：', webPackageDir());
        console.log('[dry-run] profile：', webProfileDir(home));
        console.log('[dry-run] 链接：', webPluginLink(home));
        console.log('[dry-run] patch：', webPatchPath(home));
      } else {
        const home = resolveDshHome();
        const r = await installWebPlugin(home, { force: opts.force, skipBuild: opts.skipBuild });
        console.log(`web 客户端插件已就绪（built=${r.built}, linked=${r.linked}, patched=${r.patched}）`);
        console.log('重启 dsh web 后，cad_show_step 的 3D 预览卡片即生效。');
      }
    }
  } catch (error) {
    console.error(`[install-web-plugin] 失败：${error.message}`);
    process.exitCode = 1;
  }
}
