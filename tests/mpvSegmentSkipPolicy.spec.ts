import { describe, expect, it } from 'vitest';
import { decideMpvSegmentSkip } from '../src/renderer/features/playback/application/mpvSegmentSkipPolicy';

describe('decideMpvSegmentSkip', () => {
  const segments = { intro: 90, outro: 60 };

  it('seeks past the intro once and preserves the outro state', () => {
    const decision = decideMpvSegmentSkip({
      live: false,
      time: 0,
      duration: 1800,
      segments,
      introFired: false,
      outroFired: false,
    });

    expect(decision).toEqual({
      introFired: true,
      outroFired: false,
      action: { kind: 'seek-intro', target: 90 },
    });
  });

  it('does not repeatedly skip after a user seeks back into the intro', () => {
    const decision = decideMpvSegmentSkip({
      live: false,
      time: 10,
      duration: 1800,
      segments,
      introFired: true,
      outroFired: false,
    });

    expect(decision.action).toBeNull();
    expect(decision.introFired).toBe(true);
  });

  it('does not apply stored skip marks to live content or an invalid outro point', () => {
    const live = decideMpvSegmentSkip({
      live: true,
      time: 0,
      duration: 0,
      segments,
      introFired: false,
      outroFired: false,
    });
    const invalid = decideMpvSegmentSkip({
      live: false,
      time: 1,
      duration: 60,
      segments,
      introFired: true,
      outroFired: false,
    });

    expect(live.action).toBeNull();
    expect(invalid.action).toBeNull();
  });

  it('marks a reached outro once even when the caller cannot advance', () => {
    const input = {
      live: false,
      time: 1750,
      duration: 1800,
      segments,
      introFired: true,
      outroFired: false,
    };
    const first = decideMpvSegmentSkip(input);
    const repeated = decideMpvSegmentSkip({ ...input, ...first });

    expect(first).toEqual({
      introFired: true,
      outroFired: true,
      action: { kind: 'outro-threshold-reached', seconds: 60 },
    });
    expect(repeated.action).toBeNull();
  });
});
