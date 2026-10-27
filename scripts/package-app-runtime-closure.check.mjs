import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertPackagedRuntimeClosure,
  copyBundledPackageLicenses,
  loadAndValidateRuntimeClosure,
} from './package-app-runtime-closure.mjs';

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'winbox-closure-'));
  const packageManifest = {
    dependencies: {
      '@vendor/parser': '1.0.0',
      'archive-wasm': '1.0.0',
    },
    devDependencies: {
      'bundled-html': '1.0.0',
    },
  };
  const closure = {
    schemaVersion: 1,
    runtimePackages: {
      staticExternals: ['@vendor/parser'],
      dynamicAllowlist: [{
        name: 'archive-wasm',
        requiredAssets: ['node_modules/archive-wasm/core.wasm'],
      }],
    },
    bundledPackages: [{ name: 'bundled-html' }],
    rendererBundledPackages: [],
    rendererExternalPackages: [],
    dynamicRequireAllowlist: [{
      artifact: 'dist/main.cjs',
      expression: "require('@vendor/parser/subpath')",
      allowedPackageNames: ['@vendor/parser'],
    }],
    unusedDependencies: [{ name: 'unused-qr' }],
    runtimeAssetRoots: ['dist', 'resources'],
    resourceExclusions: ['resources/**/tools/**'],
    licenseRetention: {
      resourceFilenamePattern: '^(licenses?|licences?|copying|notice|patents?)([._-].*)?$',
      supplementalFiles: [{
        packageName: 'bundled-nolicense',
        packageVersion: '3.0.0',
        path: 'resources/licenses/third-party/bundled-nolicense/3.0.0/LICENSE',
      }],
    },
  };

  await mkdir(join(root, 'dist', 'renderer', 'assets'), { recursive: true });
  await mkdir(join(root, 'resources'), { recursive: true });
  await mkdir(join(root, 'node_modules', '@vendor', 'parser'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'archive-wasm'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'bundled-html', 'node_modules', 'bundled-child'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'bundled-html', 'node_modules', 'bundled-child', 'node_modules', 'bundled-nolicense'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'bundled-html', 'lib'), { recursive: true });
  await writeFile(join(root, 'dist', 'main.cjs'), `require('node:fs');require('electron');require('@vendor/parser/subpath');require(moduleId);`);
  await writeFile(join(root, 'dist', 'renderer', 'assets', 'index.js'), `import './chunk.js'; import('./lazy.js');`);
  await writeFile(join(root, 'node_modules', '@vendor', 'parser', 'package.json'), JSON.stringify({ name: '@vendor/parser' }));
  await writeFile(join(root, 'node_modules', 'archive-wasm', 'package.json'), JSON.stringify({ name: 'archive-wasm' }));
  await writeFile(join(root, 'node_modules', 'archive-wasm', 'core.wasm'), 'wasm');
  await writeFile(join(root, 'node_modules', 'bundled-html', 'package.json'), JSON.stringify({ name: 'bundled-html', version: '1.0.0', dependencies: { 'bundled-child': '2.0.0' } }));
  await writeFile(join(root, 'node_modules', 'bundled-html', 'LICENSE.md'), 'MIT license');
  await writeFile(join(root, 'node_modules', 'bundled-html', 'node_modules', 'bundled-child', 'package.json'), JSON.stringify({ name: 'bundled-child', version: '2.0.0', dependencies: { 'bundled-nolicense': '3.0.0' } }));
  await writeFile(join(root, 'node_modules', 'bundled-html', 'node_modules', 'bundled-child', 'LICENSE'), 'BSD license');
  await writeFile(join(root, 'node_modules', 'bundled-html', 'node_modules', 'bundled-child', 'node_modules', 'bundled-nolicense', 'package.json'), JSON.stringify({ name: 'bundled-nolicense', version: '3.0.0', license: 'ISC' }));
  const supplementalLicensePath = join(root, 'resources', 'licenses', 'third-party', 'bundled-nolicense', '3.0.0', 'LICENSE');
  await mkdir(join(root, 'resources', 'licenses', 'third-party', 'bundled-nolicense', '3.0.0'), { recursive: true });
  await writeFile(supplementalLicensePath, 'Supplemental ISC license');
  await writeFile(join(root, 'node_modules', 'bundled-html', 'lib', 'index.js'), 'export {};');
  await writeFile(join(root, 'package.json'), JSON.stringify(packageManifest));
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(join(root, 'scripts', 'package-app-runtime-closure.json'), JSON.stringify(closure));

  return { root, closure, packageManifest };
}

test('derives static externals and validates production, dynamic asset, and bundled dependency boundaries', async (t) => {
  const { root, packageManifest } = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await loadAndValidateRuntimeClosure(root, packageManifest);
  assert.deepEqual(result.actualStatic, ['@vendor/parser']);
  assert.deepEqual(result.actualRendererExternals, []);
  assert.deepEqual(result.dynamicNames, ['archive-wasm']);
  assert.deepEqual(result.bundledNames, ['bundled-html']);

  await writeFile(join(root, 'dist', 'main.cjs'), `require('@vendor/parser');require('@unexpected/external');`);
  await assert.rejects(loadAndValidateRuntimeClosure(root, packageManifest), /Built CJS external package closure mismatch/);
});

