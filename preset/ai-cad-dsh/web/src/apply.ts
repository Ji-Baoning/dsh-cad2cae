// src/apply.ts — toolview 插槽注册（与 dsh-client-ui-tool 的 read-toolview 同构）。
import { CadShowStepViewer } from './viewer';

export const inject = ['slots'] as const;

export type SlotsCtx = {
  slots: {
    inject(name: string, fn: () => unknown): void;
    register(desc: { name: string; key: string }, component: unknown): unknown;
  };
};

export function apply(ctx: SlotsCtx): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      { name: 'tool.call.toolview', key: 'cad_show_step' },
      CadShowStepViewer,
    ),
  );
}
