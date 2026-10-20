// tests/keepAlive.spec.ts
// ★ 2026-10-15（用户要求「伪墓碑」）：主界面内跳转的缓存范围与 LRU 淘汰（纯函数）。
import { describe, it, expect } from 'vitest';
import {
  isCacheableRoute,
  cacheKeyOf,
  cacheGroupOf,
  cacheLimitOf,
  pickEvictions,
  DETAIL_CACHE_MAX,
} from '../src/renderer/lib/keepAlive';

describe('缓存范围 — 哪些页面保持挂载', () => {
  it('发现 / 点播 / 全源搜索 / 历史 / 收藏 纳入缓存', () => {
    expect(isCacheableRoute('/')).toBe(true);
    expect(isCacheableRoute('/home')).toBe(true);
    expect(isCacheableRoute('/search')).toBe(true);
    expect(isCacheableRoute('/history')).toBe(true);
    expect(isCacheableRoute('/favorites')).toBe(true);
  });

  it('详情（按片）纳入缓存', () => {
    expect(isCacheableRoute('/detail/srcA/12345')).toBe(true);
  });

  it('直播 / 存储 / 配置 / 说明 不纳入（切走即卸载）', () => {
    expect(isCacheableRoute('/live')).toBe(false);
    expect(isCacheableRoute('/storage')).toBe(false);
    expect(isCacheableRoute('/config')).toBe(false);
    expect(isCacheableRoute('/about')).toBe(false);
  });

  it('尾斜杠归一：/home/ 与 /home 同一页', () => {
    expect(isCacheableRoute('/home/')).toBe(true);
    expect(cacheGroupOf('/home/')).toBe('/home');
    expect(cacheGroupOf('/home')).toBe('/home');
  });

  it('详情路由不被误判：/detailx 不算详情', () => {
    expect(isCacheableRoute('/detailx')).toBe(false);
    expect(cacheGroupOf('/detailx')).toBe('/detailx');
  });
});

describe('缓存键与分组', () => {
  it('详情按完整 pathname 各成实例，但同属 /detail 一组', () => {
    expect(cacheKeyOf('/detail/a/1')).toBe('/detail/a/1');
    expect(cacheKeyOf('/detail/b/2')).toBe('/detail/b/2');
    expect(cacheGroupOf('/detail/a/1')).toBe('/detail');
    expect(cacheGroupOf('/detail/b/2')).toBe('/detail');
  });

  it('同一榜单的尾斜杠路径共用缓存键', () => {
    expect(cacheKeyOf('/boards/movie_top250/')).toBe('/boards/movie_top250');
    expect(cacheKeyOf('/boards/movie_top250')).toBe('/boards/movie_top250');
  });

  it('上限：详情 4，其余 1', () => {
    expect(cacheLimitOf('/detail/a/1')).toBe(DETAIL_CACHE_MAX);
    expect(cacheLimitOf('/home')).toBe(1);
    expect(cacheLimitOf('/search')).toBe(1);
  });
});

describe('LRU 淘汰 — 永不淘汰当前项，只淘汰同组最旧', () => {
  const entries = [
    { key: '/detail/a/1', group: '/detail', order: 1 },
    { key: '/detail/b/2', group: '/detail', order: 2 },
    { key: '/detail/c/3', group: '/detail', order: 3 },
    { key: '/detail/d/4', group: '/detail', order: 4 },
  ];

  it('未超上限（4 个 + 新增第 5 个才会淘汰 1）', () => {
    expect(pickEvictions(entries.slice(0, 3), '/detail/e/5', '/detail', 4)).toEqual([]);
  });

  it('已有 4 个 → 新增第 5 个淘汰最旧的 1 个（保留当前项）', () => {
    expect(pickEvictions(entries, '/detail/e/5', '/detail', 4)).toEqual(['/detail/a/1']);
  });

  it('当前项已在缓存中（回看旧片）→ 总数不变，不淘汰任何项', () => {
    expect(pickEvictions(entries, '/detail/b/2', '/detail', 4)).toEqual([]);
  });

  it('不同分组互不影响（淘汰只在同组内）', () => {
    const mixed = [
      { key: '/detail/a/1', group: '/detail', order: 1 },
      { key: '/home', group: '/home', order: 2 },
      { key: '/detail/b/2', group: '/detail', order: 3 },
      { key: '/detail/c/3', group: '/detail', order: 4 },
      { key: '/detail/d/4', group: '/detail', order: 5 },
    ];
    expect(pickEvictions(mixed, '/detail/e/5', '/detail', 4)).toEqual(['/detail/a/1']);
    expect(pickEvictions(mixed, '/search', '/search', 1)).toEqual([]);
  });
});
