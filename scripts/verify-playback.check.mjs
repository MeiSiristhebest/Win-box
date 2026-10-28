import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAcceptanceFixture } from './acceptance-fixture.mjs';
import { parsePlaybackAcceptanceArgs } from './verify-playback.mjs';

test('keeps source playback acceptance as the default mode', () => {
  assert.deepEqual(parsePlaybackAcceptanceArgs([]), { packagedAppDirectory: null, potplayerPath: null, sourceMatrixPath: null });
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
