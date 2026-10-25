import { describe, expect, it } from 'vitest';
import {
  initialPlayerPlaybackPresentation,
  updatePlayerPlaybackPresentation,
} from '../src/renderer/features/playback/application/PlayerPlaybackPresentation';

describe('player playback presentation model', () => {
  it('applies state changes immutably and retains untouched fields', () => {
    const current = initialPlayerPlaybackPresentation;
    const next = updatePlayerPlaybackPresentation(current, { currentTime: 42, paused: false });

    expect(next).toEqual({ ...current, currentTime: 42, paused: false });
    expect(next).not.toBe(current);
    expect(current.currentTime).toBe(0);
  });

  it('keeps the snapshot identity when an event repeats the same values', () => {
    const current = { ...initialPlayerPlaybackPresentation, isLive: true, relaySpeed: 512 };

    expect(updatePlayerPlaybackPresentation(current, { isLive: true, relaySpeed: 512 })).toBe(current);
  });
});
