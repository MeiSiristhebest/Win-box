import { describe, expect, it } from 'vitest';
import {
  clampImageViewerScale,
  imageViewerOffsetAtPointer,
  imageViewerRetryUrl,
  imageViewerTransform,
  stepImageViewerScale,
} from '../src/renderer/components/imageViewerPolicy';

describe('image viewer policy', () => {
  it('clamps and rounds zoom without propagating invalid values', () => {
    expect(clampImageViewerScale(Number.NaN)).toBe(1);
    expect(stepImageViewerScale(4.99, 0.25)).toBe(5);
    expect(stepImageViewerScale(0.26, -0.25)).toBe(0.25);
    expect(imageViewerTransform({ x: 3, y: -7 }, 1.256)).toBe('translate(3px, -7px) scale(1.26)');
  });

  it('moves from the captured drag origin rather than accumulating pointer event rounding', () => {
    const origin = { pointerX: 100, pointerY: 80, offset: { x: 12, y: -5 } };
    expect(imageViewerOffsetAtPointer(origin, 135, 60)).toEqual({ x: 47, y: -25 });
    expect(imageViewerOffsetAtPointer(origin, 105, 85)).toEqual({ x: 17, y: 0 });
  });

  it('adds retry tokens before URL fragments and preserves existing queries', () => {
    expect(imageViewerRetryUrl('https://example.test/poster.jpg#preview', 0))
      .toBe('https://example.test/poster.jpg#preview');
    expect(imageViewerRetryUrl('https://example.test/poster.jpg#preview', 2))
      .toBe('https://example.test/poster.jpg?_r=2#preview');
    expect(imageViewerRetryUrl('https://example.test/poster.jpg?size=small#preview', 3))
      .toBe('https://example.test/poster.jpg?size=small&_r=3#preview');
  });
});
