// src/manifest.ts — block.meta.manifest 解析/校验（纯逻辑，零依赖）。
export interface MeasureInfo {
  volume: number;
  surface_area: number;
  centroid: [number, number, number];
  watertight: boolean;
}
export interface PartManifest {
  id: string;
  part_ref: string;
  name: string;
  step_b64: string;
  transform: number[]; // 16，行主序 4×4
  measure: MeasureInfo;
}
export interface ConnectionInfo {
  id: string;
  type: string;
  a: string;
  b: string;
}
export interface Manifest {
  version: number;
  workflow_id: string;
  viewer: 'assembly' | 'single_part';
  parts: PartManifest[];
  connections: ConnectionInfo[];
  assembly_step: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isFiniteArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** 校验一个 part；非法返回 null。 */
function parsePart(raw: unknown): PartManifest | null {
  if (!isRecord(raw)) return null;
  const measure = raw.measure;
  if (
    typeof raw.id !== 'string' || typeof raw.part_ref !== 'string' ||
    typeof raw.name !== 'string' || typeof raw.step_b64 !== 'string' ||
    !isFiniteArray(raw.transform) || raw.transform.length !== 16 ||
    !isRecord(measure) || !isFiniteArray(measure.centroid) || measure.centroid.length !== 3 ||
    typeof measure.volume !== 'number' || typeof measure.surface_area !== 'number' ||
    typeof measure.watertight !== 'boolean'
  ) return null;
  return {
    id: raw.id, part_ref: raw.part_ref, name: raw.name, step_b64: raw.step_b64,
    transform: raw.transform.slice(),
    measure: {
      volume: measure.volume, surface_area: measure.surface_area,
      centroid: [measure.centroid[0], measure.centroid[1], measure.centroid[2]],
      watertight: measure.watertight,
    },
  };
}

/** 解析 block.meta；要求 meta.manifest 形如上面的 Manifest。非法 → null（调用方响亮报错）。 */
export function parseManifest(meta: unknown): Manifest | null {
  if (!isRecord(meta) || !isRecord(meta.manifest)) return null;
  const m = meta.manifest;
  if (m.version !== 1 || typeof m.workflow_id !== 'string' ||
      (m.viewer !== 'assembly' && m.viewer !== 'single_part') ||
      !Array.isArray(m.parts) || m.parts.length === 0 ||
      typeof m.assembly_step !== 'string' ||
      m.connections !== undefined && !Array.isArray(m.connections)) return null;
  const parts: PartManifest[] = [];
  for (const p of m.parts) {
    const part = parsePart(p);
    if (part === null) return null;
    parts.push(part);
  }
  const connections: ConnectionInfo[] = [];
  if (Array.isArray(m.connections)) {
    for (const c of m.connections) {
      // type 仅允许 static|kinematic 两个取值（数据契约）。
      if (!isRecord(c) || typeof c.id !== 'string' || (c.type !== 'static' && c.type !== 'kinematic') ||
          typeof c.a !== 'string' || typeof c.b !== 'string') return null;
      connections.push({ id: c.id, type: c.type, a: c.a, b: c.b });
    }
  }
  return {
    version: 1, workflow_id: m.workflow_id, viewer: m.viewer as Manifest['viewer'],
    parts, connections, assembly_step: m.assembly_step,
  };
}
