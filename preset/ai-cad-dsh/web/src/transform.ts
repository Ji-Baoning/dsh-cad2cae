// src/transform.ts — 行主序 16 数 → THREE.Matrix4。
// build123d 侧沿"轴方向 + 平移"构造行主序矩阵（第一列=变换后 X 轴，第四列=平移）；
// THREE.Matrix4.set 恰按行主序接收 16 参数，故直接展开即可。
import * as THREE from 'three';

export function rowMajorToMatrix4(t: readonly number[]): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.set(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]);
  return m;
}
