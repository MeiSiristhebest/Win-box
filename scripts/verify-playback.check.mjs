import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { startAcceptanceFixture } from './acceptance-fixture.mjs';
import { parsePlaybackAcceptanceArgs } from './playback-acceptance-arguments.mjs';
import { assertNoExistingPotPlayer, closeOwnedAcceptanceProcess, newProcessIds, withAcceptanceDeadline } from './acceptance-cleanup.mjs';

test('keeps source playback acceptance as the default mode', () => {
  assert.deepEqual(parsePlaybackAcceptanceArgs([]), { packagedAppDirectory: null, potplayerPath: null, sourceMatrixPath: null, artifactDirectory: null, playbackOnly: false });
});

test('accepts a packaged win-unpacked directory and resolves it', () => {
  const parsed = parsePlaybackAcceptanceArgs(['--packaged-app', 'release1.27.1/win-unpacked']);
  assert.equal(parsed.packagedAppDirectory.endsWith('release1.27.1\\win-unpacked'), true);
});

test('rejects missing or duplicate packaged-app arguments', () => {
  assert.throws(() => parsePlaybackAcceptanceArgs(['--packaged-app']), /requires a win-unpacked directory/);
  assert.throws(() => parsePlaybackAcceptanceArgs(['--packaged-app', 'a', '--packaged-app', 'b']), /Use --packaged-app once/);
});

test('accepts an explicit PotPlayer executable path', () => {
  const parsed = parsePlaybackAcceptanceArgs(['--potplayer', 'D:\\PotPlayer\\PotPlayerMini64.exe']);
  assert.equal(parsed.potplayerPath, 'D:\\PotPlayer\\PotPlayerMini64.exe');
});

test('rejects missing or duplicate PotPlayer arguments', () => {
  assert.throws(() => parsePlaybackAcceptanceArgs(['--potplayer']), /requires the PotPlayer executable path/);
  assert.throws(() => parsePlaybackAcceptanceArgs(['--potplayer', 'a.exe', '--potplayer', 'b.exe']), /Use --potplayer once/);
});

test('accepts an explicit source matrix path', () => {
  const parsed = parsePlaybackAcceptanceArgs(['--source-matrix', '.tmp/source-matrix.json']);
  assert.equal(parsed.sourceMatrixPath.endsWith('.tmp\\source-matrix.json'), true);
});

test('rejects missing or duplicate source matrix arguments', () => {
  assert.throws(() => parsePlaybackAcceptanceArgs(['--source-matrix']), /requires a JSON file path/);
  assert.throws(() => parsePlaybackAcceptanceArgs(['--source-matrix', 'a.json', '--source-matrix', 'b.json']), /Use --source-matrix once/);
});

test('accepts a unique artifact directory and playback-only mode', () => {
  const parsed = parsePlaybackAcceptanceArgs(['--artifact-dir', 'D:\\developWorkPlaces\\win-box\\.tmp\\v02-playback-run', '--playback-only']);
  assert.equal(parsed.artifactDirectory, 'D:\\developWorkPlaces\\win-box\\.tmp\\v02-playback-run');
  assert.equal(parsed.playbackOnly, true);
});

test('rejects missing or duplicate artifact directories and incompatible source matrices', () => {
  assert.throws(() => parsePlaybackAcceptanceArgs(['--artifact-dir']), /requires a new output directory/);
  assert.throws(() => parsePlaybackAcceptanceArgs(['--artifact-dir', 'a', '--artifact-dir', 'b']), /Use --artifact-dir once/);
  assert.throws(() => parsePlaybackAcceptanceArgs(['--playback-only', '--source-matrix', 'matrix.json']), /cannot be combined/);
});

test('bounds a hung cleanup operation so acceptance reporting can continue', async () => {
  await assert.rejects(withAcceptanceDeadline(() => new Promise(() => {}), 5, 'close-electron'), /close-electron timed out after 5ms/);
});

test('identifies only process ids absent from the pre-launch snapshot', () => {
  assert.deepEqual(newProcessIds([101, 102], [102, 103, 103]), [103]);
});

test('refuses to launch PotPlayer when a user process already exists', () => {
  assert.deepEqual([...assertNoExistingPotPlayer([])], []);
  assert.throws(() => assertNoExistingPotPlayer([1234]), /PotPlayer is already running/);
});

test('terminates and confirms exit of only the owned Electron child after close timeout', async () => {
  class AcceptanceChild extends EventEmitter {
    pid = 4321;
    exitCode = null;
    signalCode = null;
    killCalls = 0;
    kill() {
      this.killCalls += 1;
      this.signalCode = 'SIGTERM';
      this.emit('exit', null, 'SIGTERM');
      return true;
    }
  }

  const child = new AcceptanceChild();
  const steps = await closeOwnedAcceptanceProcess({
    child,
    close: () => new Promise(() => {}),
    terminate: () => child.kill(),
    closeTimeoutMs: 5,
    exitTimeoutMs: 5,
  });
  assert.equal(child.killCalls, 1);
  assert.deepEqual(steps.map(({ action, status }) => [action, status]), [
    ['close-electron', 'FAIL'],
    ['wait-electron-exit', 'FAIL'],
    ['terminate-electron-owned-child', 'PASS'],
    ['wait-electron-termination', 'PASS'],
  ]);
});

test('records completed media response status, type, range, and bytes', async () => {
  const fixture = await startAcceptanceFixture();
  const media = Buffer.from('fixture video bytes');
  fixture.setMedia(media);
  try {
    const response = await fetch(fixture.base + '/clip.webm', { headers: { Range: 'bytes=0-7' } });
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 206);
    assert.equal(body.length, 8);
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.requests[0], {
      method: 'GET', path: '/clip.webm', range: 'bytes=0-7', status: 206,
      contentType: 'video/webm', responseBytes: 8, completed: true,
    });
  } finally {
    await fixture.close();
  }
});
