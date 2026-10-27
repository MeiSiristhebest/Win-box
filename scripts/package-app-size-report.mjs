import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function measurePath(path) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
  if (info.isFile()) return { bytes: info.size, files: 1 };
  if (!info.isDirectory()) return { bytes: 0, files: 0 };

  const totals = { bytes: 0, files: 0 };
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const child = await measurePath(join(path, entry.name));
    if (!child) continue;
    totals.bytes += child.bytes;
    totals.files += child.files;
  }
  return totals;
}

async function measureDirectoryEntries(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return {};
    throw error;
  }

  const measured = await Promise.all(entries.map(async (entry) => {
    if (entry.isSymbolicLink()) return null;
    const result = await measurePath(join(path, entry.name));
    return result ? [entry.name, result] : null;
  }));
  return Object.fromEntries(measured.filter(Boolean).sort(([left], [right]) => left.localeCompare(right)));
}

function breakdownDelta(before, current) {
  if (!before || !current) return null;
  const names = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
  return Object.fromEntries(names.map((name) => [
    name,
    (current[name]?.bytes ?? 0) - (before[name]?.bytes ?? 0),
  ]));
}

export async function inspectPackageOutput({ appDirectory, installerPath }) {
  const [app, installer] = await Promise.all([
    measurePath(appDirectory),
    installerPath ? measurePath(installerPath) : null,
  ]);
  const [archive, runtimeResources] = app ? await Promise.all([
    measurePath(join(appDirectory, 'resources', 'app.asar')),
    measurePath(join(appDirectory, 'resources', 'app.asar.unpacked', 'resources')),
  ]) : [null, null];
  const [appDirectoryBreakdown, unpackedRuntimeResourceBreakdown] = app ? await Promise.all([
    measureDirectoryEntries(appDirectory),
    measureDirectoryEntries(join(appDirectory, 'resources', 'app.asar.unpacked', 'resources')),
  ]) : [{}, {}];
  return {
    appDirectoryBytes: app?.bytes ?? null,
    appDirectoryFiles: app?.files ?? null,
    appDirectoryBreakdown,
    appAsarBytes: archive?.bytes ?? null,
    unpackedRuntimeResourceBytes: runtimeResources?.bytes ?? null,
    unpackedRuntimeResourceFiles: runtimeResources?.files ?? null,
    unpackedRuntimeResourceBreakdown,
    installerBytes: installer?.bytes ?? null,
  };
}

export function createPackageSizeReport({ version, before, after, installerRebuilt, recordedAt = new Date().toISOString() }) {
  const current = { ...after, installerBytes: installerRebuilt ? after.installerBytes : null };
  const delta = (key) => before[key] === null || current[key] === null ? null : current[key] - before[key];
  return {
    schemaVersion: 1,
    recordedAt,
    version,
    installerRebuilt,
    units: 'bytes',
    baseline: before,
    current,
    deltaBytes: {
      appDirectoryBytes: delta('appDirectoryBytes'),
      appAsarBytes: delta('appAsarBytes'),
      unpackedRuntimeResourceBytes: delta('unpackedRuntimeResourceBytes'),
      appDirectoryBreakdownBytes: breakdownDelta(before.appDirectoryBreakdown, current.appDirectoryBreakdown),
      unpackedRuntimeResourceBreakdownBytes: breakdownDelta(before.unpackedRuntimeResourceBreakdown, current.unpackedRuntimeResourceBreakdown),
      installerBytes: delta('installerBytes'),
    },
    baselineNote: 'Baseline reflects the package output that existed before this build. Null means that artifact was not present for a direct comparison.',
  };
}

export async function writePackageSizeReport(options) {
  const reportPath = join(options.outputDirectory, 'package-size-report.json');
  const report = createPackageSizeReport(options);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { reportPath, report };
}
