import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sanitizePackagedApp } from './after-pack.mjs';
import { compileNsis } from './nsis-tool.mjs';
import { buildInstallerScript } from './installer-script.mjs';
import { assertReleaseAssets } from './verify-release-assets.mjs';
import { collectDanglingNodeModulePaths, shouldIgnorePackagedAppPath } from './package-app-path-policy.mjs';
import { assertPackagedRuntimeClosure, copyBundledPackageLicenses, loadAndValidateRuntimeClosure } from './package-app-runtime-closure.mjs';
import { inspectPackageOutput, writePackageSizeReport } from './package-app-size-report.mjs';
import { promotePackageDirectory, withPackageStaging } from './package-app-staging.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const insideRoot = (path) => {
  const rel = relative(ROOT, resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

export async function runPackageApp() {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const version = packageJson.version;
  const releaseDir = join(ROOT, `release${version}`);
  const outputDirOption = process.argv.indexOf('--output-dir');
  if (outputDirOption !== -1 && outputDirOption !== process.argv.lastIndexOf('--output-dir')) {
    throw new Error('Use --output-dir once.');
  }
  const outputDirArgument = outputDirOption === -1 ? null : process.argv[outputDirOption + 1];
  if (outputDirOption !== -1 && (!outputDirArgument || outputDirArgument.startsWith('--'))) {
    throw new Error('--output-dir requires a path inside the workspace.');
  }
  const outputDir = outputDirArgument ? resolve(ROOT, outputDirArgument) : releaseDir;
  if (!insideRoot(outputDir)) throw new Error(`Refusing to write output outside the workspace: ${outputDir}`);

  await assertReleaseAssets(ROOT);
  const runtimeAssetManifest = JSON.parse(await readFile(join(ROOT, 'scripts', 'runtime-assets.json'), 'utf8'));
  const runtimeClosure = await loadAndValidateRuntimeClosure(ROOT, packageJson);
  const [{ packager }, { extractFile, listPackage }] = await Promise.all([
    import('@electron/packager'),
    import('@electron/asar'),
  ]);

  const stagingDir = join(ROOT, '.tmp', `packager-${process.pid}-${Date.now()}`);
  const expectedStage = join(stagingDir, 'Win-Box-win32-x64');
  const appDir = join(outputDir, 'win-unpacked');
  const installerPath = join(outputDir, `Win-Box.Setup.${version}.exe`);
  const baseline = await inspectPackageOutput({ appDirectory: appDir, installerPath });
  const installerRebuilt = process.argv.includes('--installer');
  const danglingNodeModulePaths = await collectDanglingNodeModulePaths(ROOT);
  if (danglingNodeModulePaths.size) {
    console.log(`Skipping ${danglingNodeModulePaths.size} unresolved node_modules links during package copy.`);
  }

  return withPackageStaging(stagingDir, async () => {
    await mkdir(stagingDir, { recursive: true });
    const packed = await packager({
      dir: ROOT,
      name: 'Win-Box',
      executableName: 'Win-Box',
      appVersion: version,
      buildVersion: version.split('-')[0],
      platform: 'win32',
      arch: 'x64',
      electronZipDir: process.env.WINBOX_ELECTRON_ZIP_DIR?.trim() || undefined,
      out: stagingDir,
      overwrite: true,
      prune: true,
      asar: { unpackDir: 'resources' },
      ignore: (candidate) => shouldIgnorePackagedAppPath(candidate, ROOT, {
        danglingNodeModulePaths,
        runtimeClosure: runtimeClosure.closure,
      }),
      icon: join(ROOT, 'build', 'icon.ico'),
      appCopyright: 'Win-Box',
      win32metadata: {
        CompanyName: 'Win-Box',
        FileDescription: 'Win-Box',
        ProductName: 'Win-Box',
        InternalName: 'Win-Box',
        'requested-execution-level': 'asInvoker',
      },
      afterComplete: [sanitizePackagedApp],
    });

    if (!packed.includes(expectedStage)) throw new Error(`Electron Packager returned an unexpected output path: ${packed.join(', ')}`);
    if (!insideRoot(appDir) || !insideRoot(stagingDir)) throw new Error(`Refusing to replace an output outside the workspace: ${appDir}`);
    await stat(expectedStage);
    const archivePath = join(expectedStage, 'resources', 'app.asar');
    const licenseRecords = await copyBundledPackageLicenses(ROOT, expectedStage, runtimeClosure.closure);
    await assertPackagedRuntimeClosure({
      archivePath,
      stagingDirectory: expectedStage,
      closure: runtimeClosure.closure,
      extractFile,
      listPackage,
      licenseRecords,
      runtimeAssetManifest,
    });
    await mkdir(dirname(appDir), { recursive: true });
    const backupPath = join(outputDir, `.win-unpacked.backup-${process.pid}-${Date.now()}-${randomUUID()}`);
    const promotionMethod = await promotePackageDirectory({ source: expectedStage, destination: appDir, backupPath });
    console.log(`Windows app staged at ${appDir} (${promotionMethod})`);

    if (installerRebuilt) {
      const nsiPath = join(stagingDir, 'win-box-installer.nsi');
      const nsi = await buildInstallerScript({ appDir, outFile: installerPath, version, license: join(ROOT, 'LICENSE'), icon: join(ROOT, 'build', 'icon.ico') });
      await mkdir(dirname(nsiPath), { recursive: true });
      await writeFile(nsiPath, `\uFEFF${nsi}`, 'utf8');
      await compileNsis(nsiPath, { cwd: ROOT });
      console.log(`Windows installer created at ${installerPath}`);
    }

    const after = await inspectPackageOutput({ appDirectory: appDir, installerPath });
    const { reportPath, report } = await writePackageSizeReport({ outputDirectory: outputDir, version, before: baseline, after, installerRebuilt });
    console.log(`Package size report: ${reportPath}`);
    console.log(JSON.stringify({ baseline: report.baseline, current: report.current, deltaBytes: report.deltaBytes }, null, 2));
    return { appDir, installerPath, promotionMethod, reportPath };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPackageApp();
}
