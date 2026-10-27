import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizePackagedApp } from './after-pack.mjs';
import { compileNsis } from './nsis-tool.mjs';
import { buildInstallerScript } from './installer-script.mjs';
import { assertReleaseAssets } from './verify-release-assets.mjs';
import { collectDanglingNodeModulePaths, shouldIgnorePackagedAppPath } from './package-app-path-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const version = String(packageJson.version);
const releaseDir = join(ROOT, `release${version}`);
const insideRoot = (path) => {
  const rel = relative(ROOT, resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

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
const [{ packager }, { extractFile }] = await Promise.all([
  import('@electron/packager'),
  import('@electron/asar'),
]);

const stagingDir = join(ROOT, '.tmp', `packager-${process.pid}-${Date.now()}`);
const expectedStage = join(stagingDir, 'Win-Box-win32-x64');
const appDir = join(outputDir, 'win-unpacked');
const danglingNodeModulePaths = await collectDanglingNodeModulePaths(ROOT);
if (danglingNodeModulePaths.size) {
  console.log(`Skipping ${danglingNodeModulePaths.size} unresolved node_modules links during package copy.`);
}

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
  ignore: (candidate) => shouldIgnorePackagedAppPath(candidate, ROOT, { danglingNodeModulePaths }),
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
const missingDependencies = [];
for (const name of Object.keys(packageJson.dependencies ?? {})) {
  try {
    JSON.parse(extractFile(archivePath, join('node_modules', name, 'package.json')).toString('utf8'));
  } catch {
    missingDependencies.push(name);
  }
}
if (missingDependencies.length) {
  throw new Error(`Packaged ASAR is missing production dependency manifests: ${missingDependencies.join(', ')}`);
}
await mkdir(dirname(appDir), { recursive: true });
await rm(appDir, { recursive: true, force: true });
await rename(expectedStage, appDir);
console.log(`Windows app staged at ${appDir}`);

if (process.argv.includes('--installer')) {
  const outFile = join(outputDir, `Win-Box.Setup.${version}.exe`);
  const nsiPath = join(stagingDir, 'win-box-installer.nsi');
  const nsi = await buildInstallerScript({ appDir, outFile, version, license: join(ROOT, 'LICENSE'), icon: join(ROOT, 'build', 'icon.ico') });
  await mkdir(dirname(nsiPath), { recursive: true });
  await writeFile(nsiPath, `\uFEFF${nsi}`, 'utf8');
  await compileNsis(nsiPath, { cwd: ROOT });
  console.log(`Windows installer created at ${outFile}`);
}
