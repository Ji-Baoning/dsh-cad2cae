// preset/ai-cad-dsh/web/test/build-smoke.test.mjs
// 构建冒烟：build 后校验 dist/client.js 的 DSH 契约标记。node --test 运行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { build as esbuild } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('build 产出符合 DSH 客户端 bundle 契约', () => {
  // 用子进程跑 build.mjs（其顶层 await 会执行整次构建），避免 ESM 重复执行
  execFileSync(process.execPath, [resolve(root, 'build.mjs')], { cwd: root });

  const out = resolve(root, 'dist/client.js');
  assert.ok(existsSync(out), 'dist/client.js 存在');
  const src = readFileSync(out, 'utf8');

  // 包装契约：id 注册 + 工厂内定义 module/exports + 工厂返回 module.exports
  assert.match(src, /window\.__ModuleLoader__\.load\(\{ id: "@ai-cad\/cad3d-preview"/,
    '含 __ModuleLoader__.load 注册');
  assert.match(src, /var module = \{ exports: \{\} \}/, '工厂内定义 module');
  assert.match(src, /return module\.exports;/, '工厂返回 module.exports');
  // wasm 契约：base64 内联 + wasmBinary 注入（不网络加载）。
  // 注意：Emscripten 产物无论是否传 wasmBinary 都会定义 locateFile 函数（运行时由 wasmBinary 短路），
  // 故断言内联 magic 头（AGFzbQ = \0asm 的 base64 前缀）与 wasmBinary 注入，而非 locateFile 字符串。
  assert.match(src, /AGFzbQ/, 'wasm 二进制已 base64 内联进 bundle（\0asm magic 前缀）');
  assert.match(src, /wasmBinary/, 'wasm 注入走 wasmBinary（非网络加载）');

  // 真实 materialize：按 DSH 加载器方式执行 bundle，断言返回模块确实暴露 apply/inject。
  // （比正则更强：直接证明加载器能解析 exports.apply）
  let def;
  vm.runInNewContext(src, {
    window: {
      __ModuleLoader__: {
        load(d) {
          def = d;
        },
      },
    },
  }, { filename: 'client.js' });
  assert.ok(def, '__ModuleLoader__.load 被调用');
  assert.equal(def.id, '@ai-cad/cad3d-preview', 'id 正确');
  // 占位阶段 bundle 无真实 react 依赖，stub require 足够
  const mod = def.factory(() => ({}));
  assert.equal(typeof mod.apply, 'function', '返回模块暴露 apply');
  // vm 沙箱是独立 realm：先展开成宿主数组再比较（元素为原始字符串，跨 realm 安全）
  assert.deepEqual([...mod.inject], ['slots'], '返回模块暴露 inject');
});

test('react/react-dom 构建期 external（不内联）', async () => {
  // 占位入口未 import react，主 bundle 里暂无 require('react')。
  // 用探测入口真实 import react，以与 build.mjs 相同的 external 配置 bundle，
  // 断言输出保留 require 调用 —— 直接验证构建链的 external 契约。
  const probeDir = join(root, '.smoke-probe');
  mkdirSync(probeDir, { recursive: true });
  const probeEntry = join(probeDir, 'probe.tsx');
  const probeOut = join(probeDir, 'probe.js');
  writeFileSync(probeEntry, `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nexport const App = () => React.createElement('div');\nexport const Root = createRoot;\n`);
  try {
    await esbuild({
      entryPoints: [probeEntry],
      outfile: probeOut,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      // 与 build.mjs 的 external 保持一致
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
      logLevel: 'silent',
    });
    const probe = readFileSync(probeOut, 'utf8');
    // esbuild 仅对 external 依赖发出 require 调用：出现 require 即证明未内联
    assert.match(probe, /require\("react"\)/, 'react 外置（require 调用，不内联）');
    assert.match(probe, /require\("react-dom\/client"\)/, 'react-dom/client 外置');
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
});
