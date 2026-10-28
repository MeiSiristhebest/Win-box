import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { shouldIgnorePackagedAppPath } from './package-app-path-policy.mjs';

const root = 'D:\\app';
const packagedPath = (path) => `${root}\\${path.replaceAll('/', '\\')}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeClosure = JSON.parse(await readFile(join(repoRoot, 'scripts/package-app-runtime-closure.json'), 'utf8'));
const policy = (path, options = {}) => shouldIgnorePackagedAppPath(packagedPath(path), root, {
  runtimeClosure,
  ...options,
});

test('omits build caches, source maps, and ignored temporary dependency copies', () => {
  assert.equal(policy('node_modules/.modules.yaml'), true);
  assert.equal(policy('node_modules/.pnpm/fast-xml-parser@5.0.0/node_modules/fast-xml-parser/package.json'), true);
  assert.equal(policy('node_modules/fast-xml-parser/package.json'), false);
  for (const path of [
    'node_modules/.vite/deps/chunk.js',
    'node_modules/.vite/vitest/results.json',
    'node_modules/.vitest-cache/entry',
    'node_modules/.vitest/cache.json',
    'dist/main.cjs.map',
    'dist/renderer/assets/player.js.map',
    'node_modules/.ignored/@fluentui/react-icons_tmp_27384_2/package.json',
    'node_modules/.ignored/happy-dom_tmp_31512_9/lib/index.js',
    'node_modules/.ignored/rxjs_tmp_31512_12/package.json',
  ]) {
    assert.equal(policy(path), true, path);
  }

  assert.equal(policy('dist/main.cjs'), false);
  assert.equal(policy('dist/renderer/assets/player.js'), false);
  assert.equal(policy('node_modules/.ignored/@fluentui/react-icons/package.json'), true);
});

test('omits packages bundled in main or renderer output and keeps runtime externals', () => {
  assert(runtimeClosure.rendererBundledPackages.some(({ name }) => name === 'pinyin-match'));
  assert(!runtimeClosure.bundledPackages.some(({ name }) => name === 'pinyin-match'));
  for (const path of [
    'node_modules/hls.js/dist/hls.js',
    'node_modules/mpegts.js/dist/mpegts.js',
    'node_modules/react/index.js',
    'node_modules/react-dom/index.js',
    'node_modules/react-router/index.js',
    'node_modules/react-router-dom/index.js',
    'node_modules/cheerio/package.json',
    'node_modules/crypto-es/package.json',
    'node_modules/pinyin-match/package.json',
    'node_modules/undici/package.json',
  ]) {
    assert.equal(policy(path), true, path);
  }

  for (const path of [
    'node_modules/fast-xml-parser/package.json',
    'node_modules/@babel/core/package.json',
    'node_modules/node-unrar-js/package.json',
    'node_modules/7z-wasm/package.json',
    'node_modules/node-unrar-js/dist/js/unrar.wasm',
    'node_modules/7z-wasm/7zz.wasm',
    'resources/jvm/jre/bin/java.exe',
    'resources/js-lib/cheerio.min.js',
  ]) {
    assert.equal(policy(path), false, path);
  }

  const dangling = new Set(['node_modules/@types/qrcode/node_modules/@types/node']);
  assert.equal(policy('node_modules/@types/qrcode/node_modules/@types/node', { danglingNodeModulePaths: dangling }), true);
  assert.equal(policy('node_modules/@types/node', { danglingNodeModulePaths: dangling }), false);
});

test('rejects paths outside the app root and preserves the existing resource exclusions', () => {
  assert.equal(shouldIgnorePackagedAppPath('D:\\other\\dist\\main.cjs', root), true);
  for (const path of [
    'resources/tools/helper.exe',
    'resources/runtime/.tmp/cache.bin',
    'resources/jvm/jre/lib/jvm.lib',
    'resources/jvm/jre/lib/jawt.lib',
    'resources/jvm/jre/lib/jython-standalone-2.7.3.jar',
    'resources/jvm/__pycache__/module.pyc',
  ]) assert.equal(policy(path), true, path);
  assert.equal(policy('resources/plugins/plugin.winbox'), false);
  for (const path of [
    'resources/jvm/jre/bin/java.exe',
    'resources/jvm/jre/bin/server/jvm.dll',
    'resources/jvm/jre/lib/modules',
  ]) assert.equal(policy(path), false, path);
});
