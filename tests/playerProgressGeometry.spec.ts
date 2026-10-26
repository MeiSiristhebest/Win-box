import { describe, expect, it } from 'vitest';
import {
  progressHoverOffset,
  progressTimeAtPointer,
  projectProgressPercentages,
} from '../src/renderer/features/playback/application/playerProgressGeometry';

describe('player progress geometry policy', () => {
  const bounds = { left: 10, width: 100 };

  it('maps pointer positions to rounded, duration-bounded seek times', () => {
    expect(progressTimeAtPointer(10, bounds, 61)).toBe(0);
    expect(progressTimeAtPointer(60, bounds, 61)).toBe(31);
    expect(progressTimeAtPointer(200, bounds, 61)).toBe(61);
  });

  it('rejects missing or non-finite geometry instead of seeking to NaN', () => {
    expect(progressTimeAtPointer(50, { left: 10, width: 0 }, 60)).toBeNull();
    expect(progressTimeAtPointer(50, bounds, 0)).toBeNull();
    expect(progressTimeAtPointer(Number.NaN, bounds, 60)).toBeNull();
    expect(progressTimeAtPointer(50, bounds, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps the hover hint in its thumb-safe inset and clamps CSS percentages', () => {
    expect(progressHoverOffset(10, bounds)).toBe(22);
    expect(progressHoverOffset(110, bounds)).toBe(78);
    expect(projectProgressPercentages(30, 75, 60)).toEqual({ played: 50, buffered: 100 });
    expect(projectProgressPercentages(Number.NaN, -1, 60)).toEqual({ played: 0, buffered: 0 });
    expect(projectProgressPercentages(15, 25, Number.POSITIVE_INFINITY)).toEqual({ played: 0, buffered: 0 });
  });
});
