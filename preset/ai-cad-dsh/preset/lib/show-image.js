// preset/ai-cad-dsh/preset/lib/show-image.js
// show_image 工具：把一张图片（PNG/JPEG/WebP/GIF）显示到 DSH web 对话中。
// 设计规格：docs/superpowers/specs/2026-08-19-show-image-design.md（路线 A）。
//
// 关键点：模型可能是纯文本（deepseek-v4-flash）——图片是给用户看的，不要求模型能看图。
// 因此本工具不设「模型须声明 image 输入」门禁（与内置 read_image 相反）；适配器侧的
// text-only 序列化补丁（patch-harness.mjs）把 image 块折成 [图片: …] 文本占位喂给模型。
// 零依赖纯逻辑：不引入 @deepseek-ai/*，保持可独立测试。
import { basename } from 'node:path';

const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 按扩展名判 MIME；非图片扩展名返回 undefined（调用方据此响亮报错）。 */
export function mediaTypeForPath(path) {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return undefined;
  return IMAGE_MEDIA_TYPES[path.slice(idx).toLowerCase()];
}

/** 模型侧文本信封：展示路径 + 图片元数据摘要（沿 read_image 的 <path>/<type>/<content> 风格）。 */
export function formatShowImageOutput(path, image, alt) {
  return `<path>${path}</path>
<type>image</type>
<content>
${alt ? `${alt}\n` : ''}${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes
</content>`;
}

/** 把返回的 image 元数据组回 ImageBlock.attachment 引用。 */
export function imageRefFromValue(image) {
  return {
    attachmentId: image.attachmentId,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === void 0 ? {} : { name: image.name }),
  };
}

/** render 内容块：文本信封（模型可见）+ image 块（UI 渲染；纯文本模型经补丁折成占位）。 */
export function showImageContent(value) {
  return [
    { type: 'text', text: formatShowImageOutput(value.path, value.image, value.alt) },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ];
}

// dsh-tools 的 value schema 编译器（compileValueSchema, allowRequired:false）禁止顶层 required 键；
// 必需性必须写在各属性 `required: true` 上，编译器会在输出 JSON Schema 里合成 required 数组。
// 与内置 read_image 的 output schema 同构（见 dsh-tool-fs applyReadImageTool）。
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    alt: { type: 'string' },
    image: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          required: true,
        },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
  },
};

/**
 * show_image 工具定义。execute(ctx, args) 沿用插件 wrap 的 `t.execute(ctx, args)` 约定；
 * output.render 收到的是 execute 的**原始返回对象**（wrap 对带 output 的工具不 stringify，
 * 见 ai-cad-plugin.js）——这是 showImageContent 需要对象而非 JSON 字符串的原因。
 */
export function makeShowImageTool() {
  return {
    name: 'show_image',
    description: '把一张图片（PNG/JPEG/WebP/GIF）显示给用户。生成/渲染出预览图后调用，图片会显示在对话里。',
    parameters: {
      path: { type: 'string', required: true, description: '图片文件路径，由 fs 后端相对工作区解析' },
      alt: { type: 'string', description: '图片说明文字' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => showImageContent(value),
    },
    async execute(ctx, args) {
      const path = String(args?.path ?? '');
      if (path.trim().length === 0) {
        throw new Error('show_image 失败: PATH_REQUIRED (path 不能为空)');
      }
      const mediaType = mediaTypeForPath(path);
      if (mediaType === undefined) {
        throw new Error(`show_image 失败: UNSUPPORTED_IMAGE_FORMAT ("${path}" 仅支持 PNG/JPEG/WebP/GIF)`);
      }
      const attachments = ctx.get('attachments');
      if (attachments === undefined) {
        throw new Error('show_image 失败: NO_ATTACHMENT_SERVICE (未挂载 attachments 服务，无法显示图片)');
      }
      const fs = ctx.get('fs');
      const target = await fs.resolve(path);
      const info = await fs.stat(target);
      if (info === null) {
        throw new Error(`show_image 失败: FILE_NOT_FOUND ("${path}" 不存在)`);
      }
      const byteCap = Math.min(
        attachments.imageLimits.maxImageBytes,
        attachments.imageLimits.maxMessageImageBytes,
      );
      const data = await fs.readBytes(target, undefined, byteCap);
      let ref;
      try {
        ref = await attachments.saveImage({
          data,
          mediaType,
          name: basename(target.displayPath),
        });
      } catch (error) {
        // 扩展名声明的格式与实际字节不符 → 透传 saveImage 的 IMAGE_TYPE_MISMATCH（响亮报错不静默）。
        throw new Error(`show_image 失败: 图片格式错配 ("${target.displayPath}" 声明 ${mediaType} 但字节是其他格式): ${String(error)}`);
      }
      return {
        path: target.displayPath,
        alt: args.alt,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === void 0 ? {} : { name: ref.name }),
        },
      };
    },
  };
}
