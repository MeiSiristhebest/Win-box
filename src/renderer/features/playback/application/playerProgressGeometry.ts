export interface ProgressTrackBounds {
  left: number;
  width: number;
}

export interface ProgressPercentages {
  played: number;
  buffered: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Converts a pointer coordinate measured by the DOM adapter into a bounded seek position. */
export function progressTimeAtPointer(
  clientX: number,
  bounds: ProgressTrackBounds,
  duration: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.width)
    || bounds.width <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
  const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1);
  return Math.round(ratio * duration);
}

/** Keeps the hover hint inside the same thumb-safe inset used by the player skin. */
export function progressHoverOffset(clientX: number, bounds: ProgressTrackBounds, inset = 22): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.width) || bounds.width <= 0) return null;
  return Math.min(Math.max(clientX - bounds.left, inset), Math.max(bounds.width - inset, inset));
}

/** Projects media values to safe CSS percentages, including live/unknown durations. */
export function projectProgressPercentages(currentTime: number, buffered: number, duration: number): ProgressPercentages {
  if (!Number.isFinite(duration) || duration <= 0) return { played: 0, buffered: 0 };
  const percentage = (time: number) => Number.isFinite(time) ? clamp((time / duration) * 100, 0, 100) : 0;
  return { played: percentage(currentTime), buffered: percentage(buffered) };
}
