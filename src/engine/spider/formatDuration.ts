/** Format a non-negative elapsed duration for spider runtime feedback. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return seconds + ' 秒';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? minutes + ' 分钟' : minutes + ' 分 ' + remainder + ' 秒';
}
