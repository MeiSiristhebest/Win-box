import { describe, expect, it } from 'vitest';
import { resolvePlayerKernelDecision } from '../src/renderer/features/playback/application/playerKernelDecision';

describe('resolvePlayerKernelDecision', () => {
  const base = {
    allowMpv: true,
    preference: 'auto' as const,
    url: 'https://media.example/video.mp4',
    mpvStatusResolved: false,
    mpvAvailable: false,
    engines: [] as string[],
    requiresCompatibility: false,
  };

  it('keeps HTML probing gated while automatic mode waits for the MPV capability probe', () => {
    expect(resolvePlayerKernelDecision(base)).toEqual({
      desiredKernel: 'html5',
      htmlPlaybackReady: false,
    });
  });

  it('lets an explicit HTML5 preference start without waiting for MPV detection', () => {
    expect(resolvePlayerKernelDecision({ ...base, preference: 'html5' })).toEqual({
      desiredKernel: 'html5',
      htmlPlaybackReady: true,
    });
  });

  it('starts HTML playback when the resolved capability probe falls back to HTML5', () => {
    expect(resolvePlayerKernelDecision({ ...base, mpvStatusResolved: true })).toEqual({
      desiredKernel: 'html5',
      htmlPlaybackReady: true,
    });
  });

  it('does not start HTML probing when automatic mode selects MPV for a compatibility source', () => {
    expect(resolvePlayerKernelDecision({
      ...base,
      mpvStatusResolved: true,
      mpvAvailable: true,
      requiresCompatibility: true,
      url: 'https://media.example/download?id=opaque',
    })).toEqual({ desiredKernel: 'mpv', htmlPlaybackReady: false });
  });

  it('always uses ready HTML playback when the window disallows MPV', () => {
    expect(resolvePlayerKernelDecision({ ...base, allowMpv: false })).toEqual({
      desiredKernel: 'html5',
      htmlPlaybackReady: true,
    });
  });
});
