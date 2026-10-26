import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpiderCache, SpiderCacheCapacityError } from '../src/engine/spider/SpiderCache';
import { isSpiderOperationImplemented, Spider, type SpiderInit } from '../src/engine/spider/Spider';

afterEach(() => {
  vi.useRealTimers();
});

function disposableSpider(overrides: Partial<Spider> = {}): Spider {
  return {
    siteKey: 'source',
    cancelByTag: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as Spider;
}

function spiderInit(key: string): SpiderInit {
  return { key, api: '', ext: '', jar: '', host: {} as SpiderInit['host'] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('SpiderCache lifecycle', () => {
  it('cancels and destroys each unique adapter when clearing cached instances', () => {
    const cache = new SpiderCache();
    const shared = disposableSpider();
    const other = disposableSpider();
    cache.set('one', shared);
    cache.set('alias', shared);
    cache.set('two', other);

    cache.clear();

    expect(cache.get('one')).toBeUndefined();
    expect(cache.get('two')).toBeUndefined();
    expect(shared.cancelByTag).toHaveBeenCalledOnce();
    expect(shared.destroy).toHaveBeenCalledOnce();
    expect(other.cancelByTag).toHaveBeenCalledOnce();
    expect(other.destroy).toHaveBeenCalledOnce();
    cache.clear();
    expect(shared.destroy).toHaveBeenCalledOnce();
  });

  it('reports synchronous and asynchronous teardown errors while continuing cleanup', async () => {
    const report = vi.fn();
    const cache = new SpiderCache(report);
    const syncFailure = new Error('sync teardown failed');
    const asyncFailure = new Error('async teardown failed');
    const broken = disposableSpider({ destroy: vi.fn(() => { throw syncFailure; }) });
    const delayed = disposableSpider({ destroy: vi.fn(() => Promise.reject(asyncFailure)) });
    const healthy = disposableSpider();
    cache.set('broken', broken);
    cache.set('delayed', delayed);
    cache.set('healthy', healthy);

    cache.clear();
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(syncFailure, broken);
    expect(report).toHaveBeenCalledWith(asyncFailure, delayed);
    expect(healthy.destroy).toHaveBeenCalledOnce();
  });

  it('bounds retained sources with LRU eviction and rebuilds a cold source', () => {
    const cache = new SpiderCache(undefined, { maxEntries: 8, ttlMs: 60_000 });
    const spiders: Spider[] = [];

    for (let index = 0; index < 256; index += 1) {
      const spider = disposableSpider({ homeContent: vi.fn(() => `source-${index}`) });
      spiders.push(spider);
      const cached = cache.getOrPut(`source-${index}`, () => spider);
      expect(cached.homeContent(false)).toBe(`source-${index}`);
    }

    expect(cache.size).toBe(8);
    expect(spiders.slice(0, 248).every((spider) => (spider.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(spiders.slice(248).every((spider) => (spider.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);

    const rebuilt = disposableSpider({ homeContent: vi.fn(() => 'rebuilt') });
    expect(cache.getOrPut('source-0', () => rebuilt).homeContent(false)).toBe('rebuilt');
    expect(spiders[248]?.destroy).toHaveBeenCalledOnce();
    expect(cache.size).toBe(8);
    cache.clear();
  });

  it('does not evict a source while an asynchronous method holds its lease', async () => {
    vi.useFakeTimers();
    const cache = new SpiderCache(undefined, { maxEntries: 1, ttlMs: 60_000 });
    const gate = deferred<string>();
    const activeSpider = disposableSpider({ searchContent: vi.fn(() => gate.promise) });
    const active = cache.getOrPut('active', () => activeSpider);
    const pending = Promise.resolve(active.searchContent('term', false));

    expect(cache.activeLeaseCount).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(cache.size).toBe(1);
    expect(activeSpider.destroy).not.toHaveBeenCalled();
    const blockedFactory = vi.fn(() => disposableSpider());
    expect(() => cache.getOrPut('next', blockedFactory)).toThrow(SpiderCacheCapacityError);
    expect(blockedFactory).not.toHaveBeenCalled();
    expect(activeSpider.cancelByTag).not.toHaveBeenCalled();
    expect(activeSpider.destroy).not.toHaveBeenCalled();

    gate.resolve('[]');
    await expect(pending).resolves.toBe('[]');
    expect(cache.activeLeaseCount).toBe(0);

    const next = disposableSpider();
    cache.getOrPut('next', () => next);
    expect(activeSpider.destroy).toHaveBeenCalledOnce();
    expect(cache.size).toBe(1);
    cache.clear();
  });

  it('defers clear teardown until active calls settle', async () => {
    const cache = new SpiderCache(undefined, { maxEntries: 1 });
    const gate = deferred<string>();
    const spider = disposableSpider({ searchContent: vi.fn(() => gate.promise) });
    const pending = Promise.resolve(cache.getOrPut('active', () => spider).searchContent('term', false));

    cache.clear();
    expect(cache.size).toBe(0);
    const blockedFactory = vi.fn(() => disposableSpider());
    expect(() => cache.getOrPut('next', blockedFactory)).toThrow(SpiderCacheCapacityError);
    expect(blockedFactory).not.toHaveBeenCalled();
    expect(cache.activeLeaseCount).toBe(1);
    expect(spider.cancelByTag).not.toHaveBeenCalled();
    expect(spider.destroy).not.toHaveBeenCalled();

    gate.resolve('[]');
    await expect(pending).resolves.toBe('[]');
    expect(spider.cancelByTag).toHaveBeenCalledOnce();
    expect(spider.destroy).toHaveBeenCalledOnce();
    expect(cache.activeLeaseCount).toBe(0);
    cache.getOrPut('next', () => disposableSpider());
    cache.clear();
  });

  it('reclaims idle entries after TTL and constructs a fresh adapter on the next lookup', () => {
    vi.useFakeTimers();
    const cache = new SpiderCache(undefined, { ttlMs: 100 });
    const first = disposableSpider();
    cache.getOrPut('source', () => first);

    vi.advanceTimersByTime(99);
    expect(first.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(cache.size).toBe(0);
    expect(first.cancelByTag).toHaveBeenCalledOnce();
    expect(first.destroy).toHaveBeenCalledOnce();
    const second = disposableSpider();
    expect(cache.getOrPut('source', () => second)).not.toBe(first);
    expect(cache.size).toBe(1);
    cache.clear();
  });

  it('preserves spider capability detection through leased method wrappers', () => {
    class DefaultSpider extends Spider {}
    class SearchSpider extends Spider {
      override searchContent(): string { return '[]'; }
    }
    const cache = new SpiderCache();
    const defaults = cache.getOrPut('default', () => new DefaultSpider(spiderInit('default')));
    const search = cache.getOrPut('search', () => new SearchSpider(spiderInit('search')));

    expect(isSpiderOperationImplemented(defaults, 'searchContent')).toBe(false);
    expect(isSpiderOperationImplemented(search, 'searchContent')).toBe(true);
    cache.clear();
  });

  it('uses a lease proxy for frozen custom adapters', async () => {
    const cache = new SpiderCache();
    const gate = deferred<string>();
    let destroys = 0;
    class FrozenSearchSpider extends Spider {
      override searchContent(): Promise<string> { return gate.promise; }
      override destroy(): void { destroys += 1; }
    }
    const frozen = Object.freeze(new FrozenSearchSpider(spiderInit('frozen'))) as unknown as Spider;
    const leased = cache.getOrPut('frozen', () => frozen);
    const pending = Promise.resolve(leased.searchContent('term', false));

    expect(leased).not.toBe(frozen);
    expect(isSpiderOperationImplemented(leased, 'searchContent')).toBe(true);
    expect(cache.activeLeaseCount).toBe(1);
    cache.clear();
    expect(destroys).toBe(0);

    gate.resolve('[]');
    await expect(pending).resolves.toBe('[]');
    expect(destroys).toBe(1);
  });
});
