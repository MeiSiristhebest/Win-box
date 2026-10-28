import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPackageSizeReport, inspectPackageOutput, writePackageSizeReport } from './package-app-size-report.mjs';

test('records app, ASAR, unpacked runtime resources, installer sizes and baseline deltas', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'winbox-size-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDirectory = join(root, 'release');
  const appDirectory = join(outputDirectory, 'win-unpacked');
  const installerPath = join(outputDirectory, 'Win-Box.Setup.exe');
  const archivePath = join(appDirectory, 'resources', 'app.asar');
  const runtimePath = join(appDirectory, 'resources', 'app.asar.unpacked', 'resources', 'runtime.bin');
  await mkdir(join(appDirectory, 'resources', 'app.asar.unpacked', 'resources'), { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(archivePath, Buffer.alloc(11));
  await writeFile(runtimePath, Buffer.alloc(7));
  await writeFile(installerPath, Buffer.alloc(19));

  const before = await inspectPackageOutput({ appDirectory, installerPath });
  await writeFile(archivePath, Buffer.alloc(13));
  await writeFile(runtimePath, Buffer.alloc(10));
  await writeFile(installerPath, Buffer.alloc(23));
  const after = await inspectPackageOutput({ appDirectory, installerPath });
  const report = createPackageSizeReport({ version: '1.0.0', before, after, installerRebuilt: true, recordedAt: '2026-10-28T00:00:00.000Z' });

  assert.equal(report.baseline.appAsarBytes, 11);
  assert.equal(report.current.appAsarBytes, 13);
  assert.equal(report.deltaBytes.appAsarBytes, 2);
  assert.equal(report.deltaBytes.unpackedRuntimeResourceBytes, 3);
  assert.equal(report.current.appDirectoryBreakdown.resources.bytes - report.baseline.appDirectoryBreakdown.resources.bytes, 5);
  assert.equal(report.deltaBytes.unpackedRuntimeResourceBreakdownBytes['runtime.bin'], 3);
  assert.equal(report.deltaBytes.installerBytes, 4);

  const written = await writePackageSizeReport({ outputDirectory, version: '1.0.0', before, after, installerRebuilt: true });
  assert.deepEqual(JSON.parse(await readFile(written.reportPath, 'utf8')), written.report);
});

test('attributes node_modules bytes once per physical package and separates attribution from per-path deltas', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'winbox-package-attribution-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const appDirectory = join(root, 'win-unpacked');
  const modules = join(appDirectory, 'node_modules');
  const rendererDirectory = join(modules, '@media', 'renderer');
  const adapterDirectory = join(modules, 'adapter');
  const codecDirectory = join(adapterDirectory, 'node_modules', 'codec');
  await mkdir(rendererDirectory, { recursive: true });
  await mkdir(codecDirectory, { recursive: true });

  const rendererManifest = JSON.stringify({ name: '@media/renderer', version: '2.0.0' });
  const adapterManifest = JSON.stringify({ name: 'adapter', version: '1.0.0', dependencies: { codec: '1.0.0' } });
  const codecManifest = JSON.stringify({ name: 'codec', version: '1.0.0' });
  await writeFile(join(rendererDirectory, 'package.json'), rendererManifest);
  await writeFile(join(rendererDirectory, 'index.js'), 'renderer');
  await writeFile(join(adapterDirectory, 'package.json'), adapterManifest);
  await writeFile(join(adapterDirectory, 'index.js'), 'adapter');
  await writeFile(join(codecDirectory, 'package.json'), codecManifest);
  await writeFile(join(codecDirectory, 'core.bin'), 'codec-binary');
  await writeFile(join(modules, '.modules.yaml'), 'package manager metadata');

  const before = await inspectPackageOutput({ appDirectory });
  assert.equal(before.nodeModulesPackageBreakdown['@media/renderer'].version, '2.0.0');
  assert.equal(before.nodeModulesPackageBreakdown['@media/renderer'].bytes, Buffer.byteLength(rendererManifest) + Buffer.byteLength('renderer'));
  assert.equal(before.nodeModulesPackageBreakdown.adapter.files, 2);
  assert.equal(before.nodeModulesPackageBreakdown.adapter.bytes, Buffer.byteLength(adapterManifest) + Buffer.byteLength('adapter'));
  assert.equal(before.nodeModulesPackageBreakdown['adapter/node_modules/codec'].version, '1.0.0');
  assert.equal(before.nodeModulesPackageBreakdown['adapter/node_modules/codec'].files, 2);
  assert.equal(before.nodeModulesPackageBreakdown['adapter/node_modules/codec'].bytes, Buffer.byteLength(codecManifest) + Buffer.byteLength('codec-binary'));
  assert.equal(before.nodeModulesAttributedBytes, Object.values(before.nodeModulesPackageBreakdown).reduce((sum, item) => sum + item.bytes, 0));
  assert.equal(before.nodeModulesBytes, before.nodeModulesAttributedBytes + before.nodeModulesUnattributedBytes);

  await writeFile(join(rendererDirectory, 'index.js'), 'renderer-updated');
  const after = await inspectPackageOutput({ appDirectory });
  const report = createPackageSizeReport({ version: '1.0.0', before, after, installerRebuilt: false });
  const rendererDelta = report.deltaBytes.nodeModulesPackageBreakdown['@media/renderer'];
  assert.equal(report.current.nodeModulesPackageBreakdown['@media/renderer'].bytes, after.nodeModulesPackageBreakdown['@media/renderer'].bytes);
  assert.equal(rendererDelta.beforeVersion, '2.0.0');
  assert.equal(rendererDelta.currentVersion, '2.0.0');
  assert.equal(rendererDelta.deltaBytes, Buffer.byteLength('renderer-updated') - Buffer.byteLength('renderer'));
  assert.match(report.baselineNote, /Current node_modules package attribution/);
  assert.match(report.baselineNote, /not causal savings claims/);
});

test('does not claim an installer rebuild when only the app directory was packaged', () => {
  const report = createPackageSizeReport({
    version: '1.0.0',
    before: { appDirectoryBytes: null, appDirectoryFiles: null, appDirectoryBreakdown: {}, appAsarBytes: null, unpackedRuntimeResourceBytes: null, unpackedRuntimeResourceFiles: null, unpackedRuntimeResourceBreakdown: {}, installerBytes: 100 },
    after: { appDirectoryBytes: 80, appDirectoryFiles: 2, appDirectoryBreakdown: {}, appAsarBytes: 50, unpackedRuntimeResourceBytes: 20, unpackedRuntimeResourceFiles: 1, unpackedRuntimeResourceBreakdown: {}, installerBytes: 100 },
    installerRebuilt: false,
  });
  assert.equal(report.current.installerBytes, null);
  assert.equal(report.deltaBytes.installerBytes, null);
});
