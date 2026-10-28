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

function lockCheck(prefix, files) {
  const verb = prefix ? '卸载' : '安装';
  const existingFileChecks = files.map((path, index) => {
    const target = `$INSTDIR\\${quote(path.replaceAll('/', '\\'))}`;
    const label = `${prefix ? 'un_' : ''}lock_file_${index}`;
    return `  IfFileExists "${target}" 0 ${label}_next
  ClearErrors
  FileOpen $0 "${target}" a
  IfErrors ${label}_busy
  FileClose $0
  Goto ${label}_next
  ${label}_busy:
  IfSilent ${label}_silent
  MessageBox MB_OK|MB_ICONSTOP "程序文件无法安全替换（可能被占用或无写入权限）：${target}。${verb}已取消；请关闭占用程序或检查目录权限后再运行。"
  ${label}_silent:
  StrCpy $R4 "1"
  Return
  ${label}_next:`;
  }).join('\n');
  return `Function ${prefix}CheckInstallFiles
  IfFileExists "$INSTDIR\\Win-Box.exe" 0 check_remaining_files
  Call ${prefix}CloseRunningWinBox
  StrCmp $R4 "0" continue_after_close
  Return
  continue_after_close:
  StrCpy $1 0
  StrCpy $3 0
  retry:
  IfFileExists "$INSTDIR\\Win-Box.exe" 0 done
  ClearErrors
  FileOpen $0 "$INSTDIR\\Win-Box.exe" a
  IfErrors busy
  FileClose $0
  Goto check_remaining_files
  busy:
  IntOp $1 $1 + 1
  IntCmp $1 50 report_busy retry_wait report_busy
  retry_wait:
  Sleep 100
  Goto retry
  report_busy:
  IfSilent silent
  StrCmp $3 "1" still_busy
  StrCpy $3 1
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "Win-Box 正在运行或程序文件仍被占用。选择“是”，立即停止此安装目录中的 Win-Box 并继续${verb}；选择“否”取消。强制停止可能丢失未保存的数据。" IDYES stop_process IDNO cancel
  stop_process:
${runPowerShell('force')}
  Sleep 700
  StrCpy $1 0
  Goto retry
  still_busy:
  MessageBox MB_OK|MB_ICONSTOP "程序文件仍被占用，可能有其他程序正在使用。${verb}已取消；关闭占用程序后再运行安装器。"
  StrCpy $R4 "1"
  Return
  cancel:
  StrCpy $R4 "1"
  Return
  silent:
  StrCpy $R4 "1"
  Return
  check_remaining_files:
${existingFileChecks}
  ${prefix ? '' : `StrCmp $R3 "1" 0 done
  Call CheckLegacyInstallFiles
  StrCmp $R4 "0" 0 done
  Call UninstallExisting
  StrCmp $R4 "0" done
  Return
  `}done:
FunctionEnd`;
}

const psCommand = command => Buffer.from(command, 'utf16le').toString('base64');
// NSIS launches 32-bit PowerShell, where Get-Process.Path is null for 64-bit app processes.
const targetProcess = `gwmi Win32_Process -Filter "Name='Win-Box.exe'"|?{$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE}|%{gps -Id $_.ProcessId -EA 0}`;
const closeAppCommands = {
  check: psCommand(`if((${targetProcess})){exit 1};exit 0`),
  graceful: psCommand(`$p=@(${targetProcess});$w=@($p|?{$_.MainWindowHandle.ToInt64()});if($w.Count -ne $p.Count){exit 2};foreach($x in $w){if(!$x.CloseMainWindow() -or !$x.WaitForExit(10000)){exit 2}};exit 0`),
  force: psCommand(`$p=@(${targetProcess});if(!$p.Count){exit 3};foreach($x in $p){kill -Id $x.Id -Force -EA 0;try{Wait-Process -Id $x.Id -Timeout 2 -EA Stop}catch{exit 4}};exit 0`),
};
const legacyFilePreflight = psCommand('$r=$env:WINBOX_INSTALL_DIR;$b=$false;try{gci -LiteralPath $r -Force -File -Recurse -EA Stop|?{$_.FullName -notlike "$r\\data\\*"}|%{try{$h=[IO.File]::Open($_.FullName,"Open","ReadWrite","None");$h.Dispose()}catch{$b=$true}}}catch{$b=$true};if($b){exit 1};exit 0');

function runPowerShell(mode) {
  return `  System::Call 'kernel32::SetEnvironmentVariableW(w "WINBOX_CLOSE_MODE", w "${mode}") i .r0'
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${closeAppCommands[mode]}'
  Pop $2`;
}

