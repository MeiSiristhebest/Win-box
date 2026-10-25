import type { ExplorePage, ExploreQuery } from '../../../../shared/discover';
import type { DiscoverItem } from '../../../../shared/types';

export const DISCOVER_BATCH_SIZE = 40;
export const DISCOVER_MAX_ITEMS = 500;
const MAX_PAGES_PER_BATCH = 6;

export interface DiscoverExploreQueryPort {
  query(request: ExploreQuery): Promise<ExplorePage>;
}

export interface DiscoverExploreBatchRequest {
  query: Omit<ExploreQuery, 'start' | 'count'>;
  start: number;
  existingItems: readonly DiscoverItem[];
  initialTotal: number;
  preserveUntilComplete: boolean;
}

export interface DiscoverExploreBatchSnapshot {
  items: DiscoverItem[];
  nextStart: number;
  total: number;
  hasMore: boolean;
}

function identityOf(item: DiscoverItem): string {
  return String(item.doubanId || item.tmdbId || `${item.mediaType}:${item.title}:${item.year}`);
}

function appendUnique(current: readonly DiscoverItem[], incoming: readonly DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((item) => {
    const identity = identityOf(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/** Read enough upstream pages for one UI batch, accounting for duplicate/filtered items. */
export async function loadDiscoverExploreBatch(
  port: DiscoverExploreQueryPort,
  request: DiscoverExploreBatchRequest,
  onPage?: (snapshot: DiscoverExploreBatchSnapshot) => void,
): Promise<DiscoverExploreBatchSnapshot> {
  let nextStart = request.start;
  let items = [...request.existingItems];
  const targetCount = Math.min(DISCOVER_MAX_ITEMS, items.length + DISCOVER_BATCH_SIZE);
  let total = request.initialTotal;
  let hasMore = nextStart < DISCOVER_MAX_ITEMS;

  for (let page = 0; page < MAX_PAGES_PER_BATCH && items.length < targetCount && hasMore; page += 1) {
    const count = Math.min(DISCOVER_BATCH_SIZE, targetCount - items.length);
    const response = await port.query({ ...request.query, start: nextStart, count });
    const previousStart = nextStart;
    items = appendUnique(items, response.items);
    nextStart = response.nextStart ?? nextStart + count;
    total = response.total;
    hasMore = response.hasMore && nextStart > previousStart && nextStart < DISCOVER_MAX_ITEMS;

    const snapshot = { items, nextStart, total, hasMore };
    if (!request.preserveUntilComplete) onPage?.(snapshot);
  }

  return { items, nextStart, total, hasMore };
}
