#!/usr/bin/env node
// patch-harness.mjs
// DSH harness text-only 序列化补丁（show_image 工具的前置条件）。
//
// 背景（规格 2026-08-19-show-image-design.md 六）：DeepSeek 适配器（dsh-llm-deepseek）
// 对含 image 块的消息抛 UNSUPPORTED_CONTENT——纯文本模型会话一旦 tool-result 带图即整轮失败。
// 本补丁把 image 块折成 "[图片: …]" 文本占位喂给模型（text-only 序列化），UI 仍渲染原图。
//
// 幂等：文件已含标记注释（Text-only serialization (show_image patch)）→ 跳过；
// 源串不匹配（harness 升级改版）→ 警告并跳过，绝不半途写坏文件。
// 零依赖：仅用 node 内置模块。
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 幂等标记：补丁后的适配器文件必含此注释。 */
export const MARKER = 'Text-only serialization (show_image patch)';

/** 补丁前的 flattenText（精确字节匹配，tab 缩进与真实适配器一致）。 */
export const FLATTEN_OLD = [
  'function flattenText(blocks) {',
  '\treturn blocks.filter((block) => block.type === "text").map((block) => block.text).join("");',
  '}',
].join('\n');

/** 补丁后的 flattenText：image 块 → "[图片: <name>]" 占位，纯文本模型也能收 tool-result。 */
export const FLATTEN_NEW = [
  'function flattenText(blocks) {',
  '\treturn blocks',
  '\t\t.map((block) => block.type === "text" ? block.text',
  '\t\t\t: block.type === "image" ? `[图片: ${block.attachment?.name ?? "image"}]`',
  '\t\t\t: "")',
  '\t\t.join("");',
  '}',
].join('\n');

/** 补丁前的 assertTextOnly：遇 image 块直接抛 UNSUPPORTED_CONTENT。 */
export const ASSERT_OLD = [
  '/** Reject core image content before any text-flattening path can silently erase it. */',
  'function assertTextOnly(blocks) {',
  '\tif (contentHasImage(blocks)) throw new LlmError("The DeepSeek chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");',
  '}',
].join('\n');

/** 补丁后的 assertTextOnly：no-op（保留签名最小改动），image 块改由 flattenText 折成占位。 */
export const ASSERT_NEW = [
  `/** ${MARKER}: image blocks become "[图片: …]" placeholders`,
  ' * via flattenText instead of rejecting the request. The session UI still renders the original',
  ' * image; a text-only wire route can thus host sessions whose tool results carry images. */',
  'function assertTextOnly() {}',
].join('\n');

/**
 * 幂等应用 text-only 补丁到 DeepSeek 适配器。
 * @param {string} harnessRoot - 含 node_modules/@deepseek-ai/ 的 harness 根目录
 *   （= dirname(dirname(deps['dsh-tools']))，见 install-dsh-preset.mjs resolveHarnessDeps）。
 * @returns {Promise<{applied: boolean, reason: string, path: string}>}
 */
export async function applyTextOnlyPatch(harnessRoot) {
  const adapter = join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js');
  let text;
  try {
    text = await readFile(adapter, 'utf8');
  } catch {
    return { applied: false, reason: 'adapter-not-found', path: adapter };
  }
  if (text.includes(MARKER)) {
    return { applied: false, reason: 'already', path: adapter };
  }
  if (!text.includes(FLATTEN_OLD) || !text.includes(ASSERT_OLD)) {
    return { applied: false, reason: 'source-mismatch', path: adapter };
  }
  const patched = text.replace(FLATTEN_OLD, FLATTEN_NEW).replace(ASSERT_OLD, ASSERT_NEW);
  await writeFile(adapter, patched, 'utf8');
  return { applied: true, path: adapter };
}

// 仅直接运行本文件时执行（供诊断：node patch-harness.mjs <harnessRoot>）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error('用法：node patch-harness.mjs <harnessRoot>（含 node_modules/@deepseek-ai/ 的根目录）');
    process.exitCode = 2;
  } else {
    const r = await applyTextOnlyPatch(root);
    console.log(JSON.stringify(r));
    process.exitCode = r.applied ? 0 : (r.reason === 'already' ? 0 : 1);
  }
}
