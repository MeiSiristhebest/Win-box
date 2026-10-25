import { describe, expect, it } from 'vitest';
import { resolveProgressMenuPosition } from '../src/renderer/features/playback/application/playerWindow';

describe('progress context menu positioning', () => {
  it('keeps the menu within the viewport gutter', () => {
    expect(resolveProgressMenuPosition(
      { clientX: 980, clientY: 740 },
      { width: 1024, height: 768 },
      { width: 248, height: 196 },
    )).toEqual({ clientX: 768, clientY: 564 });
  });

  it('anchors at the gutter when the pointer is near the top-left edge', () => {
    expect(resolveProgressMenuPosition(
      { clientX: 0, clientY: 2 },
      { width: 1024, height: 768 },
      { width: 248, height: 196 },
    )).toEqual({ clientX: 8, clientY: 8 });
  });

  it('uses the gutter when the viewport is smaller than the menu', () => {
    expect(resolveProgressMenuPosition(
      { clientX: 90, clientY: 90 },
      { width: 200, height: 150 },
      { width: 248, height: 196 },
    )).toEqual({ clientX: 8, clientY: 8 });
  });
});