function closeRunningApp(prefix, labelPrefix) {
  const unableToStop = prefix
    ? '卸载程序无法停止 Win-Box。卸载已中止；请先关闭 Win-Box，再运行卸载程序。'
    : '安装程序无法停止 Win-Box。安装已中止；请先关闭 Win-Box，再运行安装器。';
  const choice = prefix
    ? `  MessageBox MB_YESNO|MB_ICONQUESTION "检测到此安装目录中的 Win-Box 正在运行。选择“是”让安装程序请求正常退出并继续卸载；选择“否”取消卸载。" IDYES ${labelPrefix}_graceful IDNO ${labelPrefix}_cancel`
    : `  Goto ${labelPrefix}_graceful`;
  const afterClose = `  Goto ${labelPrefix}_done`;
  const noProcess = `  Goto ${labelPrefix}_done`;
  return `Function ${prefix}CloseRunningWinBox
  System::Call 'kernel32::SetEnvironmentVariableW(w "WINBOX_INSTALL_EXE", w "$INSTDIR\\Win-Box.exe") i .r0'
  ${labelPrefix}_check:
${runPowerShell('check')}
  StrCmp $2 "0" ${labelPrefix}_not_running
  StrCmp $2 "1" ${labelPrefix}_found
  Goto ${labelPrefix}_manual
  ${labelPrefix}_not_running:
${noProcess}
  ${labelPrefix}_found:
  IfSilent ${labelPrefix}_graceful
${choice}
  ${labelPrefix}_graceful:
${runPowerShell('graceful')}
  StrCmp $2 "0" ${labelPrefix}_closed
  StrCmp $2 "3" ${labelPrefix}_closed
  StrCmp $2 "2" ${labelPrefix}_force_prompt
  Goto ${labelPrefix}_force
  ${labelPrefix}_force_prompt:
  ${prefix ? `MessageBox MB_YESNO|MB_ICONEXCLAMATION "Win-Box 在 10 秒内没有正常退出。是否强制结束并继续卸载？强制结束可能丢失尚未保存的操作。" IDYES ${labelPrefix}_force IDNO ${labelPrefix}_cancel` : `Goto ${labelPrefix}_force`}
  ${labelPrefix}_force:
${runPowerShell('force')}
  StrCmp $2 "0" ${labelPrefix}_closed
  StrCmp $2 "3" ${labelPrefix}_closed
  Goto ${labelPrefix}_manual
  ${labelPrefix}_closed:
${afterClose}
  ${labelPrefix}_manual:
  IfSilent ${labelPrefix}_manual_silent
  MessageBox MB_OK|MB_ICONSTOP "${unableToStop}"
  ${labelPrefix}_manual_silent:
  StrCpy $R4 "1"
  Goto ${labelPrefix}_done
  ${labelPrefix}_cancel:
  StrCpy $R4 "1"
  Goto ${labelPrefix}_done
  ${labelPrefix}_done:
  Return
FunctionEnd`;
}

function installModePage() {
  return `Var InstallModeDirectRadio
Var InstallModeUninstallRadio
Function InstallModePage
  IfSilent install_mode_skip
  IfFileExists "$INSTDIR\\Win-Box.exe" 0 install_mode_skip
  System::Call 'kernel32::SetEnvironmentVariableW(w "WINBOX_INSTALL_EXE", w "$INSTDIR\\Win-Box.exe") i .r0'
${runPowerShell('check')}
  StrCmp $2 "0" install_mode_skip
  StrCmp $2 "1" install_mode_show
  Goto install_mode_show
  install_mode_show:
  nsDialogs::Create 1018
  Pop $0
  StrCmp $0 error install_mode_dialog_error
  \${NSD_CreateLabel} 0 0 100% 42u "继续后安装器会先尝试关闭 Win-Box；10 秒内未退出会强制结束并继续。强制结束可能丢失未保存的数据，请先保存。"
  Pop $0
  \${NSD_CreateRadioButton} 0 50u 100% 24u "停止 Win-Box 并一键覆盖安装（推荐）"
  Pop $InstallModeDirectRadio
  \${NSD_Check} $InstallModeDirectRadio
  \${NSD_CreateRadioButton} 0 80u 100% 40u "停止 Win-Box，先卸载旧版再安装。data 会备份并恢复，其他个人文件会保留。"
  Pop $InstallModeUninstallRadio
  nsDialogs::Show
  Goto install_mode_done
  install_mode_dialog_error:
  IfSilent install_mode_skip
  MessageBox MB_OK|MB_ICONSTOP "无法显示安装方式选择页。安装已停止，请重新运行安装器。"
  Quit
  install_mode_skip:
  StrCpy $R3 "0"
  Abort
  install_mode_done:
FunctionEnd
Function InstallModeLeave
  \${NSD_GetState} $InstallModeUninstallRadio $0
  StrCmp $0 "1" 0 install_mode_direct
  StrCpy $R3 "1"
  Return
  install_mode_direct:
  StrCpy $R3 "0"
FunctionEnd`;
}

