import { describe, expect, it, vi } from 'vitest';
import type { ExplorePage, ExploreQuery } from '../src/shared/discover';
import type { DiscoverItem } from '../src/shared/types';
import { loadDiscoverExploreBatch } from '../src/renderer/features/discovery/application/discoverExploreUseCase';

function item(index: number): DiscoverItem {
  return { title: `影片 ${index}`, year: 2024, poster: '', mediaType: 'movie', doubanId: String(index) };
}

function page(items: DiscoverItem[], start: number, nextStart: number, hasMore: boolean, total = 80): ExplorePage {
  return { items, start, nextStart, hasMore, total };
}

const query: Omit<ExploreQuery, 'start' | 'count'> = { mediaType: 'movie', tags: ['电影'] };

describe('loadDiscoverExploreBatch', () => {
  it('reads additional upstream pages to replace duplicates until a 40-item batch is full', async () => {
    const firstPage = [...Array.from({ length: 39 }, (_, index) => item(index)), item(0)];
    const queryPage = vi.fn()
      .mockResolvedValueOnce(page(firstPage, 0, 40, true))
      .mockResolvedValueOnce(page([item(39)], 40, 80, false));
    const publish = vi.fn();

    const result = await loadDiscoverExploreBatch({ query: queryPage }, {
      query, start: 0, existingItems: [], initialTotal: 0, preserveUntilComplete: false,
    }, publish);

    expect(result.items).toHaveLength(40);
    expect(result.items.map(entry => entry.doubanId)).toEqual(Array.from({ length: 40 }, (_, index) => String(index)));
    expect(result.nextStart).toBe(80);
    expect(result.total).toBe(80);
    expect(result.hasMore).toBe(false);
    expect(queryPage).toHaveBeenNthCalledWith(1, { ...query, start: 0, count: 40 });
    expect(queryPage).toHaveBeenNthCalledWith(2, { ...query, start: 40, count: 1 });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('keeps existing results when appending the next batch', async () => {
    const existing = item(0);
    const queryPage = vi.fn().mockResolvedValue(page(Array.from({ length: 40 }, (_, index) => item(index + 1)), 40, 80, true, 100));
    const publish = vi.fn();

    const result = await loadDiscoverExploreBatch({ query: queryPage }, {
      query, start: 40, existingItems: [existing], initialTotal: 99, preserveUntilComplete: false,
    }, publish);

    expect(result.items).toHaveLength(41);
    expect(result.items[0]).toEqual(existing);
    expect(result.total).toBe(100);
    expect(queryPage).toHaveBeenCalledOnce();
    expect(queryPage).toHaveBeenCalledWith({ ...query, start: 40, count: 40 });
    expect(publish).toHaveBeenCalledOnce();
  });

  it('keeps refresh results unpublished until the replacement batch is complete', async () => {
    const queryPage = vi.fn().mockResolvedValue(page(Array.from({ length: 40 }, (_, index) => item(index)), 0, 40, true, 100));
    const publish = vi.fn();

    const result = await loadDiscoverExploreBatch({ query: queryPage }, {
      query: { ...query, refresh: true }, start: 0, existingItems: [], initialTotal: 99, preserveUntilComplete: true,
    }, publish);

    expect(result.items).toHaveLength(40);
    expect(result.total).toBe(100);
    expect(queryPage).toHaveBeenCalledWith({ ...query, refresh: true, start: 0, count: 40 });
    expect(publish).not.toHaveBeenCalled();
  });

  it('stops at the configured source offset ceiling even when the provider reports more', async () => {
    const queryPage = vi.fn().mockResolvedValue(page([item(1)], 480, 500, true));

    const result = await loadDiscoverExploreBatch({ query: queryPage }, {
      query, start: 480, existingItems: [], initialTotal: 600, preserveUntilComplete: false,
    });

    expect(queryPage).toHaveBeenCalledTimes(1);
    expect(queryPage).toHaveBeenCalledWith({ ...query, start: 480, count: 40 });
    expect(result.nextStart).toBe(500);
    expect(result.hasMore).toBe(false);
  });
});
