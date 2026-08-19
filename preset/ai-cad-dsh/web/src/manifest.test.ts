// src/manifest.test.ts
import { describe, it, expect } from 'vitest';
import { parseManifest } from './manifest';

const VALID = {
  version: 1,
  workflow_id: 'wf-1',
  viewer: 'assembly',
  parts: [{
    id: 'c1', part_ref: 'hn1', name: 'hn1',
    step_b64: 'SVNPLTEwMzAzLTIxOw==', // "ISO-10303-21;" 的 base64
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    measure: { volume: 0.001, surface_area: 0.02, centroid: [0, 0, 0], watertight: true },
  }],
  connections: [],
  assembly_step: 'cad-state/wf-1/assembly.step',
};

describe('parseManifest · block.meta.manifest 校验', () => {
  it('合法 manifest 解析成功并保留字段', () => {
    const m = parseManifest({ manifest: VALID });
    expect(m).not.toBeNull();
    expect(m!.workflow_id).toBe('wf-1');
    expect(m!.parts).toHaveLength(1);
    expect(m!.parts[0].transform).toHaveLength(16);
    expect(m!.parts[0].measure.volume).toBe(0.001);
  });

  it('无 manifest 键 → null', () => {
    expect(parseManifest({})).toBeNull();
    expect(parseManifest(undefined)).toBeNull();
  });

  it('缺 parts / 空 parts → null', () => {
    expect(parseManifest({ manifest: { ...VALID, parts: undefined } })).toBeNull();
    expect(parseManifest({ manifest: { ...VALID, parts: [] } })).toBeNull();
  });

  it('transform 长度非 16 → null', () => {
    const bad = { ...VALID, parts: [{ ...VALID.parts[0], transform: [1, 2, 3] }] };
    expect(parseManifest({ manifest: bad })).toBeNull();
  });

  it('step_b64 缺失 → null', () => {
    const { step_b64, ...part } = VALID.parts[0];
    const bad = { ...VALID, parts: [part] };
    expect(parseManifest({ manifest: bad })).toBeNull();
  });

  it('measure 字段缺失 → null', () => {
    const bad = { ...VALID, parts: [{ ...VALID.parts[0], measure: undefined }] };
    expect(parseManifest({ manifest: bad })).toBeNull();
  });
});
