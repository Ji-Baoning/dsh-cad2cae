// src/scene.ts — three.js 场景工厂。世界单位 = STEP 数值单位（mm）。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneHandle {
  dispose(): void;
  addPart(partId: string, object: THREE.Object3D): void;
  setPartVisible(partId: string, visible: boolean): void;
  setPartHighlight(partId: string, on: boolean): void;
  fitView(): void;
}

export function createScene(container: HTMLElement): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171c);

  const camera = new THREE.PerspectiveCamera(
    50,
    Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
    0.01,
    100000,
  );
  camera.position.set(120, 100, 160);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // 单位 mm：零件尺度 ~几十 mm，栅格/坐标轴按 mm 设置。
  const grid = new THREE.GridHelper(200, 20, 0x3a4150, 0x2a303a);
  scene.add(grid);
  scene.add(new THREE.AxesHelper(50));

  scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.2));
  scene.add(new THREE.DirectionalLight(0xffffff, 1.0));

  const parts = new Map<string, THREE.Object3D>();
  let rafId = 0;
  const render = () => {
    rafId = requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  };
  render();

  const dispose = () => {
    cancelAnimationFrame(rafId);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  function addPart(partId: string, object: THREE.Object3D): void {
    parts.set(partId, object);
    scene.add(object);
  }

  function setPartVisible(partId: string, visible: boolean): void {
    const obj = parts.get(partId);
    if (obj) obj.visible = visible;
  }

  function setPartHighlight(partId: string, on: boolean): void {
    const obj = parts.get(partId);
    if (!obj) return;
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh.isMesh && (mesh.material as THREE.MeshStandardMaterial).emissive)) return;
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x4488ff : 0x000000);
    });
  }

  function fitView(): void {
    if (parts.size === 0) return;
    const box = new THREE.Box3();
    for (const obj of parts.values()) {
      const b = new THREE.Box3().setFromObject(obj);
      if (!b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    controls.target.copy(center);
    camera.near = radius / 100;
    camera.far = radius * 100;
    camera.position.copy(center.clone().add(new THREE.Vector3(1, 0.8, 1.2).multiplyScalar(radius * 2.2)));
    camera.updateProjectionMatrix();
    controls.update();
  }

  return { dispose, addPart, setPartVisible, setPartHighlight, fitView };
}
