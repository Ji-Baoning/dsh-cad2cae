// src/apply.test.ts — apply(ctx) 插槽注册契约：插件与 harness 的唯一触点。
// 用 mock ctx 捕获 slots.inject / slots.register，断言注册形状与真实组件引用。
// 注意：本测试只注册引用，不 render 组件（apply 不触碰 DOM/场景）。
import { describe, it, expect, vi } from 'vitest';
import { apply } from './apply';
import { CadShowStepViewer } from './viewer';

describe('apply · toolview 插槽注册契约', () => {
  it('注入一次 tool.call.toolview，工厂调用后注册 cad_show_step 并携带真实组件引用', () => {
    const inject = vi.fn();
    const register = vi.fn();
    const ctx = { slots: { inject, register } };

    apply(ctx);

    // 1) 注入钩子恰好一次，命名为 tool.call.toolview
    expect(inject).toHaveBeenCalledTimes(1);
    expect(inject.mock.calls[0][0]).toBe('tool.call.toolview');

    // 2) 取出注入的工厂并调用 → 触发延迟注册
    (inject.mock.calls[0][1] as () => void)();

    expect(register).toHaveBeenCalledTimes(1);
    const [desc, component] = register.mock.calls[0];
    expect(desc).toEqual({ name: 'tool.call.toolview', key: 'cad_show_step' });
    // 第二个参数必须是真实组件引用（非拷贝/包装）
    expect(component).toBe(CadShowStepViewer);
  });
});
