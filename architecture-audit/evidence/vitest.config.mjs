import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['architecture-audit/evidence/*.probe.spec.ts'], maxWorkers: 1 } });
