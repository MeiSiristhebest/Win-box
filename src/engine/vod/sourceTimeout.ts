/** Resolve the configured source timeout once at the gateway boundary. */
export function sourceRequestTimeoutMs(
  bean: { timeout?: number } | null | undefined,
  fallbackMs: number,
): number {
  const seconds = Number(bean?.timeout) || 0;
  return seconds > 0 ? Math.round(seconds * 1000) : fallbackMs;
}
