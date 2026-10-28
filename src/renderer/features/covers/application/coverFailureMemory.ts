/** Failed image URLs are remembered to prevent retry loops in a mounted gallery. */
export const COVER_FAILURE_MEMORY_MAX_URLS = 1_000;

export type CoverFailureMemory = Array<readonly [itemKey: string, url: string]>;

/** Add one failure while keeping the long-lived UI memory bounded. */
export function rememberFailedCover(
  previous: CoverFailureMemory,
  key: string,
  url: string,
): CoverFailureMemory {
  if (!key || !url || previous.some(([itemKey, failedUrl]) => itemKey === key && failedUrl === url)) return previous;
  return [...previous, [key, url] as const].slice(-COVER_FAILURE_MEMORY_MAX_URLS);
}
