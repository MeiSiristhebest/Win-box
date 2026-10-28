import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallerScript } from './installer-script.mjs';
import { verifyInstallation } from './verify-installation.mjs';

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
    const encoded = [...script.matchAll(/-EncodedCommand ([A-Za-z0-9+/=]+)/g)].map(match => match[1]);
    assert.equal(encoded.length, 9, 'expected install-page, file-lock, installer and uninstaller process commands');
    assert.ok(encoded.every(command => command.length < 900), `PowerShell commands must fit NSIS plugin command length limits: ${encoded.map(command => command.length).join(', ')}`);
    const [installLockForce, uninstallerLockForce, pageCheck, check, graceful, force] = encoded.slice(0, 6).map(command => Buffer.from(command, 'base64').toString('utf16le'));
    assert.ok(installLockForce.includes('kill -Id $x.Id -Force'));
    assert.ok(uninstallerLockForce.includes('Wait-Process -Id $x.Id -Timeout 2'));
    assert.ok(pageCheck.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
    assert.ok(check.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
    assert.ok(check.includes('gps -Id $_.ProcessId'));
    assert.ok(graceful.includes('CloseMainWindow'));
    assert.ok(graceful.includes('$_.MainWindowHandle'));
    assert.ok(graceful.includes('WaitForExit(10000)'));
    assert.ok(force.includes('kill -Id $x.Id -Force'));
    assert.ok(force.includes('$_.ExecutablePath -eq $env:WINBOX_INSTALL_EXE'));
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

test('real NSIS overwrite stops a running same-directory app process first', { skip: process.platform !== 'win32', timeout: 120_000 }, async () => {
  const path = await fixture({ runnable: true });
  try {
    const result = await verifyInstallation(path, { stopRunningProcess: true });
    assert.equal(result.runningProcessStopped, 'PASS');
    assert.equal(result.overwrite, 'PASS');
    assert.equal(result.dataPreserved, true);
    assert.equal(result.registryAndShortcuts, 'PASS');
    assert.equal(result.cleaned, true);
  } finally { await rm(path, { recursive: true, force: true }); }
});
