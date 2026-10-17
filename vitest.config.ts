import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

// 引擎层单测配置：纯 Node 环境，零 Electron 依赖。
// 架构铁律：src/engine/** 禁止 import electron。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    globals: false,
    reporters: ['default'],
    pool: 'forks',
    maxWorkers: Math.min(4, availableParallelism()),
  },
});
