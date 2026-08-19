// src/store.ts — 模块级单例：单卡片机制的核心状态。
type Listener = () => void;

let latestCallId: string | null = null;
let version = 0;
const listeners = new Set<Listener>();

export function resetStore(): void {
  latestCallId = null;
  version = 0;
  listeners.clear();
}

export function getLatestCallId(): string | null {
  return latestCallId;
}

export function getVersion(): number {
  return version;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 新 cad_show_step 结果到达时调用；同一 callId 幂等，不重复递增版本。 */
export function publish(callId: string): void {
  if (latestCallId === callId) return;
  latestCallId = callId;
  version += 1;
  for (const fn of listeners) fn();
}
