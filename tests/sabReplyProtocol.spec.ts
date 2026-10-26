import { describe, expect, it } from 'vitest';
import { SAB_HEADER, publishSabReply, waitForSabReply } from '../src/engine/js/worker/protocol';
import { responseForSabFailure } from '../src/engine/js/worker/remoteHost';

function channel(capacity = 512): SharedArrayBuffer {
  return new SharedArrayBuffer(SAB_HEADER + capacity);
}

describe('shared-memory worker reply protocol', () => {
  it('keeps the first published reply and rejects a late overwrite', () => {
    const sab = channel();

    expect(publishSabReply(sab, { ok: true, value: { status: 200, content: 'first' } })).toBe(true);
    expect(publishSabReply(sab, { ok: false, code: 'timeout', error: 'late timeout' })).toBe(false);
    expect(waitForSabReply(sab, 50, 'timeout')).toEqual({
      ok: true,
      value: { status: 200, content: 'first' },
    });
  });

  it('publishes an explicit oversize result instead of a truncated JSON frame', () => {
    const sab = channel(80);

    expect(publishSabReply(sab, { ok: true, value: '影视内容'.repeat(80) })).toBe(true);
    const failure = waitForSabReply(sab, 50, 'timeout');
    expect(failure).toMatchObject({
      ok: false,
      code: 'oversized',
    });
    expect(responseForSabFailure('https://source.example/vod', failure)).toMatchObject({
      status: 413,
      content: '',
      finalUrl: 'https://source.example/vod',
      headers: { 'x-winbox-sync-error-code': 'oversized' },
    });
  });

  it('lets the waiting worker claim timeout so a later HTTP result cannot overwrite it', () => {
    const sab = channel();

    const timeout = waitForSabReply(sab, 0, 'upstream deadline exceeded');
    expect(timeout).toMatchObject({ ok: false, code: 'timeout', error: 'upstream deadline exceeded' });
    expect(responseForSabFailure('https://source.example/vod', timeout).status).toBe(504);
    expect(publishSabReply(sab, { ok: true, value: 'late HTTP response' })).toBe(false);
    expect(waitForSabReply(sab, 50, 'different timeout')).toEqual(timeout);
  });

  it('reports serialization and corrupt-length failures as protocol errors', () => {
    const unserializable = channel();
    expect(publishSabReply(unserializable, { ok: true, value: 1n })).toBe(true);
    expect(waitForSabReply(unserializable, 50, 'timeout')).toMatchObject({
      ok: false,
      code: 'serialization',
    });

    const corrupt = channel(32);
    expect(publishSabReply(corrupt, { ok: true, value: 'ok' })).toBe(true);
    Atomics.store(new Int32Array(corrupt, 0, 2), 1, 33);
    expect(waitForSabReply(corrupt, 50, 'timeout')).toMatchObject({
      ok: false,
      code: 'protocol',
      error: '同步通道回执长度无效',
    });
  });
});
