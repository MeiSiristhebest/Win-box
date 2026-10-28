import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildInstallerScript } from './installer-script.mjs';
import { compileNsis } from './nsis-tool.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inside = (parent, path) => { const rel = relative(parent, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported file in acceptance input: ${path}`);
  }
  return result;
}
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const exists = async path => !!await stat(path).catch(() => null);

export function parseInstallationAcceptanceArgs(args, defaultAppDir) {
  const stopRunningProcess = args.includes('--stop-running');
  const positional = args.filter(argument => argument !== '--stop-running');
  if (positional.length > 1) throw new Error('Usage: verify-installation.mjs [win-unpacked-dir] [--stop-running]');
  return { appDir: positional[0] || defaultAppDir, stopRunningProcess };
}

function execute(path) {
  const child = spawnSync(path, ['/S'], { windowsHide: true, timeout: 120_000, encoding: 'utf8' });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Installer acceptance failed (${child.status}): ${child.stderr}`);
}

function startInstaller(path) {
  const child = spawn(path, ['/S'], { windowsHide: true, stdio: 'ignore' });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => {
      if (status !== 0) reject(new Error(`Installer acceptance failed (${status ?? signal}).`));
      else resolve();
    });
  });
  return { child, completed };
}

function registryCommand(args) {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  return spawnSync(executable, args, { windowsHide: true, timeout: 15_000, encoding: 'utf8' });
}

function shortcutTarget(path) {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const escapedPath = path.replaceAll("'", "''");
  const command = `$link = (New-Object -ComObject WScript.Shell).CreateShortcut('${escapedPath}'); [Console]::Write($link.TargetPath)`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const child = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 15_000,
    encoding: 'utf8',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Could not read the acceptance shortcut target: ${child.stderr || child.stdout}`);
  return child.stdout.trim();
}

