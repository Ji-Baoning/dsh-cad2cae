// preset/ai-cad-dsh/preset/lib/show-image.test.js
// show_image 工具测试（规格 2026-08-19-show-image-design.md 七）：纯逻辑 + execute 全路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mediaTypeForPath, formatShowImageOutput, imageRefFromValue,
  showImageContent, makeShowImageTool,
} from './show-image.js';
import { makeCtx, tempBase } from './test/support.js';

// 最小合法 PNG 字节（1×1，RGBA）——saveImage mock 不校验格式，但保证 fs.readBytes 读到真图字节。
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010804000000d5b5c7b80000001e4944415408d7' +
  '63f8cfc0c0000206000000000000fcf7ff010e000000ffff03002ad541f4d57539030000000049454e44ae426082',
  'hex');

function writePng(base, rel) {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, PNG_1PX);
  return abs;
}

test('mediaTypeForPath 各扩展名/非法', () => {
  assert.equal(mediaTypeForPath('a.png'), 'image/png');
  assert.equal(mediaTypeForPath('a.jpg'), 'image/jpeg');
  assert.equal(mediaTypeForPath('a.jpeg'), 'image/jpeg');
  assert.equal(mediaTypeForPath('a.webp'), 'image/webp');
  assert.equal(mediaTypeForPath('a.gif'), 'image/gif');
  assert.equal(mediaTypeForPath('a.PNG'), 'image/png');       // 大小写不敏感
  assert.equal(mediaTypeForPath('a.txt'), undefined);
  assert.equal(mediaTypeForPath('a'), undefined);             // 无扩展名
  assert.equal(mediaTypeForPath(''), undefined);
});

test('formatShowImageOutput 信封含路径/元数据/alt', () => {
  const env = formatShowImageOutput('cad-state/x/p.png', { mediaType: 'image/png', width: 16, height: 12, bytes: 99 }, '预览图');
  assert.match(env, /<path>cad-state\/x\/p\.png<\/path>/);
  assert.match(env, /image\/png image, 16x12 px, 99 bytes/);
  assert.match(env, /预览图/);
  const noAlt = formatShowImageOutput('p.png', { mediaType: 'image/gif', width: 1, height: 1, bytes: 1 });
  assert.doesNotMatch(noAlt, /<content>\n\n/);
});

test('imageRefFromValue / showImageContent 组 [text, image] 块', () => {
  const value = { path: 'p.png', alt: 'x', image: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 3, width: 2, height: 2, name: 'p.png' } };
  const blocks = showImageContent(value);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'text');
  assert.equal(blocks[1].type, 'image');
  assert.deepEqual(blocks[1].attachment, imageRefFromValue(value.image));
  assert.equal(blocks[1].attachment.attachmentId, 'att-1');
  // 无 name 时 attachment 不含 name 键
  const noName = imageRefFromValue({ attachmentId: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1 });
  assert.equal('name' in noName, false);
});

test('makeShowImageTool 形状（含 output schema）', () => {
  const t = makeShowImageTool();
  assert.equal(t.name, 'show_image');
  assert.ok(t.description.includes('显示给用户'));
  assert.equal(t.parameters.path.required, true);
  assert.equal(t.parameters.alt.required, undefined);
  assert.equal(typeof t.output, 'object');
  // dsh value schema 编译器禁止顶层 required 键；必需性靠各属性 required:true（read_image 同构）。
  assert.equal(t.output.schema.required, undefined);
  assert.equal(t.output.schema.properties.path.required, true);
  assert.equal(t.output.schema.properties.image.required, true);
  assert.deepEqual(t.output.schema.properties.image.properties.mediaType.enum,
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  assert.equal(typeof t.execute, 'function');
});

test('execute 成功：读图 → saveImage → 返回 {path, alt, image}', async () => {
  const base = tempBase();
  writePng(base, 'cad-state/wf1/preview.png');
  const ctx = makeCtx({ baseDir: base, python: 'python3', attachments: true });
  const t = makeShowImageTool();
  const value = await t.execute(ctx, { path: 'cad-state/wf1/preview.png', alt: '装配预览' });
  assert.match(value.path, /preview\.png$/);
  assert.equal(value.alt, '装配预览');
  assert.equal(value.image.attachmentId, 'att-1');
  assert.equal(value.image.mediaType, 'image/png');
  assert.equal(value.image.bytes, PNG_1PX.byteLength);
  assert.equal(value.image.width, 16);
  assert.equal(value.image.height, 12);
  assert.equal(value.image.name, 'preview.png');
  const att = ctx.get('attachments');
  assert.equal(att.saved.length, 1);
  assert.equal(att.saved[0].mediaType, 'image/png');
  assert.equal(att.saved[0].name, 'preview.png');
});

test('execute 空 path → PATH_REQUIRED', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3', attachments: true });
  const t = makeShowImageTool();
  await assert.rejects(() => t.execute(ctx, {}), /PATH_REQUIRED/);
  await assert.rejects(() => t.execute(ctx), /PATH_REQUIRED/);
});

test('execute 非法格式 → UNSUPPORTED_IMAGE_FORMAT', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3', attachments: true });
  const t = makeShowImageTool();
  await assert.rejects(() => t.execute(ctx, { path: 'a.txt' }), /UNSUPPORTED_IMAGE_FORMAT/);
});

test('execute 缺 attachments 服务 → NO_ATTACHMENT_SERVICE', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3' }); // 不注入 attachments
  const t = makeShowImageTool();
  await assert.rejects(() => t.execute(ctx, { path: 'a.png' }), /NO_ATTACHMENT_SERVICE/);
});

test('execute 文件不存在 → FILE_NOT_FOUND', async () => {
  const ctx = makeCtx({ baseDir: tempBase(), python: 'python3', attachments: true });
  const t = makeShowImageTool();
  await assert.rejects(() => t.execute(ctx, { path: 'nope.png' }), /FILE_NOT_FOUND/);
});

test('execute 图片格式错配（saveImage 抛 IMAGE_TYPE_MISMATCH）→ 响亮透传', async () => {
  const base = tempBase();
  writePng(base, 'x.png');
  const bad = {
    imageLimits: { maxImageBytes: 1e9, maxMessageImageBytes: 1e9, mediaTypes: ['image/png'] },
    async saveImage() { const e = new Error('bytes are jpeg not png'); e.code = 'IMAGE_TYPE_MISMATCH'; throw e; },
  };
  const ctx = makeCtx({ baseDir: base, python: 'python3', attachments: bad });
  const t = makeShowImageTool();
  await assert.rejects(() => t.execute(ctx, { path: 'x.png' }), /图片格式错配/);
});
