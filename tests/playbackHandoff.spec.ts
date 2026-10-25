import { describe, expect, it } from 'vitest';
import { createPlaybackHandoffPort, type PlaybackHandoff } from '../src/renderer/features/playback/application/playbackHandoff';

const handoff: PlaybackHandoff = {
  url: 'https://media.example/video.mp4',
  progressKey: 'profile-a-source-a',
  kernel: 'mpv',
  position: 82.5,
  paused: true,
};

describe('PlaybackHandoffPort', () => {
  it('returns a handoff only for its exact resource, profile key and target kernel', () => {
    const state = createPlaybackHandoffPort();
    state.stage(handoff);

    expect(state.readFor(handoff)).toEqual(handoff);
    expect(state.readFor({ ...handoff, url: 'https://media.example/other.mp4' })).toBeNull();
    expect(state.readFor({ ...handoff, progressKey: 'profile-b-source-a' })).toBeNull();
    expect(state.readFor({ ...handoff, kernel: 'html5' })).toBeNull();
  });

  it('does not expose its stored object to caller mutation', () => {
    const state = createPlaybackHandoffPort();
    state.stage(handoff);

    const received = state.readFor(handoff);
    expect(received).not.toBeNull();
    received!.position = 0;

    expect(state.readFor(handoff)?.position).toBe(82.5);
  });

  it('clears only the matching session position after it has been applied', () => {
    const state = createPlaybackHandoffPort();
    state.stage(handoff);

    state.markPositionApplied({ ...handoff, progressKey: 'profile-b-source-a' });
    expect(state.readFor(handoff)?.position).toBe(82.5);

    state.markPositionApplied(handoff);
    expect(state.readFor(handoff)).toEqual({ ...handoff, position: 0 });
    expect(state.readFor(handoff)?.paused).toBe(true);
  });

  it('replaces the pending handoff when a later kernel transition is staged', () => {
    const state = createPlaybackHandoffPort();
    state.stage(handoff);
    const next = { ...handoff, kernel: 'html5' as const, position: 21, paused: false };
    state.stage(next);

    expect(state.readFor(handoff)).toBeNull();
    expect(state.readFor(next)).toEqual(next);
  });
});
