import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInstallerScript } from './installer-script.mjs';
import { verifyInstallation } from './verify-installation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, '.tmp'), { recursive: true });

async function fixture() {
  const path = await mkdtemp(join(root, '.tmp', 'installer-fixture-'));
  await mkdir(join(path, 'resources'), { recursive: true });
  await writeFile(join(path, 'Win-Box.exe'), 'MZ test executable payload');
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
    assert.ok(!script.includes('taskkill'));
    assert.ok(!script.includes('RMDir /r'));
    assert.ok(!script.includes('Delete "$INSTDIR\\data'));
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
    assert.equal(result.cleaned, true);
  } finally { await rm(path, { recursive: true, force: true }); }
});
