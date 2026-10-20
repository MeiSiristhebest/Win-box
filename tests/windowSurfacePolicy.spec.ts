import { describe, expect, it, vi } from 'vitest';
import { applyWindowSurfacePolicy, windowSurfaceColor } from '../src/main/preferences/WindowSurfacePolicy';

describe('window surface policy', () => {
  it('uses each registered theme surface for application windows', () => {
    expect(windowSurfaceColor('dark', 'application')).toBe('#111317');
    expect(windowSurfaceColor('light', 'application')).toBe('#f7f8fa');
    expect(windowSurfaceColor('netflix', 'application')).toBe('#111317');
    expect(windowSurfaceColor('bilibili', 'application')).toBe('#f7f8fa');
    expect(windowSurfaceColor('apple', 'application')).toBe('#f7f8fa');
    expect(windowSurfaceColor('douban', 'application')).toBe('#f7f8fa');
  });

  it('does not apply an opaque color to the transparent player window', () => {
    const target = { isDestroyed: vi.fn(() => false), setBackgroundColor: vi.fn() };

    applyWindowSurfacePolicy(target, 'netflix', 'player');

    expect(target.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('skips closed windows and applies the theme surface to open application windows', () => {
    const closed = { isDestroyed: vi.fn(() => true), setBackgroundColor: vi.fn() };
    const open = { isDestroyed: vi.fn(() => false), setBackgroundColor: vi.fn() };

    applyWindowSurfacePolicy(closed, 'apple', 'application');
    applyWindowSurfacePolicy(open, 'apple', 'application');

    expect(closed.setBackgroundColor).not.toHaveBeenCalled();
    expect(open.setBackgroundColor).toHaveBeenCalledOnce();
    expect(open.setBackgroundColor).toHaveBeenCalledWith('#f7f8fa');
  });
});
