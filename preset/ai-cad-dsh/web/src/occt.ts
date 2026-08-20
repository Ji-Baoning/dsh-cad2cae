// src/occt.ts — 单实例 WASM + STEP → THREE.Group。
import occtimportjs from 'occt-import-js';
import * as THREE from 'three';
import { OCCT_WASM_BASE64 } from './generated/wasm-b64';
import { base64ToBytes } from './base64';
import { rowMajorToMatrix4 } from './transform';

export interface Occt {
  ReadStepFile(bytes: Uint8Array, text: unknown): OcctResult;
}
export interface OcctMesh {
  name?: string;
  attributes: {
    position: { array: Float32Array };
    normal?: { array: Float32Array };
  };
  index: { array: Uint32Array };
  color?: [number, number, number];
}
export interface OcctResult {
  success: boolean;
  meshes?: OcctMesh[];
  error?: string;
}

let occtPromise: Promise<Occt> | null = null;

/** 单实例 WASM：所有零件共享，避免重复加载 ~10MB。 */
export function getOcct(): Promise<Occt> {
  if (!occtPromise) {
    const wasmBinary = base64ToBytes(OCCT_WASM_BASE64);
    occtPromise = occtimportjs({ wasmBinary }) as Promise<Occt>;
  }
  return occtPromise;
}

/** 解析一个零件 STEP → 按 transform 定位的 THREE.Group（零件级位置由 placements 矩阵施加）。 */
export async function stepToGroup(bytes: Uint8Array, transform: number[]): Promise<THREE.Group> {
  const occt = await getOcct();
  const result = occt.ReadStepFile(bytes, null);
  if (!result.success || !result.meshes || result.meshes.length === 0) {
    throw new Error('STEP 解析失败: ' + (result.error ?? '无网格'));
  }
  const group = new THREE.Group();
  for (const mesh of result.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
    if (mesh.attributes.normal) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
    }
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.index.array), 1));
    const color = mesh.color
      ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
      : new THREE.Color(0x9aa7b8);
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    object.name = mesh.name ?? '';
    group.add(object);
  }
  group.applyMatrix4(rowMajorToMatrix4(transform));
  return group;
}
