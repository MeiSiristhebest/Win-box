import { describe, expect, it } from 'vitest';
import { clearDanmakuCanvas, prepareDanmakuCanvas } from '../src/renderer/lib/danmakuCanvas';

function surface(dpr: number) {
  const canvas = { clientWidth: 200, clientHeight: 100, width: Math.round(200 * dpr), height: Math.round(100 * dpr) };
  let scale = 1;
  const pixels = new Set<string>();
  const calls: string[] = [];
  const ctx = {
    setTransform(...args: unknown[]) {
      const [matrixOrScale] = args;
      if (typeof matrixOrScale === 'number') scale = matrixOrScale;
      calls.push('scale:' + String(matrixOrScale));
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push('clear:' + w + 'x' + h);
      for (const key of pixels) {
        const [px, py] = key.split(',').map(Number);
        if (px >= x * scale && px < (x + w) * scale && py >= y * scale && py < (y + h) * scale) pixels.delete(key);
      }
    },
  };
  return { canvas, ctx, pixels, calls, getScale: () => scale };
}

describe('danmaku physical canvas clearing', () => {
  it.each([1, 1.25, 1.5, 2])('clears the far right/bottom pixels and restores DPR %s after disable/enable', dpr => {
    const s = surface(dpr);
    clearDanmakuCanvas(s.ctx, s.canvas);
    // Same backing size after re-enabling: this must not rely on a resize.
    s.pixels.add((s.canvas.width - 1) + ',' + (s.canvas.height - 1));
    prepareDanmakuCanvas(s.ctx, s.canvas, dpr);
    expect(s.pixels.size).toBe(0);
    expect(s.getScale()).toBe(dpr);
    expect(s.calls.slice(-3)).toEqual(['scale:1', 'clear:' + s.canvas.width + 'x' + s.canvas.height, 'scale:' + dpr]);
  });
  it('does not leave a trail after repeated toggles with a fixed window size', () => {
    const s = surface(1.5);
    for (let frame = 0; frame < 100; frame++) {
      if (frame % 5 === 0) clearDanmakuCanvas(s.ctx, s.canvas);
      prepareDanmakuCanvas(s.ctx, s.canvas, 1.5);
      expect(s.pixels.size).toBe(0);
      s.pixels.add((s.canvas.width - 1 - frame) + ',60');
    }
    clearDanmakuCanvas(s.ctx, s.canvas);
    expect(s.pixels.size).toBe(0);
  });
  it('reallocates for a DPR/window change and clears the entire new backing store', () => {
    const s = surface(1);
    s.canvas.clientWidth = 220;
    s.canvas.clientHeight = 110;
    prepareDanmakuCanvas(s.ctx, s.canvas, 1.5);
    expect([s.canvas.width, s.canvas.height]).toEqual([330, 165]);
    expect(s.calls).toEqual(['scale:1', 'clear:330x165', 'scale:1.5']);
  });
});