/** Executes real NSIS install/overwrite/uninstall file operations in a fresh workspace directory. */
export async function verifyInstallation(appDir, { stopRunningProcess = false, simulateExistingUninstallerFailure = false } = {}) {
  if (process.platform !== 'win32') throw new Error('Installer acceptance requires Windows.');
  appDir = await realpath(resolve(appDir));
  const workspace = await realpath(ROOT);
  if (!inside(workspace, appDir)) throw new Error('Acceptance input must be inside the workspace.');
  await mkdir(join(ROOT, '.tmp'), { recursive: true });
  const work = await mkdtemp(join(ROOT, '.tmp', 'installation acceptance-'));
  if (!inside(workspace, await realpath(work))) throw new Error('Acceptance directory escaped the workspace.');
  const installed = join(work, 'installed app');
  const script = join(work, 'installer.nsi');
  const installer = join(work, 'Setup.exe');
  const uninstallFirstScript = join(work, 'installer-uninstall-first.nsi');
  const uninstallFirstInstaller = join(work, 'Setup-uninstall-first.exe');
  const failedUninstallScript = join(work, 'installer-uninstall-failure.nsi');
  const failedUninstallInstaller = join(work, 'Setup-uninstall-failure.exe');
  const savedUninstaller = join(work, 'Original-Uninstall.exe');
  const integrationInstall = join(work, 'integration install');
  const integrationDesktop = join(work, 'integration desktop');
  const integrationScript = join(work, 'installer-integration.nsi');
  const integrationInstaller = join(work, 'Setup-integration.exe');
  const integrationRegistryKey = `Software\\WinBoxAcceptance\\${randomUUID()}`;
  const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  const sourceFiles = await files(appDir);
  if (!sourceFiles.includes('Win-Box.exe')) throw new Error('Acceptance input is missing Win-Box.exe.');
  const installerOptions = { appDir, version, isolatedInstallDir: installed, icon: join(ROOT, 'build/icon.ico'), license: join(ROOT, 'LICENSE') };
  await writeFile(script, '\uFEFF' + await buildInstallerScript({ ...installerOptions, outFile: installer }));
  await compileNsis(script);
  const verifyCopies = async () => {
    for (const path of sourceFiles) if (await digest(join(appDir, path)) !== await digest(join(installed, path))) throw new Error(`Installed file mismatch: ${path}`);
  };
  let running;
  let runningStartedAt;
  let runningStoppedAt;
  let installerRun;
  let result;
  let operationError;
  const cleanupErrors = [];
  try {
    execute(installer);
    await verifyCopies();
    const userDataFiles = new Map([
      ['user-config.json', JSON.stringify({ acceptance: true, watchedSeconds: 23 })],
      ['settings/app.json', JSON.stringify({ acceptance: true, theme: 'dark' })],
      ['subscriptions/sources.json', JSON.stringify({ sources: ['fixture-source'] })],
      ['drive-accounts/global.json', JSON.stringify({ provider: 'fixture-cloud', token: 'preserve-me' })],
      ['history/watch-history.json', JSON.stringify({ watchedSeconds: 23 })],
      ['favorites/collections.json', JSON.stringify({ titles: ['fixture-title'] })],
    ]);
    const writeUserData = async () => {
      for (const [path, content] of userDataFiles) {
        const destination = join(installed, 'data', path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content);
      }
    };
    const verifyUserData = async phase => {
      for (const [path, content] of userDataFiles) {
        if (await readFile(join(installed, 'data', path), 'utf8') !== content) throw new Error(`${phase} changed user data: ${path}`);
      }
    };
    await writeUserData();
    await writeFile(join(installed, 'personal-note.txt'), 'keep this file');
    const replacedPackageFile = sourceFiles.find(path => path !== 'Win-Box.exe') ?? sourceFiles[0];
    if (stopRunningProcess) {
      runningStartedAt = Date.now();
      running = spawn(join(installed, 'Win-Box.exe'), ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
      await delay(500);
      if (running.exitCode !== null) throw new Error('Running-process fixture exited before overwrite.');
      runningStartedAt = Date.now();
      running.once('exit', () => { runningStoppedAt = Date.now(); });
      installerRun = startInstaller(installer);
      const stopDeadline = Date.now() + 15_000;
      while (running.exitCode === null && Date.now() < stopDeadline) await delay(50);
      if (running.exitCode === null) throw new Error('Installer did not stop the running Win-Box process within 15 seconds.');
      runningStoppedAt ??= Date.now();
      await installerRun.completed;
      installerRun = undefined;
      running = undefined;
    } else {
      execute(installer);
    }
    await verifyCopies();
    await verifyUserData('Overwrite');
    await writeFile(join(installed, replacedPackageFile), 'old installed content');
    if (simulateExistingUninstallerFailure) {
      await copyFile(join(installed, 'Uninstall.exe'), savedUninstaller);
      await copyFile(process.execPath, join(installed, 'Uninstall.exe'));
      await writeFile(failedUninstallScript, '\uFEFF' + await buildInstallerScript({ ...installerOptions, outFile: failedUninstallInstaller, acceptanceUninstallFirst: true }));
      await compileNsis(failedUninstallScript);
      const failedRun = spawnSync(failedUninstallInstaller, ['/S'], { windowsHide: true, timeout: 120_000, encoding: 'utf8' });
      if (failedRun.error) throw failedRun.error;
      if (failedRun.status === 0) throw new Error('Uninstall-first acceptance unexpectedly succeeded with a failing old uninstaller.');
      await verifyUserData('Failed uninstall-first attempt');
      if (await readFile(join(installed, 'personal-note.txt'), 'utf8') !== 'keep this file') throw new Error('Failed uninstall-first attempt changed user-owned files.');
      const oldPayloadAfterFailure = await readFile(join(installed, replacedPackageFile), 'utf8');
      if (oldPayloadAfterFailure !== 'old installed content') throw new Error(`Failed uninstall-first attempt removed or replaced the old installation (exit=${failedRun.status}, file=${replacedPackageFile}, content=${JSON.stringify(oldPayloadAfterFailure)}, stdout=${failedRun.stdout}, stderr=${failedRun.stderr}).`);
      await copyFile(savedUninstaller, join(installed, 'Uninstall.exe'));
    }
    await writeFile(uninstallFirstScript, '\uFEFF' + await buildInstallerScript({ ...installerOptions, outFile: uninstallFirstInstaller, acceptanceUninstallFirst: true }));
    await compileNsis(uninstallFirstScript);
    execute(uninstallFirstInstaller);
    await verifyCopies();
    await verifyUserData('Uninstall-first reinstall');
    if (await readFile(join(installed, 'personal-note.txt'), 'utf8') !== 'keep this file') throw new Error('Uninstall-first reinstall changed user-owned files.');
    execute(join(installed, 'Uninstall.exe'));
    const deadline = Date.now() + 20_000;
    while (await exists(join(installed, 'Uninstall.exe')) && Date.now() < deadline) await delay(50);
    for (const path of sourceFiles) if (await exists(join(installed, path))) throw new Error(`Uninstall retained a packaged file: ${path}`);
    await verifyUserData('Uninstall');
    if (await readFile(join(installed, 'personal-note.txt'), 'utf8') !== 'keep this file') throw new Error('Uninstall changed user-owned files.');
    if (await exists(join(installed, 'Uninstall.exe'))) throw new Error('Uninstaller has not exited.');
    await delay(100);
    await mkdir(integrationDesktop, { recursive: true });
    await writeFile(integrationScript, '\uFEFF' + await buildInstallerScript({
      ...installerOptions,
      outFile: integrationInstaller,
      isolatedInstallDir: integrationInstall,
      acceptanceIntegration: true,
      acceptanceRegistryKey: integrationRegistryKey,
      acceptanceDesktopDirectory: integrationDesktop,
    }));
    await compileNsis(integrationScript);
    execute(integrationInstaller);
    const registry = registryCommand(['query', `HKCU\\${integrationRegistryKey}`]);
    if (registry.status !== 0) throw new Error(`Acceptance installer did not create its isolated registry entries: ${registry.stderr || registry.stdout}`);
    for (const value of ['DisplayName', 'DisplayVersion', 'InstallLocation', 'DisplayIcon', 'UninstallString']) {
      if (!registry.stdout.includes(value)) throw new Error(`Acceptance installer omitted registry value ${value}.`);
    }
    if (!registry.stdout.includes(integrationInstall)) throw new Error('Acceptance InstallLocation does not match the isolated install directory.');
    const shortcut = join(integrationDesktop, 'Win-Box.lnk');
    if (!await exists(shortcut)) throw new Error('Acceptance installer did not create its isolated desktop shortcut.');
    if (resolve(shortcutTarget(shortcut)) !== resolve(join(integrationInstall, 'Win-Box.exe'))) {
      throw new Error('Acceptance desktop shortcut targets the wrong executable.');
    }
    execute(join(integrationInstall, 'Uninstall.exe'));
    const integrationUninstallDeadline = Date.now() + 20_000;
    while (await exists(join(integrationInstall, 'Uninstall.exe')) && Date.now() < integrationUninstallDeadline) await delay(50);
    if (await exists(join(integrationInstall, 'Uninstall.exe'))) throw new Error('Integration uninstaller has not exited.');
    const registryAfterUninstall = registryCommand(['query', `HKCU\\${integrationRegistryKey}`]);
    if (await exists(shortcut) || registryAfterUninstall.status === 0) {
      const shortcutStillExists = await exists(shortcut);
      const target = shortcutStillExists ? shortcutTarget(shortcut) : '';
      const retainedFiles = [];
      for (const path of sourceFiles) if (await exists(join(integrationInstall, path))) retainedFiles.push(path);
      throw new Error(`Acceptance uninstaller did not remove all isolated integration entries (shortcut=${shortcutStillExists}, target=${target}, retainedFiles=${JSON.stringify(retainedFiles)}, registry=${registryAfterUninstall.stdout || registryAfterUninstall.stderr}).`);
    }
    result = {
      install: 'PASS',
      overwrite: 'PASS',
      runningProcessStopped: stopRunningProcess ? 'PASS' : 'NOT_RUN',
      runningProcessStopDurationMs: runningStartedAt && runningStoppedAt ? runningStoppedAt - runningStartedAt : null,
      uninstallFirst: 'PASS',
      failedUninstallerRollback: simulateExistingUninstallerFailure ? 'PASS' : 'NOT_RUN',
      uninstall: 'PASS',
      dataPreserved: true,
      userDataFilesPreserved: userDataFiles.size,
      verifiedFiles: sourceFiles.length,
      isolated: true,
      registryAndShortcuts: 'PASS',
    };
  } catch (error) {
    operationError = error;
  } finally {
    try {
      if (installerRun?.child.exitCode === null) installerRun.child.kill();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (running && running.exitCode === null) running.kill();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const registryPath = `HKCU\\${integrationRegistryKey}`;
      if (registryCommand(['query', registryPath]).status === 0) {
        const removal = registryCommand(['delete', registryPath, '/f']);
        if (removal.status !== 0) cleanupErrors.push(new Error(`Could not remove temporary installer acceptance registry entries: ${removal.stderr || removal.stdout}`));
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(work, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError([operationError, ...cleanupErrors], 'Installer acceptance failed and cleanup also failed.');
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Installer acceptance cleanup failed.');
  return { ...result, cleaned: !await exists(work) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  const options = parseInstallationAcceptanceArgs(process.argv.slice(2), join(ROOT, `release${version}`, 'win-unpacked'));
  const result = { recordedAt: new Date().toISOString(), ...await verifyInstallation(options.appDir, options) };
  await writeFile(join(ROOT, '.tmp/installation-acceptance.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