test('rejects empty dynamic runtime assets during source preflight', async (t) => {
  const { root, packageManifest } = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'node_modules', 'archive-wasm', 'core.wasm'), Buffer.alloc(0));
  await assert.rejects(loadAndValidateRuntimeClosure(root, packageManifest), /Dynamic runtime asset must be a non-empty file/);
});

test('rejects renderer bare imports and stale dynamic require allowlist entries', async (t) => {
  const { root, packageManifest } = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, 'dist', 'renderer', 'assets', 'index.js'), `import './chunk.js'; import('renderer-external');`);
  await assert.rejects(loadAndValidateRuntimeClosure(root, packageManifest), /Built renderer external package closure mismatch/);

  await writeFile(join(root, 'dist', 'renderer', 'assets', 'index.js'), `import './chunk.js'; import('./lazy.js');`);
  await writeFile(join(root, 'dist', 'main.cjs'), `require('node:fs');require('electron');require("@vendor/parser/subpath");require(moduleId);`);
  await assert.rejects(loadAndValidateRuntimeClosure(root, packageManifest), /Dynamic require allowlist expression was not found/);
});

test('copies only bundled-package license material into unpacked resources and validates ASAR closure', async (t) => {
  const { root, closure, packageManifest } = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await loadAndValidateRuntimeClosure(root, packageManifest);

  const stagingDirectory = join(root, 'stage');
  await mkdir(stagingDirectory, { recursive: true });
  const licenseRecords = await copyBundledPackageLicenses(root, stagingDirectory, closure);
  assert.equal(licenseRecords.length, 3);
  const licenseRoot = join(stagingDirectory, 'resources', 'app.asar.unpacked', 'resources', 'licenses', 'third-party');
  const licensePath = join(licenseRoot, 'bundled-html', '1.0.0', 'LICENSE.md');
  const childLicensePath = join(licenseRoot, 'bundled-child', '2.0.0', 'LICENSE');
  const supplementalLicensePath = join(licenseRoot, 'bundled-nolicense', '3.0.0', 'LICENSE');
  assert.equal(await readFile(licensePath, 'utf8'), 'MIT license');
  assert.equal(await readFile(childLicensePath, 'utf8'), 'BSD license');
  assert.equal(await readFile(supplementalLicensePath, 'utf8'), 'Supplemental ISC license');

  const archiveEntries = [
    join('/', 'node_modules', '@vendor', 'parser', 'package.json'),
    join('/', 'node_modules', 'archive-wasm', 'package.json'),
    join('/', 'node_modules', 'archive-wasm', 'core.wasm'),
  ];
  const archiveFiles = new Map([
    [join('node_modules', '@vendor', 'parser', 'package.json'), Buffer.from(JSON.stringify({ name: '@vendor/parser' }))],
    [join('node_modules', 'archive-wasm', 'package.json'), Buffer.from(JSON.stringify({ name: 'archive-wasm' }))],
    [join('node_modules', 'archive-wasm', 'core.wasm'), Buffer.from('wasm')],
  ]);
  const extractFile = (_archive, path) => {
    const content = archiveFiles.get(path);
    if (content) return content;
    throw new Error(`missing ${path}`);
  };

  await assertPackagedRuntimeClosure({
    archivePath: 'app.asar',
    stagingDirectory,
    closure,
    extractFile,
    listPackage: () => archiveEntries,
    licenseRecords,
    runtimeAssetManifest: { required: [] },
  });

  await assert.rejects(assertPackagedRuntimeClosure({
    archivePath: 'app.asar',
    stagingDirectory,
    closure,
    extractFile: (...args) => args[1].endsWith('core.wasm') ? Buffer.alloc(0) : extractFile(...args),
    listPackage: () => archiveEntries,
    licenseRecords,
    runtimeAssetManifest: { required: [] },
  }), /Packaged dynamic runtime asset is empty/);

  await assert.rejects(assertPackagedRuntimeClosure({
    archivePath: 'app.asar',
    stagingDirectory,
    closure,
    extractFile,
    listPackage: () => [...archiveEntries, join('/', 'node_modules', '.pnpm', 'dangling-entry')],
    licenseRecords,
    runtimeAssetManifest: { required: [] },
  }), /must not contain pnpm install metadata/);

  await assert.rejects(assertPackagedRuntimeClosure({
    archivePath: 'app.asar',
    stagingDirectory,
    closure,
    extractFile,
    listPackage: () => [...archiveEntries, join('/', 'node_modules', 'bundled-html', 'lib', 'index.js')],
    licenseRecords,
    runtimeAssetManifest: { required: [] },
  }), /Bundled package code must not be present/);
});

