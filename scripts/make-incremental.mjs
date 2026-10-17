import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { finished } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { extractFile } from '@electron/asar';
import { TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { compileNsis } from './nsis-tool.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    old: { type: 'string' },
    new: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});

if (!values.old || !values.new || !values.out) {
  throw new Error('Usage: node scripts/make-incremental.mjs --old <old-win-unpacked> --new <new-win-unpacked> --out <artifact-name>');
}

const oldDir = resolve(values.old);
const newDir = resolve(values.new);
const outName = values.out.trim();
if (!/^[\p{L}\p{N} ._()-]+$/u.test(outName) || outName === '.' || outName === '..') {
  throw new Error('The output name may contain letters, numbers, spaces, dots, parentheses, underscores and hyphens.');
}

async function requireDirectory(path) {
  if (!(await stat(path)).isDirectory()) throw new Error(`Not a directory: ${path}`);
}

async function readVersion(unpackedDir) {
  const archive = join(unpackedDir, 'resources', 'app.asar');
  const pkg = JSON.parse(extractFile(archive, 'package.json').toString('utf8'));
  const version = String(pkg.version ?? '');
  if (!/^\d+\.\d+\.\d+(?:\.[0-9]+)?(?:-[\da-z.-]+)?$/i.test(version)) {
    throw new Error(`Unexpected app.asar version: ${version}`);
  }
  return version;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function collectFiles(root) {
  const files = new Map();
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await lstat(absolute);
        const path = relative(root, absolute).split(sep).join('/');
        files.set(path, { absolute, size: info.size, mtime: info.mtime, hash: await hashFile(absolute) });
      } else if (entry.isSymbolicLink()) {
        throw new Error(`Packaged applications must not contain symbolic links: ${absolute}`);
      }
    }
  }
  await walk(root);
  return files;
}

function asNsiString(value) {
  return value.replaceAll('$', '$$').replaceAll('"', '$"');
}

function nsisVersion(version) {
  const parts = version.split('-')[0].split('.').map(Number);
  if (parts.length > 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 65535)) {
    throw new Error(`Version cannot be encoded in Windows installer resources: ${version}`);
  }
  while (parts.length < 4) parts.push(0);
  return parts.join('.');
}

function createInstallCommands(changedFiles, removedFiles) {
  const commands = [];
  for (const file of changedFiles) {
    const slash = file.path.lastIndexOf('/');
    const directory = slash === -1 ? '' : file.path.slice(0, slash).replaceAll('/', '\\');
    const filename = slash === -1 ? file.path : file.path.slice(slash + 1);
    const destination = directory ? `$INSTDIR\\${asNsiString(directory)}` : '$INSTDIR';
    commands.push(`  SetOutPath "${destination}"`);
    commands.push(`  File /oname=${asNsiString(filename)} "${asNsiString(file.absolute)}"`);
  }
  for (const path of removedFiles) commands.push(`  Delete "$INSTDIR\\${asNsiString(path.replaceAll('/', '\\'))}"`);
  return commands.join('\n');
}

async function writeZip(path, changedFiles, readme) {
  const output = createWriteStream(path, { flags: 'w' });
  const outputFinished = finished(output);
  const zip = new ZipWriter(Writable.toWeb(output), { level: 9, useCompressionStream: false, zip64: true });
  try {
    for (const file of changedFiles) {
      await zip.add(`diff/${file.path}`, Readable.toWeb(createReadStream(file.absolute)), { lastModDate: file.mtime });
    }
    await zip.add('说明.txt', new TextReader(readme));
    await zip.close();
    await outputFinished;
  } catch (error) {
    output.destroy(error);
    await outputFinished.catch(() => undefined);
    throw error;
  }
}

await Promise.all([requireDirectory(oldDir), requireDirectory(newDir)]);
const [version, oldFiles, newFiles] = await Promise.all([
  readVersion(newDir),
  collectFiles(oldDir),
  collectFiles(newDir),
]);
const changedFiles = [];
for (const [path, current] of newFiles) {
  const previous = oldFiles.get(path);
  if (!previous || previous.size !== current.size || previous.hash !== current.hash) {
    changedFiles.push({ path, ...current });
  }
}
const removedFiles = [...oldFiles.keys()].filter((path) => !newFiles.has(path)).sort();
const fullBytes = [...newFiles.values()].reduce((sum, file) => sum + file.size, 0);
const changedBytes = changedFiles.reduce((sum, file) => sum + file.size, 0);
console.log(`Version ${version}: ${oldFiles.size} old files, ${newFiles.size} new files, ${changedFiles.length} changed, ${removedFiles.length} removed.`);
console.log(`Changed data: ${(changedBytes / 1024 / 1024).toFixed(1)} MiB of ${(fullBytes / 1024 / 1024).toFixed(1)} MiB.`);

const releaseDir = join(ROOT, `release${version}`);
const installerPath = join(releaseDir, `${outName}.exe`);
const zipPath = join(releaseDir, `${outName}.zip`);
const icon = join(ROOT, 'build', 'icon.ico');
await mkdir(releaseDir, { recursive: true });
if (!(await stat(icon)).isFile()) throw new Error(`Missing application icon: ${icon}`);

