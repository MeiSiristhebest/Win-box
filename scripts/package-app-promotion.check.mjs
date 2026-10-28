import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promoteStagedApp } from './package-app-promotion.mjs';

const paths = { source: '.tmp/packaged-stage', destination: '.tmp/output/win-unpacked' };

describe('promoteStagedApp', () => {
  it('uses rename when promotion succeeds', async () => {
    const calls = [];
    const fileSystem = {
      rename: async (...args) => calls.push(['rename', ...args]),
      copy: async (...args) => calls.push(['copy', ...args]),
      remove: async (...args) => calls.push(['remove', ...args]),
    };

    assert.equal(await promoteStagedApp({ ...paths, platform: 'win32', fileSystem }), 'rename');
    assert.deepEqual(calls, [['rename', paths.source, paths.destination]]);
  });

  it('copies after a Windows permission-related rename failure', async () => {
    const calls = [];
    const renameError = Object.assign(new Error('directory is temporarily locked'), { code: 'EPERM' });
    const fileSystem = {
      rename: async (...args) => { calls.push(['rename', ...args]); throw renameError; },
      copy: async (...args) => calls.push(['copy', ...args]),
      remove: async (...args) => calls.push(['remove', ...args]),
    };

    assert.equal(await promoteStagedApp({ ...paths, platform: 'win32', fileSystem }), 'copy');
    assert.deepEqual(calls, [
      ['rename', paths.source, paths.destination],
      ['copy', paths.source, paths.destination, { recursive: true, preserveTimestamps: true, errorOnExist: true }],
    ]);
  });

  it('does not fall back for non-Windows or non-permission rename errors', async () => {
    for (const { platform, error } of [
      { platform: 'linux', error: Object.assign(new Error('rename denied'), { code: 'EPERM' }) },
      { platform: 'win32', error: Object.assign(new Error('destination exists'), { code: 'ENOTEMPTY' }) },
    ]) {
      let copyCalls = 0;
      const fileSystem = {
        rename: async () => { throw error; },
        copy: async () => { copyCalls += 1; },
        remove: async () => {},
      };

      await assert.rejects(promoteStagedApp({ ...paths, platform, fileSystem }), caught => caught === error);
      assert.equal(copyCalls, 0);
    }
  });

  it('cleans a partial destination after copy failure and rethrows the original copy error', async () => {
    const calls = [];
    const renameError = Object.assign(new Error('directory is temporarily locked'), { code: 'EPERM' });
    const copyError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    const fileSystem = {
      rename: async () => { throw renameError; },
      copy: async () => { calls.push('copy'); throw copyError; },
      remove: async (...args) => { calls.push(['remove', ...args]); },
    };

    await assert.rejects(promoteStagedApp({ ...paths, platform: 'win32', fileSystem }), caught => caught === copyError);
    assert.deepEqual(calls, [
      'copy',
      ['remove', paths.destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }],
    ]);
  });
});
