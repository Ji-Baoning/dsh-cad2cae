// src/ViewerLayout.tsx — 布局：左侧零件树（显隐/高亮/测量），右侧 three.js 视口。
import { useEffect, useRef, useState } from 'react';
import type { Manifest } from './manifest';
import { stepToGroup } from './occt';
import { createScene, type SceneHandle } from './scene';
import { base64ToBytes } from './base64';

export function ViewerLayout({ manifest }: { manifest: Manifest }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(manifest.parts.map((p) => [p.id, true])),
  );
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // 持有最新显隐/高亮（effect #3 同步更新）；异步加载完成重放用，防加载期用户意图丢失
  const viewStateRef = useRef({ visible, highlighted });

  // 1) 场景初始化（一次）
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const scene = createScene(el);
    sceneRef.current = scene;
    return () => scene.dispose();
  }, []);

  // 2) 逐零件加载 STEP → 网格 → 加入场景
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;
    (async () => {
      for (const part of manifest.parts) {
        try {
          const group = await stepToGroup(base64ToBytes(part.step_b64), part.transform);
          if (cancelled) return;
          scene.addPart(part.id, group);
          // 立即重放当前显隐/高亮：零件落地前用户已取消勾选/高亮的意图不被 addPart 默认可见丢弃
          const { visible: curVisible, highlighted: curHighlighted } = viewStateRef.current;
          scene.setPartVisible(part.id, curVisible[part.id] !== false);
          scene.setPartHighlight(part.id, curHighlighted === part.id);
        } catch (error) {
          // 单零件失败不拖垮整体；响亮提示
          console.error(`[cad3d] 零件 ${part.id} 加载失败:`, error);
        }
      }
      if (!cancelled) scene.fitView();
    })();
    return () => { cancelled = true; };
  }, [manifest]);

  // 3) 高亮/显隐同步到场景
  useEffect(() => {
    viewStateRef.current = { visible, highlighted };
    const scene = sceneRef.current;
    if (!scene) return;
    for (const part of manifest.parts) {
      scene.setPartVisible(part.id, visible[part.id] !== false);
      scene.setPartHighlight(part.id, highlighted === part.id);
    }
  }, [manifest, visible, highlighted]);

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 240, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#e8ecf2' }}>
          零件（{manifest.parts.length}）
        </div>
        {manifest.parts.map((part) => (
          <div
            key={part.id}
            onClick={() => setHighlighted(highlighted === part.id ? null : part.id)}
            style={{
              padding: '6px 8px', marginBottom: 4, borderRadius: 6, cursor: 'pointer',
              background: highlighted === part.id ? '#1d3a5f' : '#20242c',
              border: '1px solid #333a45',
            }}
          >
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={visible[part.id] !== false}
                onChange={(e) => setVisible((v) => ({ ...v, [part.id]: e.target.checked }))}
                onClick={(e) => e.stopPropagation()}
              />
              <span style={{ color: '#e8ecf2' }}>{part.name}</span>
            </label>
            <div style={{ fontSize: 11, color: '#8b93a1', marginTop: 3, paddingLeft: 24 }}>
              体积 {part.measure.volume.toFixed(6)} m³ · 面积 {part.measure.surface_area.toFixed(4)} m²
              <br />
              {part.measure.watertight ? '水密' : '非水密'} · 质心 (
              {part.measure.centroid.map((n) => n.toFixed(3)).join(', ')}) m
            </div>
          </div>
        ))}
        {manifest.connections.length > 0 && (
          <div style={{ fontSize: 12, color: '#8b93a1', marginTop: 10 }}>
            连接：{manifest.connections.map((c) => `${c.id}(${c.type}: ${c.a}↔${c.b})`).join('、')}
          </div>
        )}
      </div>
      <div
        ref={viewportRef}
        style={{ flex: 1, height: 420, borderRadius: 8, overflow: 'hidden', border: '1px solid #333a45' }}
      />
    </div>
  );
}
