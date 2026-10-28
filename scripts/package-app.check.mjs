import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { promotePackageDirectory, withPackageStaging } from './package-app-staging.mjs';

const fixtureRoots = [];

after(async () => {
  await Promise.all(fixtureRoots.map(path => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })));
});

async function createFixtureRoot() {
  const path = await mkdtemp(join(tmpdir(), 'winbox-package-app-'));
  fixtureRoots.push(path);
  return path;
}

describe('package app staging and promotion', () => {
  it('removes staging after a packaging operation fails and preserves the original error', async () => {
    const root = await createFixtureRoot();
    const stagingDir = join(root, '.tmp', 'packager-stage');
    const expectedError = new Error('runtime closure validation failed');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, 'partial.txt'), 'partial');

    await assert.rejects(withPackageStaging(stagingDir, async () => { throw expectedError; }), error => error === expectedError);
    await assert.rejects(stat(stagingDir), error => error.code === 'ENOENT');
  });

  it('preserves both operation and cleanup errors when staging cleanup also fails', async () => {
    const operationError = new Error('packaging failed');
    const cleanupError = new Error('staging cleanup failed');
    let cleanupCalled = false;

    await assert.rejects(withPackageStaging('staging-dir', async () => {
      throw operationError;
    }, async () => {
      cleanupCalled = true;
      throw cleanupError;
    }), error => error instanceof AggregateError
      && error.cause === operationError
      && error.errors[0] === operationError
      && error.errors[1] === cleanupError);
    assert.equal(cleanupCalled, true);

    await assert.rejects(withPackageStaging('staging-dir', async () => 'done', async () => {
      throw cleanupError;
    }), error => error === cleanupError);

    let threwUndefined = false;
    try {
      await withPackageStaging('staging-dir', async () => { throw undefined; });
    } catch (error) {
      threwUndefined = true;
      assert.equal(error, undefined);
    }
    assert.equal(threwUndefined, true);
  });

  it('restores the previous app when the Windows copy fallback fails', async () => {
    const root = await createFixtureRoot();
    const source = join(root, 'staged', 'win-unpacked');
    const destination = join(root, 'output', 'win-unpacked');
    const backupPath = join(root, 'output', '.win-unpacked.backup-test');
    await mkdir(source, { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(source, 'Win-Box.exe'), 'new package');
    await writeFile(join(destination, 'Win-Box.exe'), 'previous package');

    const renameError = Object.assign(new Error('destination is temporarily locked'), { code: 'EPERM' });
    const copyError = Object.assign(new Error('disk full during copy'), { code: 'ENOSPC' });
    await assert.rejects(promotePackageDirectory({
      source,
      destination,
      backupPath,
      promote: async (_from, to) => {
        try {
          throw renameError;
        } catch (error) {
          if (error.code !== 'EPERM') throw error;
          await mkdir(to, { recursive: true });
          await writeFile(join(to, 'partial.exe'), 'partial new package');
          throw copyError;
        }
      },
    }), error => error === copyError);

    assert.equal(await readFile(join(destination, 'Win-Box.exe'), 'utf8'), 'previous package');
    await assert.rejects(stat(join(destination, 'partial.exe')), error => error.code === 'ENOENT');
    await assert.rejects(stat(backupPath), error => error.code === 'ENOENT');
  });
});
