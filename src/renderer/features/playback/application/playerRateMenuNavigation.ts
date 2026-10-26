const navigationKeys = ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const;

export type PlayerRateMenuNavigationKey = typeof navigationKeys[number];

/** Pure focus-index policy for the playback-rate radio menu. */
export function nextPlayerRateMenuFocusIndex(
  key: string,
  currentIndex: number,
  optionCount: number,
): number | null {
  if (optionCount <= 0 || !navigationKeys.includes(key as PlayerRateMenuNavigationKey)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return optionCount - 1;
  if (currentIndex < 0 || currentIndex >= optionCount) return key === 'ArrowDown' ? 0 : optionCount - 1;
  return (currentIndex + (key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount;
}
