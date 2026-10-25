import { describe, expect, it } from 'vitest';
import { resolvePlayerControlAvailability } from '../src/renderer/features/playback/presentation/playerControlAvailability';

describe('resolvePlayerControlAvailability', () => {
  it('hides timeline and skip controls for a live stream', () => {
    expect(resolvePlayerControlAvailability({
      live: true,
      skipSegmentsUsable: true,
      allowMpv: false,
      kernel: 'html5',
      episodeCount: 1,
    })).toEqual({
      progressVisible: false,
      skipSegmentsVisible: false,
      kernelSelectorVisible: false,
      kernelToolsVisible: false,
      superResolutionVisible: false,
      superResolutionActive: false,
      episodeSelectorVisible: false,
    });
  });

  it('shows only the kernel selector before MPV is active', () => {
    expect(resolvePlayerControlAvailability({
      live: false,
      skipSegmentsUsable: true,
      allowMpv: true,
      kernel: 'html5',
      episodeCount: 8,
    })).toEqual({
      progressVisible: true,
      skipSegmentsVisible: true,
      kernelSelectorVisible: true,
      kernelToolsVisible: false,
      superResolutionVisible: true,
      superResolutionActive: false,
      episodeSelectorVisible: true,
    });
  });

  it('enables MPV-only controls only when the MPV kernel is allowed and active', () => {
    const activeMpv = resolvePlayerControlAvailability({
      live: false,
      skipSegmentsUsable: false,
      allowMpv: true,
      kernel: 'mpv',
      episodeCount: 2,
    });
    const unavailableMpv = resolvePlayerControlAvailability({
      live: false,
      skipSegmentsUsable: false,
      allowMpv: false,
      kernel: 'mpv',
      episodeCount: 2,
    });

    expect(activeMpv.kernelToolsVisible).toBe(true);
    expect(activeMpv.superResolutionActive).toBe(true);
    expect(unavailableMpv.kernelToolsVisible).toBe(false);
    expect(unavailableMpv.superResolutionVisible).toBe(false);
    expect(unavailableMpv.superResolutionActive).toBe(false);
  });

  it('does not expose an episode selector for zero, one or invalid episode counts', () => {
    for (const episodeCount of [Number.NaN, -1, 0, 1]) {
      expect(resolvePlayerControlAvailability({
        live: false,
        skipSegmentsUsable: false,
        allowMpv: false,
        kernel: 'html5',
        episodeCount,
      }).episodeSelectorVisible).toBe(false);
    }
  });
});
