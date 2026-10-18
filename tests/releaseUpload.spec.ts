import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function dryRun(version: string, files: string[], output = 'release') {
  const parent = resolve('.tmp');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'release-upload-test-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'release'));
    copyFileSync(resolve('scripts/upload-release.mjs'), join(dir, 'scripts/upload-release.mjs'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version, build: { directories: { output } } }));
    for (const file of files) writeFileSync(join(dir, 'release', file), 'fixture');
    mkdirSync(join(dir, 'release', `Win-Box ${version}.exe`));
    const result = spawnSync(process.execPath, [join(dir, 'scripts/upload-release.mjs'), '--dry-run'], {
      encoding: 'utf8', timeout: 10000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Release installer selection', () => {
  it('accepts electron-builder normalized names without changing the release tag', () => {
    const result = dryRun('1.21.01', [
      'Win-Box Setup 1.21.1.exe', 'Win-Box 1.21.1.exe',
      'Win-Box Setup 1.21.0.exe', 'Win-Box Setup 1.21.1.exe.blockmap', 'latest.yml', 'other.exe',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('release1.21.01');
    expect(result.stdout).toContain('Win-Box Setup 1.21.1.exe');
    expect(result.stdout).toContain('Win-Box 1.21.1.exe');
    expect(result.stdout).not.toContain('1.21.0.exe');
    expect(result.stdout).not.toContain('blockmap');
    expect(result.stdout).not.toContain('latest.yml');
    expect(result.stdout).not.toContain('other.exe');
    expect(result.stdout.match(/Installer:/g)).toHaveLength(2);
  });

  it('still accepts installer names that preserve the package version', () => {
    const result = dryRun('1.21.01', ['Win-Box Setup 1.21.01.exe']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Win-Box Setup 1.21.01.exe');
    expect(result.stdout.match(/Installer:/g)).toHaveLength(1);
  });

  it('reports missing configured output as a missing installer', () => {
    const result = dryRun('1.21.9', [], 'missing-output');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No installers for 1.21.9 found');
    expect(result.stderr).not.toContain('ENOENT');
  });

  it('fails when only stale installers or metadata exist', () => {
    const result = dryRun('1.21.01', ['Win-Box Setup 1.21.0.exe', 'latest.yml']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No installers for 1.21.01 found');
  });
});
