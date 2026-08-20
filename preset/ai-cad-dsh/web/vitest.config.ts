// preset/ai-cad-dsh/web/vitest.config.ts
// projects：纯逻辑测试（node）+ 组件测试（jsdom）。scene.test.ts 用 @vitest-environment 切换。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    projects: [
      {
        test: {
          name: 'pure',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.test.tsx'],
        },
      },
      {
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
});
