// tests/searchCache.spec.ts — 全源搜索「秒回」缓存（同关键词 TTL 内重复搜索直接返回上次报告）
import { describe, it, expect } from 'vitest';
import { SearchCache, searchCacheKey, SEARCH_CACHE_TTL_MS } from '../src/engine/vod/searchCache';

const T0 = 1_700_000_000_000;

describe('searchCacheKey', () => {
  it('trim + 小写 + 折叠空白（同一关键词的不同书写只存一份）', () => {
    expect(searchCacheKey('  狂飙 ')).toBe('狂飙');
    expect(searchCacheKey('Kuang  Biao')).toBe('kuang biao');
    expect(searchCacheKey('')).toBe('');
  });
});

describe('SearchCache', () => {
  it('写入后可命中；空关键词不缓存', () => {
    const c = new SearchCache<{ n: number }>();
    c.set('狂飙', { n: 3 }, T0);
    expect(c.getEntry('狂飙', T0 + 1000)?.value).toEqual({ n: 3 });
    expect(c.getEntry('狂飙', T0 + 1000)?.at).toBe(T0);
    expect(c.getEntry('  狂飙 ', T0 + 1000)).not.toBeNull(); // 归一化后同一份
    c.set('   ', { n: 1 }, T0);
    expect(c.size).toBe(1);
  });

  it('TTL 过期即失效并删除（默认 5 分钟）', () => {
    const c = new SearchCache<number>();
    c.set('狂飙', 1, T0);
    expect(c.getEntry('狂飙', T0 + SEARCH_CACHE_TTL_MS)).not.toBeNull(); // 边界内
    expect(c.getEntry('狂飙', T0 + SEARCH_CACHE_TTL_MS + 1)).toBeNull(); // 过期
    expect(c.size).toBe(0);
  });

  it('LRU：超过上限淘汰最旧的（上限 20）', () => {
    const c = new SearchCache<number>();
    for (let i = 0; i < 21; i++) c.set('kw' + i, i, T0 + i);
    expect(c.size).toBe(20);
    expect(c.getEntry('kw0', T0 + 100)).toBeNull(); // 最旧被淘汰
    expect(c.getEntry('kw20', T0 + 100)?.value).toBe(20);
  });

  it('按命中顺序淘汰 LRU，拒绝大报告时保留有效项并清理过期项', () => {
    const c = new SearchCache<string>(SEARCH_CACHE_TTL_MS, 2, 1000);
    c.set('first', 'a'.repeat(30), T0);
    c.set('second', 'b'.repeat(30), T0 + 1);
    expect(c.getEntry('first', T0 + 2)?.value).toBe('a'.repeat(30)); // 命中后移至 LRU 尾部

    c.set('third', 'c'.repeat(30), T0 + 3);
    expect(c.getEntry('second', T0 + 4)).toBeNull();
    expect(c.getEntry('first', T0 + 4)?.value).toBe('a'.repeat(30));
    expect(c.getEntry('third', T0 + 4)?.value).toBe('c'.repeat(30));

    c.set('oversized', 'x'.repeat(1000), T0 + 5);
    expect(c.getEntry('oversized', T0 + 6)).toBeNull();
    expect(c.getEntry('first', T0 + 6)?.value).toBe('a'.repeat(30));
    expect(c.getEntry('third', T0 + 6)?.value).toBe('c'.repeat(30));

    const expiring = new SearchCache<string>(10, 20, 1000);
    expiring.set('stale', 'kept only until TTL', T0);
    expiring.set('oversized', 'z'.repeat(1000), T0 + 11);
    expect(expiring.size).toBe(0);
    expect(expiring.estimatedBytes).toBe(0);
  });

  it('delete/clear：强制刷新（重新搜索）与配置变更时作废', () => {
    const c = new SearchCache<number>();
    c.set('狂飙', 1, T0);
    c.delete(' 狂飙');
    expect(c.getEntry('狂飙', T0 + 1)).toBeNull();
    c.set('狂飙', 2, T0);
    c.clear();
    expect(c.size).toBe(0);
  });
});