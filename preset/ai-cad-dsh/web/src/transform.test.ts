// src/transform.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rowMajorToMatrix4 } from './transform';

describe('rowMajorToMatrix4 · 行主序 4×4 → THREE.Matrix4', () => {
  it('恒等变换', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = rowMajorToMatrix4(identity);
    const e = m.elements; // three 内部列主序
    expect(e).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('平移 (1,2,3) 使原点落位', () => {
    const t = [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1];
    const m = rowMajorToMatrix4(t);
    const v = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it('绕 Z 轴 90° 把 X 轴旋到 Y', () => {
    const rotZ90 = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const m = rowMajorToMatrix4(rotZ90);
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});