function legacyInstallFilesPreflight() {
  return `Function CheckLegacyInstallFiles
  System::Call 'kernel32::SetEnvironmentVariableW(w "WINBOX_INSTALL_DIR", w "$INSTDIR") i .r0'
  nsExec::Exec '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${legacyFilePreflight}'
  Pop $2
  StrCmp $2 "0" done
  IfSilent silent
  MessageBox MB_OK|MB_ICONSTOP "无法确认旧版程序文件都可安全卸载（文件可能被占用或权限不足）。不会调用旧版卸载器；旧版文件和 data 数据未更改，安装已取消。关闭占用程序或检查目录权限后再运行安装器。"
  silent:
  StrCpy $R4 "1"
  done:
FunctionEnd`;
}

function uninstallExisting(prefix, labelPrefix) {
  return `Function ${prefix}UninstallExisting
  IfFileExists "$INSTDIR\\Uninstall.exe" 0 ${labelPrefix}_done
  StrCpy $R2 "0"
  IfFileExists "$INSTDIR\\data\\*.*" 0 ${labelPrefix}_run
  GetFullPathName $R0 "$INSTDIR\\.."
  GetTempFileName $R1 "$R0"
  IfErrors ${labelPrefix}_backup_failed
  Delete "$R1"
  CreateDirectory "$R1"
  IfErrors ${labelPrefix}_backup_failed
  Rename "$INSTDIR\\data" "$R1\\data"
  IfErrors ${labelPrefix}_backup_failed
  StrCpy $R2 "1"
  ${labelPrefix}_run:
  InitPluginsDir
  Delete "$PLUGINSDIR\\Win-Box-Uninstall.exe"
  ClearErrors
  CopyFiles /SILENT "$INSTDIR\\Uninstall.exe" "$PLUGINSDIR\\Win-Box-Uninstall.exe"
  IfErrors ${labelPrefix}_uninstall_failed
  ClearErrors
  ExecWait '"$PLUGINSDIR\\Win-Box-Uninstall.exe" /S _?=$INSTDIR' $2
  IfErrors ${labelPrefix}_uninstall_failed
  StrCmp $2 "0" 0 ${labelPrefix}_uninstall_failed
  StrCmp $R2 "1" ${labelPrefix}_restore_data ${labelPrefix}_done
  ${labelPrefix}_restore_data:
  CreateDirectory "$INSTDIR"
  ClearErrors
  Rename "$R1\\data" "$INSTDIR\\data"
  IfErrors ${labelPrefix}_restore_failed
  RMDir "$R1"
  Goto ${labelPrefix}_done
  ${labelPrefix}_backup_failed:
  Delete "$R1"
  RMDir "$R1"
  Goto ${labelPrefix}_show_failure
  ${labelPrefix}_uninstall_failed:
  StrCmp $R2 "1" ${labelPrefix}_restore_after_failure ${labelPrefix}_show_failure
  ${labelPrefix}_restore_after_failure:
  CreateDirectory "$INSTDIR"
  ClearErrors
  Rename "$R1\\data" "$INSTDIR\\data"
  IfErrors ${labelPrefix}_restore_failed
  RMDir "$R1"
  ${labelPrefix}_show_failure:
  IfSilent ${labelPrefix}_silent
  MessageBox MB_OK|MB_ICONSTOP "卸载旧版未能安全完成，安装已停止。已保护现有 data 数据；请重新运行安装器。"
  StrCpy $R4 "1"
  Return
  ${labelPrefix}_restore_failed:
  IfSilent ${labelPrefix}_silent
  MessageBox MB_OK|MB_ICONSTOP "无法恢复 data 用户数据。备份仍位于：$R1\\data。请勿删除该目录。"
  StrCpy $R4 "1"
  Return
  ${labelPrefix}_silent:
  StrCpy $R4 "1"
  Return
  ${labelPrefix}_done:
  Return
FunctionEnd`;
}

