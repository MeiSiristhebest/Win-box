import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldIgnorePackagedAppPath } from './package-app-path-policy.mjs';

const root = 'D:\\app';
const packagedPath = (path) => `${root}\\${path.replaceAll('/', '\\')}`;

test('omits build and test caches, source maps, and stale Fluent icon temp copies', () => {
  for (const path of [
    'node_modules/.vite/deps/chunk.js',
    'node_modules/.vite/vitest/results.json',
    'node_modules/.vitest-cache/entry',
    'node_modules/.vitest/cache.json',
    'dist/main.cjs.map',
    'dist/renderer/assets/player.js.map',
    'node_modules/.ignored/@fluentui/react-icons_tmp_27384_2/package.json',
  ]) {
    assert.equal(shouldIgnorePackagedAppPath(packagedPath(path), root), true, path);
  }

  assert.equal(shouldIgnorePackagedAppPath('dist/main.cjs', root), false);
  assert.equal(shouldIgnorePackagedAppPath('dist/renderer/assets/player.js', root), false);
  assert.equal(shouldIgnorePackagedAppPath('node_modules/.ignored/@fluentui/react-icons/package.json', root), false);
});

test('omits only renderer libraries bundled into renderer chunks', () => {
  for (const path of [
    'node_modules/hls.js/dist/hls.js',
    'node_modules/mpegts.js/dist/mpegts.js',
    'node_modules/react/index.js',
    'node_modules/react-dom/index.js',
    'node_modules/react-router/index.js',
    'node_modules/react-router-dom/index.js',
  ]) {
    assert.equal(shouldIgnorePackagedAppPath(packagedPath(path), root), true, path);
  }

  for (const path of [
    'node_modules/fast-xml-parser/package.json',
    'node_modules/@babel/core/package.json',
    'node_modules/cheerio/package.json',
    'node_modules/crypto-es/package.json',
    'node_modules/undici/package.json',
    'resources/jvm/jre/bin/java.exe',
    'resources/js-lib/cheerio.min.js',
  ]) {
    assert.equal(shouldIgnorePackagedAppPath(packagedPath(path), root), false, path);
  }

  const dangling = new Set(['node_modules/@types/qrcode/node_modules/@types/node']);
  assert.equal(shouldIgnorePackagedAppPath(packagedPath('node_modules/@types/qrcode/node_modules/@types/node'), root, { danglingNodeModulePaths: dangling }), true);
  assert.equal(shouldIgnorePackagedAppPath(packagedPath('node_modules/@types/node'), root, { danglingNodeModulePaths: dangling }), false);
});

test('rejects paths outside the app root and preserves the existing resource exclusions', () => {
  assert.equal(shouldIgnorePackagedAppPath('D:\\other\\dist\\main.cjs', root), true);
  assert.equal(shouldIgnorePackagedAppPath(packagedPath('resources/tools/helper.exe'), root), true);
  assert.equal(shouldIgnorePackagedAppPath(packagedPath('resources/plugins/plugin.winbox'), root), false);
});