const installCommands = createInstallCommands(changedFiles, removedFiles);
const escapedVersion = asNsiString(version);
const uninstallScan = `
!macro FIND_INSTALL_DIR HIVE
  StrCpy $0 0
  __HIVE__find_loop:
    EnumRegKey $1 __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" $0
    StrCmp $1 "" __HIVE__find_no
    ReadRegStr $2 __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$1" "DisplayName"
    Push $2
    Call StrContainsWinBox
    Pop $3
    StrCmp $3 "" __HIVE__find_next
    ReadRegStr $4 __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$1" "InstallLocation"
    StrCmp $4 "" __HIVE__find_next
    IfFileExists "$4\\Win-Box.exe" 0 __HIVE__find_next
    StrCpy $INSTDIR $4
    Goto found
  __HIVE__find_next:
    IntOp $0 $0 + 1
    Goto __HIVE__find_loop
  __HIVE__find_no:
!macroend

Function .onInit
  SetRegView 64
  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\Win-Box"
  IfFileExists "$INSTDIR\\Win-Box.exe" found
  StrCpy $INSTDIR "$PROGRAMFILES64\\Win-Box"
  IfFileExists "$INSTDIR\\Win-Box.exe" found
  StrCpy $INSTDIR "$PROGRAMFILES\\Win-Box"
  IfFileExists "$INSTDIR\\Win-Box.exe" found
  StrCpy $INSTDIR ""
  !insertmacro FIND_INSTALL_DIR HKCU
  StrCmp $INSTDIR "" 0 found
  !insertmacro FIND_INSTALL_DIR HKLM
  StrCmp $INSTDIR "" 0 found
  MessageBox MB_OK|MB_ICONSTOP "No Win-Box installation was found. Install Win-Box before applying this update."
  Abort
  found:
FunctionEnd

Function StrContainsWinBox
  Exch $R0
  Push $R1
  StrCpy $R1 0
  loop:
    StrCpy $R2 $R0 7 $R1
    StrCmp $R2 "" no
    StrCmp $R2 "Win-Box" yes
    IntOp $R1 $R1 + 1
    Goto loop
  yes:
    StrCpy $R0 "1"
    Goto end
  no:
    StrCpy $R0 ""
  end:
    Pop $R1
    Exch $R0
FunctionEnd

!macro UPDATE_REG_VERSION HIVE
  StrCpy $0 0
  __HIVE__reg_loop:
    EnumRegKey $1 __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" $0
    StrCmp $1 "" __HIVE__reg_done
    ReadRegStr $2 __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$1" "DisplayName"
    Push $2
    Call StrContainsWinBox
    Pop $3
    StrCmp $3 "" __HIVE__reg_next
    WriteRegStr __HIVE__ "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$1" "DisplayVersion" "${escapedVersion}"
    Goto __HIVE__reg_done
  __HIVE__reg_next:
    IntOp $0 $0 + 1
    Goto __HIVE__reg_loop
  __HIVE__reg_done:
!macroend

Function UpdateRegVersion
  !insertmacro UPDATE_REG_VERSION HKCU
  !insertmacro UPDATE_REG_VERSION HKLM
FunctionEnd`.replaceAll('__HIVE__', '${HIVE}');

const nsi = `Unicode True
SetCompressor /SOLID lzma
!include "MUI2.nsh"

Name "Win-Box update ${escapedVersion}"
OutFile "${asNsiString(installerPath)}"
InstallDir "$LOCALAPPDATA\\Programs\\Win-Box"
Icon "${asNsiString(icon)}"
RequestExecutionLevel user
VIProductVersion "${nsisVersion(version)}"
VIAddVersionKey "ProductName" "Win-Box"
VIAddVersionKey "ProductVersion" "${escapedVersion}"
VIAddVersionKey "FileVersion" "${escapedVersion}"
VIAddVersionKey "FileDescription" "Win-Box offline update"

${uninstallScan}

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Update"
  nsExec::ExecToLog 'taskkill /f /im Win-Box.exe'
  Pop $0
${installCommands}
  Call UpdateRegVersion
SectionEnd
`;

const tempDir = await mkdtemp(join(ROOT, '.tmp', 'incremental-'));
try {
  const script = join(tempDir, 'update.nsi');
  await writeFile(script, `\uFEFF${nsi}`, 'utf8');
  await compileNsis(script, { cwd: tempDir });
  const readme = `Win-Box 离线增量更新包（${outName}）\n\n推荐方式：运行 ${outName}.exe，自动查找已安装目录并覆盖变更文件。\n手动方式：把本 zip 内 diff/ 解压覆盖到安装目录（先退出 Win-Box）。\n个人数据保存在 %APPDATA%\\win-box，不受此更新影响。\n`;
  await writeZip(zipPath, changedFiles, readme);
} finally {
  const rel = relative(ROOT, tempDir);
  if (rel.startsWith(`.tmp${sep}`)) await rm(tempDir, { recursive: true, force: true });
}

console.log(`Incremental installer: ${installerPath}`);
console.log(`Manual update archive: ${zipPath}`);
