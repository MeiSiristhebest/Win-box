import { describe, expect, it } from 'vitest';
import { audioRestorePosition, audioSeekByPosition } from '../src/renderer/features/playback/application/audioPlayback';

describe('audio playback position rules', () => {
  it('clamps relative seeks and ignores non-finite inputs', () => {
    expect(audioSeekByPosition(10, 30, -20)).toBe(0);
    expect(audioSeekByPosition(10, 30, 50)).toBe(30);
    expect(audioSeekByPosition(Number.NaN, 30, 5)).toBeUndefined();
  });

  it('restores only positions with useful remaining playback time', () => {
    expect(audioRestorePosition(42, 180)).toBe(42);
    expect(audioRestorePosition(177, 180)).toBeUndefined();
    expect(audioRestorePosition(0, 0)).toBeUndefined();
  });

});
