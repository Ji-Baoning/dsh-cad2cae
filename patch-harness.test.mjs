#!/usr/bin/env node
// patch-harness.test.mjs
// text-only 补丁的 fixture 测试：unpatched→applied、patched→already、source-mismatch→不写。
// 在临时目录构造伪适配器文件，绝不触碰真实 harness（与 install-dsh-preset.mjs 的
// --no-patch 配合，回归期间跳过真实补丁）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyTextOnlyPatch, FLATTEN_OLD, FLATTEN_NEW, ASSERT_OLD, ASSERT_NEW, MARKER,
} from './patch-harness.mjs';

function fakeHarness(adapterText) {
  const root = mkdtempSync(join(tmpdir(), 'patch-harness-'));
  const dir = join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib');
  mkdirSync(dir, { recursive: true });
  const adapter = join(dir, 'index.js');
  writeFileSync(adapter, adapterText, 'utf8');
  return { root, adapter };
}

function adapterSrc(flatten, assertText) {
  return `// fake dsh-llm-deepseek adapter
import { LlmError } from './error.js';
${flatten}
${assertText}
// ...rest of adapter...\n`;
}

test('未打补丁 → applied：文件被替换且含标记注释', async () => {
  const { root, adapter } = fakeHarness(adapterSrc(FLATTEN_OLD, ASSERT_OLD));
  try {
    const r = await applyTextOnlyPatch(root);
    assert.equal(r.applied, true);
    assert.equal(r.path, adapter);
    const text = readFileSync(adapter, 'utf8');
    assert.ok(text.includes(MARKER), '补丁后应含幂等标记');
    assert.ok(text.includes(FLATTEN_NEW), 'flattenText 应被替换为新实现');
    assert.ok(text.includes(ASSERT_NEW), 'assertTextOnly 应被替换为 no-op');
    assert.ok(!text.includes(FLATTEN_OLD), '旧 flattenText 不应残留');
    assert.ok(!text.includes(ASSERT_OLD), '旧 assertTextOnly 不应残留');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('已打补丁 → already：不重复写入（内容保持补丁后形态）', async () => {
  const { root, adapter } = fakeHarness(adapterSrc(FLATTEN_NEW, ASSERT_NEW));
  const before = readFileSync(adapter, 'utf8');
  try {
    const r = await applyTextOnlyPatch(root);
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'already');
    assert.equal(readFileSync(adapter, 'utf8'), before, 'already 时文件应保持原样');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('源串不匹配（harness 升级改版）→ source-mismatch：绝不半途写坏文件', async () => {
  const upstream = adapterSrc(
    'function flattenText(blocks) {\n\treturn blocks.filter((b) => b.type === "text").map((b) => b.text).join("");\n}',
    ASSERT_OLD,
  );
  const { root, adapter } = fakeHarness(upstream);
  const before = readFileSync(adapter, 'utf8');
  try {
    const r = await applyTextOnlyPatch(root);
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'source-mismatch');
    assert.equal(readFileSync(adapter, 'utf8'), before, 'source-mismatch 时文件必须原封不动');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('适配器不存在 → adapter-not-found', async () => {
  const root = mkdtempSync(join(tmpdir(), 'patch-harness-missing-'));
  try {
    const r = await applyTextOnlyPatch(root);
    assert.equal(r.applied, false);
    assert.equal(r.reason, 'adapter-not-found');
    assert.match(r.path, /dsh-llm-deepseek\/lib\/index\.js$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
