/** Apply a relative seek while preserving the media range. */
export function audioSeekByPosition(currentTime: number, duration: number, deltaSeconds: number): number | undefined {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || !Number.isFinite(deltaSeconds) || duration < 0) {
    return undefined;
  }
  return Math.max(0, Math.min(duration, currentTime + deltaSeconds));
}

/** Resume only from a useful saved position that still fits inside the current track. */
export function audioRestorePosition(position: number, duration: number): number | undefined {
  return position > 3 && Number.isFinite(duration) && position < duration - 3 ? position : undefined;
}

