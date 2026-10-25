export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  const minuteText = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return (hours > 0 ? String(hours) + ':' : '') + minuteText + ':' + String(remainder).padStart(2, '0');
}

/** Format a relay throughput value expressed in KB/s. */
export function formatNetworkSpeed(kilobytesPerSecond: number): string {
  if (!Number.isFinite(kilobytesPerSecond) || kilobytesPerSecond <= 0) return '';
  if (kilobytesPerSecond >= 1024) {
    const megabytesPerSecond = (kilobytesPerSecond / 1024).toFixed(2).replace(/\.?0+$/, '');
    return megabytesPerSecond + ' M/S';
  }
  return String(Math.round(kilobytesPerSecond)) + ' K/S';
}
