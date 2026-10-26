import { describe, expect, it } from 'vitest';
import { createHtml5PlaybackRecovery } from '../src/renderer/features/playback/application/html5PlaybackRecovery';

describe('HTML5 playback recovery policy', () => {
  it('does not retry or switch kernels for an upstream 4xx response', () => {
    const recovery = createHtml5PlaybackRecovery();

    expect(recovery.onHlsFatal({ type: 'network', responseStatus: 404 })).toEqual({
      kind: 'report-failure', retryCount: 0,
    });
    expect(recovery.onHlsFatal({ type: 'network', responseStatus: 429 })).toEqual({
      kind: 'report-failure', retryCount: 0,
    });
  });

  it('bounds network and decode recovery before requesting a kernel handoff', () => {
    const recovery = createHtml5PlaybackRecovery();

    expect(recovery.onHlsFatal({ type: 'network', responseStatus: 502 }).kind).toBe('retry-network');
    expect(recovery.onHlsFatal({ type: 'network', responseStatus: 503 }).kind).toBe('retry-network');
    expect(recovery.onHlsFatal({ type: 'network', responseStatus: 503 })).toEqual({
      kind: 'switch-kernel', retryCount: 2,
    });

    const decodeRecovery = createHtml5PlaybackRecovery();
    expect(decodeRecovery.onHlsFatal({ type: 'media' }).kind).toBe('recover-media');
    expect(decodeRecovery.onHlsFatal({ type: 'media' }).kind).toBe('recover-media');
    expect(decodeRecovery.onHlsFatal({ type: 'media' })).toEqual({ kind: 'switch-kernel', retryCount: 2 });
  });

  it('tries an external player once after an unsupported-format error and reports launch failure', () => {
    const recovery = createHtml5PlaybackRecovery();
    const error = { code: 4, kernelRecoveryStarted: false, externalFallbackAvailable: true };

    expect(recovery.onMediaError(error)).toEqual({ kind: 'try-external-player' });
    expect(recovery.shouldIgnoreMediaError(4)).toBe(true);
    expect(recovery.onMediaError(error)).toEqual({ kind: 'ignore' });
    expect(recovery.completeExternalFallback({ opened: false, error: '程序未安装' })).toEqual({
      kind: 'external-player-failed', error: '程序未安装',
    });
  });

  it('does not fall back externally after an accepted kernel handoff', () => {
    const recovery = createHtml5PlaybackRecovery();

    expect(recovery.onMediaError({ code: 4, kernelRecoveryStarted: true, externalFallbackAvailable: true })).toEqual({ kind: 'ignore' });
  });

  it('resets the retry budget for a new URL and ignores late failures from the old session', () => {
    const oldUrlRecovery = createHtml5PlaybackRecovery();
    expect(oldUrlRecovery.onHlsFatal({ type: 'network', responseStatus: 503 }).kind).toBe('retry-network');
    oldUrlRecovery.cancel();

    const newUrlRecovery = createHtml5PlaybackRecovery();
    expect(oldUrlRecovery.onHlsFatal({ type: 'network', responseStatus: 503 })).toEqual({ kind: 'ignore' });
    expect(oldUrlRecovery.completeExternalFallback({ opened: true, player: 'PotPlayer' })).toEqual({ kind: 'ignore' });
    expect(newUrlRecovery.onHlsFatal({ type: 'network', responseStatus: 503 }).kind).toBe('retry-network');
  });
});
