export interface ResumePositionCandidates {
  kernelPosition: number;
  startTime?: number;
  storedPosition: number;
}

export function resolveResumePosition({
  kernelPosition,
  startTime,
  storedPosition,
}: ResumePositionCandidates): number {
  const fromKernel = Number.isFinite(kernelPosition) && kernelPosition > 3 ? kernelPosition : 0;
  const explicit = typeof startTime === 'number' && Number.isFinite(startTime) && startTime > 3 ? startTime : 0;
  const stored = Number.isFinite(storedPosition) ? storedPosition : 0;
  return fromKernel > 0 ? fromKernel : explicit > 0 ? explicit : stored || 0;
}

export function canRestoreHtml5Position(position: number, duration: number): boolean {
  return position > 3 && Boolean(duration) && Number.isFinite(duration) && position < duration - 5;
}

export function toMpvStartPosition(position: number): number {
  return Number.isFinite(position) && position > 3 ? Math.round(position) : 0;
}
