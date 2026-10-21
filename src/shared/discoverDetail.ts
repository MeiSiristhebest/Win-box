import type { DiscoverItem } from './types';

/** A discovery item is metadata, not a source-specific VOD id. */
export function discoverDetailRoute(item: DiscoverItem): string {
  const query = new URLSearchParams({ name: item.title, type: item.mediaType });
  if (item.year) query.set('year', String(item.year));
  if (item.poster) query.set('pic', item.poster);
  if (item.doubanId) query.set('doubanId', item.doubanId);
  if (item.tmdbId) query.set('tmdbId', String(item.tmdbId));
  if (item.rating) query.set('rating', String(item.rating));
  return '/movie?' + query.toString();
}
