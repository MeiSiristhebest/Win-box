import { describe, expect, it, vi } from 'vitest';
import { SpiderCache } from '../src/engine/spider/SpiderCache';
import type { Spider } from '../src/engine/spider/Spider';

function disposableSpider(overrides: Partial<Spider> = {}): Spider {
  return {
    siteKey: 'source',
    cancelByTag: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as Spider;
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
});
