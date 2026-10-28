import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

async function measurePackageContents(path) {
  const totals = { bytes: 0, files: 0 };
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && entry.name === 'node_modules')) continue;
      const childPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(childPath);
      else if (entry.isFile()) {
        const info = await stat(childPath);
        totals.bytes += info.size;
        totals.files += 1;
      }
    }
  };
  await visit(path);
  return totals;
}

async function readPackageManifest(path) {
  try {
    return JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function measureNodeModulesPackages(nodeModulesPath) {
  const packages = {};
  const visit = async (directory, relativePath = '') => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
      throw error;
    }

    const addPackage = async (packageDirectory, packagePath, fallbackName) => {
      const manifest = await readPackageManifest(packageDirectory);
      const measured = await measurePackageContents(packageDirectory);
      packages[packagePath] = {
        packageName: manifest?.name ?? fallbackName,
        version: manifest?.version ?? null,
        bytes: measured.bytes,
        files: measured.files,
      };
      await visit(join(packageDirectory, 'node_modules'), `${packagePath}/node_modules`);
    };

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const entryPath = join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        let scopedEntries;
        try {
          scopedEntries = await readdir(entryPath, { withFileTypes: true });
        } catch (error) {
          if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue;
          throw error;
        }
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory() || scopedEntry.isSymbolicLink() || scopedEntry.name.startsWith('.')) continue;
          const packagePath = relativePath ? `${relativePath}/${entry.name}/${scopedEntry.name}` : `${entry.name}/${scopedEntry.name}`;
          await addPackage(join(entryPath, scopedEntry.name), packagePath, packagePath);
        }
        continue;
      }

      const packagePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      await addPackage(entryPath, packagePath, entry.name);
    }
  };

  await visit(nodeModulesPath);
  return Object.fromEntries(Object.entries(packages).sort(([left], [right]) => left.localeCompare(right)));
}

function breakdownDelta(before, current) {
  if (!before || !current) return null;
  const names = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
  return Object.fromEntries(names.map((name) => [
    name,
    (current[name]?.bytes ?? 0) - (before[name]?.bytes ?? 0),
  ]));
}

function packageBreakdownDelta(before, current) {
  if (!before || !current) return null;
  const paths = [...new Set([...Object.keys(before), ...Object.keys(current)])].sort();
  return Object.fromEntries(paths.map((path) => {
    const previous = before[path] ?? null;
    const next = current[path] ?? null;
    return [path, {
      packageName: next?.packageName ?? previous?.packageName ?? path,
      beforeVersion: previous?.version ?? null,
      currentVersion: next?.version ?? null,
      beforeBytes: previous?.bytes ?? 0,
      currentBytes: next?.bytes ?? 0,
      deltaBytes: (next?.bytes ?? 0) - (previous?.bytes ?? 0),
    }];
  }));
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
  const [appDirectoryBreakdown, unpackedRuntimeResourceBreakdown, nodeModulesPackageBreakdown] = app ? await Promise.all([
    measureDirectoryEntries(appDirectory),
    measureDirectoryEntries(join(appDirectory, 'resources', 'app.asar.unpacked', 'resources')),
    measureNodeModulesPackages(join(appDirectory, 'node_modules')),
  ]) : [{}, {}, {}];
  const nodeModules = appDirectoryBreakdown.node_modules;
  const attributedNodeModulesBytes = Object.values(nodeModulesPackageBreakdown).reduce((total, item) => total + item.bytes, 0);
  const attributedNodeModulesFiles = Object.values(nodeModulesPackageBreakdown).reduce((total, item) => total + item.files, 0);
  return {
    appDirectoryBytes: app?.bytes ?? null,
    appDirectoryFiles: app?.files ?? null,
    appDirectoryBreakdown,
    nodeModulesBytes: app ? nodeModules?.bytes ?? 0 : null,
    nodeModulesFiles: app ? nodeModules?.files ?? 0 : null,
    nodeModulesPackageBreakdown,
    nodeModulesAttributedBytes: app ? attributedNodeModulesBytes : null,
    nodeModulesUnattributedBytes: app ? Math.max(0, (nodeModules?.bytes ?? 0) - attributedNodeModulesBytes) : null,
    nodeModulesUnattributedFiles: app ? Math.max(0, (nodeModules?.files ?? 0) - attributedNodeModulesFiles) : null,
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
      nodeModulesBytes: delta('nodeModulesBytes'),
      nodeModulesAttributedBytes: delta('nodeModulesAttributedBytes'),
      nodeModulesUnattributedBytes: delta('nodeModulesUnattributedBytes'),
      nodeModulesPackageBreakdown: packageBreakdownDelta(before.nodeModulesPackageBreakdown, current.nodeModulesPackageBreakdown),
      appDirectoryBreakdownBytes: breakdownDelta(before.appDirectoryBreakdown, current.appDirectoryBreakdown),
      unpackedRuntimeResourceBreakdownBytes: breakdownDelta(before.unpackedRuntimeResourceBreakdown, current.unpackedRuntimeResourceBreakdown),
      installerBytes: delta('installerBytes'),
    },
    baselineNote: 'Baseline reflects the package output that existed before this build. Null means that artifact was not present for a direct comparison. Current node_modules package attribution counts each physical package once, excluding nested node_modules from its parent; signed per-path deltas compare before and after sizes and are not causal savings claims.',
  };
}

export async function writePackageSizeReport(options) {
  const reportPath = join(options.outputDirectory, 'package-size-report.json');
  const report = createPackageSizeReport(options);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { reportPath, report };
}
