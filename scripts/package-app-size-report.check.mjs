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
