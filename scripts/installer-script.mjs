import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

function quote(value) {
  if (/[\r\n]/.test(value)) throw new Error('NSIS paths must fit on one line.');
  return value.replaceAll('$', '$$').replaceAll('"', '$\\"');
}

async function packagedFiles(directory, prefix = '') {
  const files = [];
  const directories = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && ['data', 'winbox-cache', 'Uninstall.exe'].includes(entry.name)) throw new Error(`Packaged files overlap user data: ${path}`);
    if (entry.isDirectory()) {
      const nested = await packagedFiles(join(directory, entry.name), path);
      files.push(...nested.files);
      directories.push(path, ...nested.directories);
    } else if (entry.isFile()) files.push(path);
    else throw new Error(`Packaged file is a link or unsupported entry: ${path}`);
  }
  return { files: files.sort(), directories: directories.sort((left, right) => right.split('/').length - left.split('/').length || left.localeCompare(right)) };
}

function lockCheck(prefix) {
  return `Function ${prefix}CheckInstallFiles
  StrCpy $1 0
  retry:
  IfFileExists "$INSTDIR\\Win-Box.exe" 0 done
  ClearErrors
  FileOpen $0 "$INSTDIR\\Win-Box.exe" a
  IfErrors busy
  FileClose $0
  Goto done
  busy:
  IntOp $1 $1 + 1
  IntCmp $1 50 report_busy retry_wait report_busy
  retry_wait:
  Sleep 100
  Goto retry
  report_busy:
  IfSilent silent
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请关闭此安装目录中的 Win-Box 后重试。" IDRETRY retry
  Abort
  silent:
  SetErrorLevel 20
  Abort
  done:
FunctionEnd`;
}

/** Isolated installers execute the same file operations and omit desktop/registry integration. */
export async function buildInstallerScript({ appDir, outFile, icon, license, version, isolatedInstallDir }) {
  const parts = version.split('-')[0].split('.').map(Number);
  if (parts.length > 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 65535)) throw new Error(`Invalid Windows version: ${version}`);
  while (parts.length < 4) parts.push(0);
  const manifest = await packagedFiles(appDir);
  const registry = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box';
  const setupIntegration = isolatedInstallDir ? '' : `
  CreateShortcut "$DESKTOP\\Win-Box.lnk" "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "${registry}" "DisplayName" "Win-Box"
  WriteRegStr HKCU "${registry}" "DisplayVersion" "${quote(version)}"
  WriteRegStr HKCU "${registry}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${registry}" "DisplayIcon" "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "${registry}" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'`;
  const uninstallIntegration = isolatedInstallDir ? '' : `
  ReadRegStr $0 HKCU "${registry}" "InstallLocation"
  StrCmp $0 "$INSTDIR" 0 keep_other_installation
  Delete "$DESKTOP\\Win-Box.lnk"
  DeleteRegKey HKCU "${registry}"
  keep_other_installation:`;
  const deletes = manifest.files.map(path => `  Delete "$INSTDIR\\${quote(path.replaceAll('/', '\\'))}"`).join('\n');
  const removeDirectories = manifest.directories.map(path => `  RMDir "$INSTDIR\\${quote(path.replaceAll('/', '\\'))}"`).join('\n');
  const installDir = isolatedInstallDir ? quote(isolatedInstallDir) : '$LOCALAPPDATA\\Programs\\Win-Box';
  return `Unicode True
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Win-Box.exe"
Name "Win-Box ${quote(version)}"
OutFile "${quote(outFile)}"
InstallDir "${installDir}"
${isolatedInstallDir ? '' : `InstallDirRegKey HKCU "${registry}" "InstallLocation"`}
RequestExecutionLevel user
Icon "${quote(icon)}"
VIProductVersion "${parts.join('.')}"
VIAddVersionKey "ProductName" "Win-Box"
VIAddVersionKey "ProductVersion" "${quote(version)}"
VIAddVersionKey "FileVersion" "${quote(version)}"
VIAddVersionKey "FileDescription" "Win-Box installer"
VIAddVersionKey "LegalCopyright" "Win-Box"
!insertmacro MUI_PAGE_LICENSE "${quote(license)}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
${lockCheck('')}
${lockCheck('un.')}
Section "Win-Box"
  Call CheckInstallFiles
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${quote(appDir)}\\*"
  IfErrors 0 files_installed
  SetErrorLevel 21
  Abort
  files_installed:
  WriteUninstaller "$INSTDIR\\Uninstall.exe"${setupIntegration}
SectionEnd
Section "Uninstall"
  Call un.CheckInstallFiles${uninstallIntegration}
${deletes}
${removeDirectories}
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
`;
}
