// vite.config.ts — 渲染进程（React + Vite），dev server + build
import { defineConfig } from 'vite';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  base: './',
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome152',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
