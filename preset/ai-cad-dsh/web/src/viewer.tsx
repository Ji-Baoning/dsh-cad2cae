// src/viewer.tsx — cad_show_step 的 toolview 卡片：单卡片更新 + 解析 manifest + 布局。
import { useEffect, useSyncExternalStore } from 'react';
import { getVersion, getLatestCallId, publish, subscribe } from './store';
import { parseManifest } from './manifest';
import { ViewerLayout } from './ViewerLayout';

export interface ToolViewProps {
  callId: string;
  /** 本组件不消费 toolName；标为可选以便测试/宿主最小化构造。 */
  toolName?: string;
  block: { meta?: unknown; content?: readonly unknown[] } | null;
  cwd?: string;
  openFile?: (path: string) => void;
  inspect?: () => void;
}

export function CadShowStepViewer({ callId, block }: ToolViewProps) {
  const latest = useSyncExternalStore(subscribe, getLatestCallId);

  // 新调用到达即发布；旧卡片因 latest 已变而收敛为细条。
  useEffect(() => {
    publish(callId);
  }, [callId]);

  if (latest !== callId) {
    return <StaleCard />;
  }

  const manifest = parseManifest(block?.meta);
  if (!manifest) {
    return <ErrorCard reason="manifest 缺失或非法（cad_show_step 未返回可用预览数据）" />;
  }

  return <ViewerLayout manifest={manifest} />;
}

function StaleCard() {
  return (
    <div style={{ color: '#8b93a1', fontSize: 13, padding: '6px 12px' }}>
      该预览已更新，见上方最新卡片（v{getVersion()}）。
    </div>
  );
}

function ErrorCard({ reason }: { reason: string }) {
  return (
    <div style={{ color: '#e06666', fontSize: 13, padding: '6px 12px', border: '1px solid #5a2a2a', borderRadius: 6 }}>
      3D 预览加载失败：{reason}
    </div>
  );
}
