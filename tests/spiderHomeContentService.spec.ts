import { describe, expect, it, vi } from 'vitest';
import { SpiderResultNormalizer } from '../src/engine/vod/SpiderResultNormalizer';
import { SpiderHomeContentService, type SpiderHomeDeadlinePort } from '../src/engine/vod/application/SpiderHomeContentService';

const immediateDeadline: SpiderHomeDeadlinePort = {
  now: () => 0,
  within: <T>(promise: Promise<T>) => promise,
};

function catalog(names: string[], withClass = true): string {
  return JSON.stringify({
    class: withClass ? [{ type_id: 'films', type_name: '电影' }] : [],
    list: names.map((name, index) => ({ vod_id: String(index + 1), vod_name: name })),
  });
}

function createService(deadline: SpiderHomeDeadlinePort = immediateDeadline) {
  const logger = { i: vi.fn(), w: vi.fn() };
  return { service: new SpiderHomeContentService(new SpiderResultNormalizer(), logger, deadline), logger };
}

describe('SpiderHomeContentService', () => {
  it('uses a full home page as-is and does not call fallback operations', async () => {
    const { service } = createService();
    const homeVideoContent = vi.fn(() => catalog(['fallback']));
    const categoryContent = vi.fn(() => catalog(['category']));

    const result = await service.load('source-a', {
      homeContent: () => catalog(Array.from({ length: 20 }, (_, index) => `home-${index}`)),
      homeVideoContent,
      categoryContent,
    }, 1000);

    expect(result.items).toHaveLength(20);
    expect(result.sourceKey).toBe('source-a');
    expect(result.homeFallback).toBeUndefined();
    expect(homeVideoContent).not.toHaveBeenCalled();
    expect(categoryContent).not.toHaveBeenCalled();
  });

  it('selects the richer category result after the recommendation fallback', async () => {
    const { service } = createService();
    const result = await service.load('source-b', {
      homeContent: () => catalog(['home-1']),
      homeVideoContent: () => catalog(['recommendation-1', 'recommendation-2']),
      categoryContent: () => catalog(['category-1', 'category-2', 'category-3']),
    }, 1000);

    expect(result.items.map((item) => item.name)).toEqual(['category-1', 'category-2', 'category-3']);
    expect(result.homeFallback).toBe(true);
  });

  it('spends one decreasing request budget across home and recommendation calls', async () => {
    let elapsed = 0;
    const budgets: number[] = [];
    const deadline: SpiderHomeDeadlinePort = {
      now: () => elapsed,
      async within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        budgets.push(timeoutMs);
        elapsed += 125;
        return promise;
      },
    };
    const { service } = createService(deadline);

    await service.load('source-c', {
      homeContent: () => catalog(['home-1'], false),
      homeVideoContent: () => catalog(['recommendation-1', 'recommendation-2'], false),
    }, 1000);

    expect(budgets).toEqual([1000, 875]);
  });

  it('reports a missing home capability separately from an empty response', async () => {
    const { service } = createService();

    await expect(service.load('source-d', {}, 1000)).rejects.toMatchObject({
      code: 'OPERATION_UNSUPPORTED',
      detail: { sourceKey: 'source-d', operation: 'homeContent' },
    });
  });
});
