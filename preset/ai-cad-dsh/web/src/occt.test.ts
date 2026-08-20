// src/occt.test.ts — 集成测试：Node 里跑真实 occt WASM + 真实 STEP。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOcct, stepToGroup } from './occt';
import { bytesToBase64 } from './base64';

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/hinge-part.step');

describe('occt · WASM 单例 + STEP 解析', () => {
  it('getOcct 返回同一实例（单实例 WASM）', async () => {
    const a = await getOcct();
    const b = await getOcct();
    expect(a).toBe(b);
  });

  it('stepToGroup 解析真实 STEP 为网格 Group', async () => {
    const bytes = readFileSync(fixture);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const group = await stepToGroup(bytes, identity);
    expect(group.children.length).toBeGreaterThan(0);
    // 世界单位 = STEP 数值(mm)：Box 0.05m → 50mm，bounding box 应含 ±50 量级
    let max = 0;
    for (const child of group.children) {
      const geo = (child as THREE.Mesh).geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < 3; k++) max = Math.max(max, Math.abs(pos.getX(i) ?? 0), Math.abs(pos.getY(i) ?? 0), Math.abs(pos.getZ(i) ?? 0));
      }
    }
    expect(max).toBeGreaterThan(20); // ≥ 20mm（Box 半宽 25mm / 圆柱半高 30mm）
    expect(max).toBeLessThan(200);
  });

  it('非法字节 → 抛错（响亮）', async () => {
    const bad = new Uint8Array([1, 2, 3, 4]);
    await expect(stepToGroup(bad, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).rejects.toThrow();
  });
});
