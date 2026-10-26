import { describe, expect, it } from 'vitest';
import { nextPlayerRateMenuFocusIndex } from '../src/renderer/features/playback/application/playerRateMenuNavigation';

describe('playback rate menu focus policy', () => {
  it('moves through options and wraps at either end', () => {
    expect(nextPlayerRateMenuFocusIndex('ArrowDown', 0, 6)).toBe(1);
    expect(nextPlayerRateMenuFocusIndex('ArrowUp', 0, 6)).toBe(5);
    expect(nextPlayerRateMenuFocusIndex('ArrowDown', 5, 6)).toBe(0);
    expect(nextPlayerRateMenuFocusIndex('ArrowUp', 5, 6)).toBe(4);
  });

  it('jumps to the first and last option and starts predictably without a focused option', () => {
    expect(nextPlayerRateMenuFocusIndex('Home', 3, 6)).toBe(0);
    expect(nextPlayerRateMenuFocusIndex('End', 3, 6)).toBe(5);
    expect(nextPlayerRateMenuFocusIndex('ArrowDown', -1, 6)).toBe(0);
    expect(nextPlayerRateMenuFocusIndex('ArrowUp', -1, 6)).toBe(5);
  });

  it('ignores non-navigation keys and empty menus', () => {
    expect(nextPlayerRateMenuFocusIndex('Enter', 0, 6)).toBeNull();
    expect(nextPlayerRateMenuFocusIndex('ArrowDown', -1, 0)).toBeNull();
  });
});
