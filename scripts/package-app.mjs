import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizePackagedApp } from './after-pack.mjs';
import { compileNsis } from './nsis-tool.mjs';
import { assertReleaseAssets } from './verify-release-assets.mjs';

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

function shouldIgnore(candidate) {
  // Packager's current copy filter passes app-relative paths, while its type comment says absolute.
  const value = candidate.replaceAll('\\', '/');
  const absolute = /^[A-Za-z]:\//.test(value) || value.startsWith('//');
  const rel = absolute
    ? relative(ROOT, candidate).split(sep).join('/')
    : value.replace(/^\/+/, '');
  if (absolute && (rel === '..' || rel.startsWith('../') || isAbsolute(rel))) return true;
  if (rel === '.' || rel === '') return false;
  if (rel === 'package.json' || rel === 'LICENSE' || rel === 'LICENSE.txt') return false;
  if (rel === 'node_modules/.bin' || rel.startsWith('node_modules/.bin/')) return true;
  if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
  if (!/^(dist|resources)(\/|$)/.test(rel)) return true;
  if (!rel.startsWith('resources/')) return false;
  const parts = rel.split('/');
  const filename = parts.at(-1) ?? '';
  return parts.some((part) => ['.tmp', 'stubs-src', 'tools', '__pycache__'].includes(part)) ||
    filename === 'jython-standalone-2.7.3.jar' || /^(?:hs_err_pid|replay_pid).*\.log$/i.test(filename);
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
  out: stagingDir,
  overwrite: true,
  prune: true,
  asar: { unpackDir: 'resources' },
  ignore: shouldIgnore,
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
  const versionParts = version.split('-')[0].split('.').map(Number);
  if (versionParts.length > 4 || versionParts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new Error(`Version cannot be represented in a Windows version resource: ${version}`);
  }
  while (versionParts.length < 4) versionParts.push(0);
  const version4 = versionParts.join('.');
  const outFile = join(outputDir, `Win-Box Setup ${version}.exe`);
  const license = join(ROOT, 'LICENSE');
  const nsiPath = join(stagingDir, 'win-box-installer.nsi');
  const q = (value) => value.replaceAll('"', '""');
  const nsi = `Unicode True
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Win-Box.exe"

Name "Win-Box ${version}"
OutFile "${q(outFile)}"
InstallDir "$LOCALAPPDATA\\Programs\\Win-Box"
InstallDirRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "InstallLocation"
RequestExecutionLevel user
Icon "${q(join(ROOT, 'build', 'icon.ico'))}"
VIProductVersion "${version4}"
VIAddVersionKey "ProductName" "Win-Box"
VIAddVersionKey "ProductVersion" "${version}"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "FileDescription" "Win-Box installer"
VIAddVersionKey "LegalCopyright" "Win-Box"

!insertmacro MUI_PAGE_LICENSE "${q(license)}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Win-Box"
  nsExec::ExecToLog 'taskkill /f /im Win-Box.exe'
  Pop $0
  SetOutPath "$INSTDIR"
  File /r "${q(appDir)}\\*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortcut "$DESKTOP\\Win-Box.lnk" "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "DisplayName" "Win-Box"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "DisplayIcon" "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box" "UninstallString" '"$INSTDIR\\Uninstall.exe"'
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\\Win-Box.lnk"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box"
  RMDir /r "$INSTDIR"
SectionEnd
`;
  await mkdir(dirname(nsiPath), { recursive: true });
  await writeFile(nsiPath, `\uFEFF${nsi}`, 'utf8');
  await compileNsis(nsiPath, { cwd: ROOT });
  console.log(`Windows installer created at ${outFile}`);
}
