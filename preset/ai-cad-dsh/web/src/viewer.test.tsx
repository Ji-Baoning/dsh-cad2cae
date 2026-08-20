// src/viewer.test.tsx — cad_show_step toolview 卡片：单卡片更新 + manifest 解析 + 收敛。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { CadShowStepViewer } from './viewer';
import * as store from './store';

// 不加载真 WASM/canvas：mock scene 与 occt（canvas/WASM 边界）。
vi.mock('./scene', () => ({
  createScene: vi.fn(() => ({
    dispose: vi.fn(), addPart: vi.fn(), setPartVisible: vi.fn(),
    setPartHighlight: vi.fn(), fitView: vi.fn(),
  })),
}));
vi.mock('./occt', () => ({
  getOcct: vi.fn(),
  stepToGroup: vi.fn(async () => ({})),
}));

const META = {
  manifest: {
    version: 1, workflow_id: 'wf-1', viewer: 'assembly',
    parts: [{
      id: 'c1', part_ref: 'hn1', name: 'hn1', step_b64: 'SVNPLTEwMzAzLTIxOw==',
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      measure: { volume: 0.001, surface_area: 0.02, centroid: [0, 0, 0], watertight: true },
    }],
    connections: [], assembly_step: 'cad-state/wf-1/assembly.step',
  },
};

describe('CadShowStepViewer', () => {
  beforeEach(() => store.resetStore());
  // vitest 未开 globals，RTL 不自动清理：手动 cleanup，避免跨用例 DOM 残留。
  afterEach(() => cleanup());

  it('最新调用渲染完整布局（零件名可见）', async () => {
    store.publish('call-1');
    render(<CadShowStepViewer callId="call-1" block={{ meta: META }} />);
    expect(await screen.findByText('hn1')).toBeTruthy();
  });

  it('旧调用收敛为细条，不实例化 WASM', () => {
    const { getByText, queryByText } = render(
      <CadShowStepViewer callId="call-1" block={{ meta: META }} />,
    );
    expect(getByText('hn1')).toBeTruthy();
    act(() => store.publish('call-2'));
    expect(getByText(/已更新/)).toBeTruthy();
    expect(queryByText('hn1')).toBeNull();
  });

  it('meta 缺失 → 响亮错误卡片', () => {
    store.publish('call-1');
    const { getByText } = render(<CadShowStepViewer callId="call-1" block={{ meta: {} }} />);
    expect(getByText(/manifest 缺失或非法/)).toBeTruthy();
  });
});
