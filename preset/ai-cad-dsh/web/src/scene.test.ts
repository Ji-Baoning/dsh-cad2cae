// @vitest-environment jsdom
// src/scene.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createScene } from './scene';

// jsdom 无 WebGL：mock WebGLRenderer 为无操作，场景工厂其余逻辑可测。
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof THREE>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setSize() {}
    render() {}
    dispose() {}
  }
  return {
    ...actual,
    WebGLRenderer: vi.fn(() => new FakeRenderer()),
  };
});

describe('scene · 零件管理与相机', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '300px';
    container.style.height = '200px';
    document.body.appendChild(container);
  });

  it('addPart 后可显隐/高亮', () => {
    const scene = createScene(container);
    // Mesh 默认材质是 MeshBasicMaterial（无 emissive）；显式用 MeshStandardMaterial 才可测高亮。
    const obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    scene.addPart('p1', obj);
    scene.setPartVisible('p1', false);
    expect(obj.visible).toBe(false);
    scene.setPartVisible('p1', true);
    expect(obj.visible).toBe(true);
    scene.setPartHighlight('p1', true);
    const mat = (obj.material as THREE.MeshStandardMaterial);
    expect(mat.emissive.getHex()).not.toBe(0);
    scene.setPartHighlight('p1', false);
    expect(mat.emissive.getHex()).toBe(0);
    scene.dispose();
  });

  it('未知零件 id 操作不抛错（宽容）', () => {
    const scene = createScene(container);
    scene.setPartVisible('nope', false);
    scene.setPartHighlight('nope', true);
    scene.dispose();
  });

  it('fitView 不因空场景崩溃', () => {
    const scene = createScene(container);
    scene.fitView();
    scene.dispose();
  });
});
