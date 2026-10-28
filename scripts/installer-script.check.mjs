import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallerScript } from './installer-script.mjs';
import { installationAcceptanceWorkspacePrefix, verifyInstallation } from './verify-installation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, '.tmp'), { recursive: true });

async function fixture({ runnable = false } = {}) {
  const path = await mkdtemp(join(root, '.tmp', 'installer-fixture-'));
  await mkdir(join(path, 'resources'), { recursive: true });
  if (runnable) await copyFile(process.execPath, join(path, 'Win-Box.exe'));
  else await writeFile(join(path, 'Win-Box.exe'), 'MZ test executable payload');
  await writeFile(join(path, 'resources', 'app.asar'), 'old application archive');
  return path;
}
const options = appDir => ({ appDir, outFile: join(root, '.tmp', 'test-setup.exe'), icon: join(root, 'build/icon.ico'), license: join(root, 'LICENSE'), version: '1.22.0' });

test('production uninstall enumerates packaged files and preserves data and other installations', async () => {
  const path = await fixture();
  try {
    const script = await buildInstallerScript(options(path));
    assert.ok(script.includes('Delete "$INSTDIR\\resources\\app.asar"'));
    assert.ok(script.includes('ReadRegStr $0 HKCU'));
    assert.ok(script.includes('StrCmp $0 "$INSTDIR" 0 keep_other_installation'));
    assert.ok(script.includes('MUI_UNCONFIRMPAGE_TEXT_TOP'));
    assert.ok(script.includes('data（设置、观看记录、登录信息等）及其他个人文件会保留'));
    assert.ok(!script.includes('taskkill'));
    assert.ok(!script.includes('MB_RETRYCANCEL'));
    assert.ok(!script.includes('重试'));
    assert.ok(!script.includes('RMDir /r'));
    assert.ok(!script.includes('Delete "$INSTDIR\\data'));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('running app offers update-in-place or data-preserving uninstall and reinstall', async () => {
  const path = await fixture();
  try {
    const script = await buildInstallerScript(options(path));
    assert.ok(script.includes('Page custom InstallModePage InstallModeLeave'));
    assert.ok(script.indexOf('!insertmacro MUI_PAGE_DIRECTORY') < script.indexOf('Page custom InstallModePage InstallModeLeave'));
    assert.ok(script.indexOf('Page custom InstallModePage InstallModeLeave') < script.indexOf('!insertmacro MUI_PAGE_INSTFILES'));
    assert.ok(script.includes('!include "nsDialogs.nsh"'));
    assert.ok(script.includes('install_mode_skip:\n  StrCpy $R3 "0"\n  Abort'));
    assert.ok(script.includes('停止 Win-Box 并一键覆盖安装（推荐）'));
    assert.ok(script.includes('停止 Win-Box，先卸载旧版再安装'));
    assert.ok(script.includes('MB_YESNO|MB_ICONEXCLAMATION'));
    assert.ok(script.includes('立即停止此安装目录中的 Win-Box 并继续安装'));
    assert.ok(script.includes('强制结束并继续'));
    assert.ok(script.includes('强制结束可能丢失尚未保存的操作'));
    assert.ok(script.includes('Call CloseRunningWinBox'));
    assert.ok(script.includes('Call un.CloseRunningWinBox'));
    assert.ok(script.includes('Call UninstallExisting'));
    assert.ok(script.includes('CopyFiles /SILENT "$INSTDIR\\Uninstall.exe" "$PLUGINSDIR\\Win-Box-Uninstall.exe"'));
    assert.ok(script.includes('ExecWait \'"$PLUGINSDIR\\Win-Box-Uninstall.exe" /S _?=$INSTDIR\''));
    assert.ok(script.includes('Rename "$INSTDIR\\data" "$R1\\data"'));
    assert.ok(script.includes('Rename "$R1\\data" "$INSTDIR\\data"'));
    assert.ok(script.includes('WindowsPowerShell\\v1.0\\powershell.exe'));
    const modePageStart = script.indexOf('Function InstallModePage\n');
    const modePageEnd = script.indexOf('\nFunctionEnd', modePageStart);
    const modeLeaveStart = script.indexOf('Function InstallModeLeave\n');
    const modeLeaveEnd = script.indexOf('\nFunctionEnd', modeLeaveStart);
    assert.ok(modePageStart >= 0 && modePageEnd > modePageStart && modeLeaveEnd > modeLeaveStart);
    assert.ok(!script.slice(modePageStart, modePageEnd).includes('CloseRunningWinBox'), 'opening the install-mode page must not stop the app');
    assert.ok(!script.slice(modeLeaveStart, modeLeaveEnd).includes('UninstallExisting'), 'leaving the install-mode page must not uninstall before the install section');
    assert.ok(!script.slice(modeLeaveStart, modeLeaveEnd).includes('File /r '), 'canceling before the install section must not extract package files');
    const encoded = [...script.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g)].map(match => match[1]);
    assert.equal(encoded.length, 10, 'expected install-page, file-lock, installer, uninstaller and legacy-file preflight commands');
    assert.ok(encoded.every(command => command.length < 900), `PowerShell commands must fit NSIS plugin command length limits: ${encoded.map(command => command.length).join(', ')}`);
    const [installLockForce, uninstallerLockForce, pageCheck, check, graceful, force] = encoded.slice(0, 6).map(command => Buffer.from(command, 'base64').toString('utf16le'));
    assert.ok(installLockForce.includes('kill -Id $x.Id -Force'));
    assert.ok(uninstallerLockForce.includes('Wait-Process -Id $x.Id -Timeout 2'));
    assert.ok(pageCheck.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
    assert.ok(check.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
    assert.ok(check.includes('gps -Id $_.ProcessId'));
    assert.ok(graceful.includes('CloseMainWindow'));
    assert.ok(graceful.includes('$_.MainWindowHandle.ToInt64()'));
    assert.ok(graceful.includes('!$x.CloseMainWindow() -or !$x.WaitForExit(10000)'));
    assert.ok(graceful.includes('WaitForExit(10000)'));
    assert.ok(force.includes('kill -Id $x.Id -Force'));
    assert.ok(force.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
    const legacyFileCheck = Buffer.from(encoded[9], 'base64').toString('utf16le');
    assert.ok(legacyFileCheck.includes('$env:WINBOX_INSTALL_DIR'));
    assert.ok(legacyFileCheck.includes('gci -LiteralPath'));
    assert.ok(legacyFileCheck.includes('FullName -notlike "$r\\data\\*"'), 'exclude user data from legacy package-file lock checks');
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('preflights every existing packaged file before overwrite and avoids retry prompts', async () => {
  const path = await fixture();
  try {
    const script = await buildInstallerScript(options(path));
    const installPreflight = script.indexOf('FileOpen $0 "$INSTDIR\\resources\\app.asar" a');
    const installCall = script.indexOf('Call CheckInstallFiles');
    const extraction = script.indexOf('File /r ');
    const uninstallPreflight = script.indexOf('FileOpen $0 "$INSTDIR\\resources\\app.asar" a', installPreflight + 1);
    const uninstallCall = script.indexOf('Call un.CheckInstallFiles');
    const deletion = script.indexOf('Delete "$INSTDIR\\resources\\app.asar"');

    assert.ok(installPreflight >= 0, 'installer checks the application archive for a conflicting file lock');
    assert.ok(installCall > installPreflight && extraction > installCall, 'installer runs all file-lock checks before copying application files');
    assert.ok(uninstallPreflight > installPreflight && uninstallCall > uninstallPreflight, 'uninstaller runs its file-lock check');
    assert.ok(deletion > uninstallCall, 'uninstaller checks locks before deleting application files');
    assert.ok(script.includes('程序文件无法安全替换（可能被占用或无写入权限）'));
    assert.ok(!script.includes('MB_RETRYCANCEL'));
    assert.ok(!script.includes('重试'));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('uninstall-first stops the app and preflights files before invoking the old uninstaller', async () => {
  const path = await fixture();
  try {
    const script = await buildInstallerScript(options(path));
    const start = script.indexOf('Function CheckInstallFiles\n');
    const end = script.indexOf('\nFunctionEnd', start);
    assert.ok(start >= 0 && end > start, 'installer preflight function is present');
    const check = script.slice(start, end);
    const closeApp = check.indexOf('Call CloseRunningWinBox');
    const fileOpens = [...check.matchAll(/FileOpen \$0 "[^"]+" a/g)].map(match => match.index);
    const legacyPreflight = check.indexOf('Call CheckLegacyInstallFiles');
    const uninstallOld = check.indexOf('Call UninstallExisting');

    assert.ok(closeApp >= 0 && closeApp < fileOpens[0], 'stop the same-directory app before checking files');
    assert.ok(fileOpens.length > 1, 'check the app executable and every existing packaged file');
    assert.ok(legacyPreflight > Math.max(...fileOpens) && legacyPreflight < uninstallOld, 'check legacy-only install files before invoking the old uninstaller');
    assert.ok(uninstallOld > Math.max(...fileOpens), 'do not invoke an older uninstaller until the new installer has checked every file for locks');
    assert.ok(check.includes('StrCmp $R3 "1"'), 'run uninstall-first only when the user selected that mode');
    assert.ok(script.includes('无法确认旧版程序文件都可安全卸载'), 'fail closed when a legacy file cannot be inspected');
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('isolated acceptance has no desktop shortcut or registry writes', async () => {
  const path = await fixture();
  try {
    const script = await buildInstallerScript({ ...options(path), isolatedInstallDir: join(root, '.tmp', 'test-installed') });
    assert.ok(!script.includes('RegStr'));
    assert.ok(!script.includes('RegKey'));
    assert.ok(!script.includes('CreateShortcut'));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('isolated integration acceptance redirects registry and shortcut writes to its temporary targets', async () => {
  const path = await fixture();
  const desktop = join(root, '.tmp', 'acceptance-desktop');
  try {
    const registryKey = 'Software\\WinBoxAcceptance\\test-acceptance';
    const script = await buildInstallerScript({
      ...options(path),
      isolatedInstallDir: join(root, '.tmp', 'test-integrated-install'),
      acceptanceIntegration: true,
      acceptanceRegistryKey: registryKey,
      acceptanceDesktopDirectory: desktop,
    });
    assert.ok(script.includes(`WriteRegStr HKCU "${registryKey}" "DisplayName"`));
    assert.ok(script.includes(`ReadRegStr $0 HKCU "${registryKey}" "InstallLocation"`));
    assert.ok(script.includes(`DeleteRegKey HKCU "${registryKey}"`));
    assert.ok(script.includes(`CreateShortcut "${desktop}\\Win-Box.lnk"`));
    assert.ok(script.includes(`Delete "${desktop}\\Win-Box.lnk"`));
    assert.ok(!script.includes('"$DESKTOP\\Win-Box.lnk"'));
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('packaging refuses to overwrite a user data directory', async () => {
  const path = await fixture();
  try {
    await mkdir(join(path, 'data'));
    await assert.rejects(buildInstallerScript(options(path)), /user data/);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('real NSIS installation, overwrite and uninstall preserve user files', { skip: process.platform !== 'win32', timeout: 120_000 }, async () => {
  const path = await fixture();
  try {
    const result = await verifyInstallation(path);
    assert.equal(result.install, 'PASS');
    assert.equal(result.overwrite, 'PASS');
    assert.equal(result.uninstall, 'PASS');
    assert.equal(result.dataPreserved, true);
    assert.equal(result.registryAndShortcuts, 'PASS');
    assert.equal(result.cleaned, true);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('acceptance input preflight failure removes its system-temp workspace', { skip: process.platform !== 'win32', timeout: 30_000 }, async () => {
  const path = await fixture();
  const temporaryRoot = await realpath(tmpdir());
  const before = new Set(await readdir(temporaryRoot));
  try {
    await rm(join(path, 'Win-Box.exe'));
    await assert.rejects(verifyInstallation(path), /missing Win-Box\.exe/);
  } finally { await rm(path, { recursive: true, force: true }); }
  const leaked = (await readdir(temporaryRoot)).filter(name => name.startsWith(installationAcceptanceWorkspacePrefix) && !before.has(name));
  assert.deepEqual(leaked, []);
});

test('real NSIS overwrite stops a running same-directory app process first', { skip: process.platform !== 'win32', timeout: 120_000 }, async t => {
  const path = await fixture({ runnable: true });
  try {
    const result = await verifyInstallation(path, { stopRunningProcess: true });
    assert.equal(result.runningProcessStopped, 'PASS');
    assert.ok(result.runningProcessStopDurationMs < 12_000, `installer waited ${result.runningProcessStopDurationMs} ms instead of stopping the running process`);
    t.diagnostic(`target process stopped in ${result.runningProcessStopDurationMs} ms`);
    assert.equal(result.overwrite, 'PASS');
    assert.equal(result.dataPreserved, true);
    assert.equal(result.registryAndShortcuts, 'PASS');
    assert.equal(result.cleaned, true);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('real NSIS uninstall-first failure and locked legacy files preserve the old install and user data', { skip: process.platform !== 'win32', timeout: 120_000 }, async t => {
  const path = await fixture();
  try {
    const result = await verifyInstallation(path, { simulateExistingUninstallerFailure: true });
    assert.equal(result.failedUninstallerRollback, 'PASS');
    assert.equal(result.legacyOnlyFileLockRejected, 'PASS');
    assert.equal(result.userDataFilesPreserved, 6);
    assert.equal(result.dataPreserved, true);
    assert.equal(result.uninstallFirst, 'PASS');
    assert.equal(result.cleaned, true);
    t.diagnostic('old install and settings/subscriptions/cloud accounts/history/favorites restored after old uninstaller failure');
  } finally { await rm(path, { recursive: true, force: true }); }
});