/** Isolated installers execute the same file operations and omit desktop/registry integration. */
export async function buildInstallerScript({
  appDir,
  outFile,
  icon,
  license,
  version,
  isolatedInstallDir,
  acceptanceUninstallFirst = false,
  acceptanceIntegration = false,
  acceptanceRegistryKey,
  acceptanceDesktopDirectory,
}) {
  const parts = version.split('-')[0].split('.').map(Number);
  if (parts.length > 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 65535)) throw new Error(`Invalid Windows version: ${version}`);
  while (parts.length < 4) parts.push(0);
  if (acceptanceIntegration) {
    if (!isolatedInstallDir || !acceptanceDesktopDirectory) throw new Error('Acceptance integration requires an isolated install and desktop directory.');
    if (!/^Software\\WinBoxAcceptance\\[A-Za-z0-9_-]+$/.test(acceptanceRegistryKey || '')) throw new Error('Acceptance integration requires a unique WinBoxAcceptance registry key.');
  }
  const manifest = await packagedFiles(appDir);
  const registry = acceptanceIntegration
    ? acceptanceRegistryKey
    : 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Win-Box';
  const setupIntegrationEnabled = !isolatedInstallDir || acceptanceIntegration;
  const desktopShortcut = acceptanceIntegration
    ? `"${quote(join(acceptanceDesktopDirectory, 'Win-Box.lnk'))}"`
    : '"$DESKTOP\\Win-Box.lnk"';
  const uninstallString = String.raw`'$\"$INSTDIR\Uninstall.exe$\"'`;
  const setupIntegration = setupIntegrationEnabled ? `
  CreateShortcut ${desktopShortcut} "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "${registry}" "DisplayName" "Win-Box"
  WriteRegStr HKCU "${registry}" "DisplayVersion" "${quote(version)}"
  WriteRegStr HKCU "${registry}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${registry}" "DisplayIcon" "$INSTDIR\\Win-Box.exe"
  WriteRegStr HKCU "${registry}" "UninstallString" ${uninstallString}` : '';
  const uninstallIntegration = setupIntegrationEnabled ? `
  ReadRegStr $0 HKCU "${registry}" "InstallLocation"
  StrCmp $0 "$INSTDIR" 0 keep_other_installation
  Delete ${desktopShortcut}
  DeleteRegKey HKCU "${registry}"
  keep_other_installation:` : '';
  const deletes = manifest.files.map(path => `  Delete "$INSTDIR\\${quote(path.replaceAll('/', '\\'))}"`).join('\n');
  const removeDirectories = manifest.directories.map(path => `  RMDir "$INSTDIR\\${quote(path.replaceAll('/', '\\'))}"`).join('\n');
  const installDir = isolatedInstallDir ? quote(isolatedInstallDir) : '$LOCALAPPDATA\\Programs\\Win-Box';
  return `Unicode True
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\Win-Box.exe"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "卸载会移除 Win-Box 程序文件和快捷方式；安装目录中的 data（设置、观看记录、登录信息等）及其他个人文件会保留。"
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
Page custom InstallModePage InstallModeLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
${lockCheck('', manifest.files)}
${lockCheck('un.', manifest.files)}
${installModePage()}
${closeRunningApp('', 'install_close')}
${closeRunningApp('un.', 'uninstall_close')}
${uninstallExisting('', 'install_uninstall')}
${uninstallExisting('un.', 'uninstaller_uninstall')}
${legacyInstallFilesPreflight()}
Section "Win-Box"
  StrCpy $R4 "0"
  Call CheckInstallFiles
  StrCmp $R4 "0" 0 install_section_abort
  ${acceptanceUninstallFirst ? 'Call CheckLegacyInstallFiles\n  StrCmp $R4 "0" 0 install_section_abort\n  Call UninstallExisting\n  StrCmp $R4 "0" 0 install_section_abort' : ''}
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${quote(appDir)}\\*"
  IfErrors 0 files_installed
  SetErrorLevel 21
  Abort
  files_installed:
  WriteUninstaller "$INSTDIR\\Uninstall.exe"${setupIntegration}
  Goto install_section_complete
  install_section_abort:
  SetErrorLevel 22
  Abort
  install_section_complete:
SectionEnd
Section "Uninstall"
  StrCpy $R4 "0"
  Call un.CheckInstallFiles
  StrCmp $R4 "0" 0 uninstall_section_abort
${uninstallIntegration}
${deletes}
${removeDirectories}
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
  Goto uninstall_section_complete
  uninstall_section_abort:
  SetErrorLevel 23
  Abort
  uninstall_section_complete:
SectionEnd
`;
}
