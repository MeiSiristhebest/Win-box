export type PosterSize = 'small' | 'medium' | 'large';

/** Poster widths in device-independent pixels, before Windows display scaling. */
export const POSTER_SIZE_OPTIONS: ReadonlyArray<{ value: PosterSize; label: string; width: number }> = [
  { value: 'small', label: '小', width: 128 },
  { value: 'medium', label: '标准', width: 160 },
  { value: 'large', label: '大', width: 200 },
];

export function normalizePosterSize(value: unknown): PosterSize {
  return value === 'small' || value === 'large' ? value : 'medium';
}

export function posterWidth(size: PosterSize, uiScale = 1): number {
  const width = POSTER_SIZE_OPTIONS.find(option => option.value === size)!.width;
  return width / (Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1);
}

export function posterIntrinsicHeight(size: PosterSize, uiScale = 1): number {
  const scale = Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1;
  return Math.round(posterWidth(size, scale) * 1.5 + 53 / scale);
}
