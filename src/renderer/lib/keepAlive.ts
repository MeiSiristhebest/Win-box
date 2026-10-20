// src/renderer/lib/keepAlive.ts
// ★ 2026-10-15（用户要求「伪墓碑」）：主界面内跳转时**不真正关闭上一个页面** —— 保持挂载、仅隐藏，
//   新页面只替换可见内容，返回时零重载（不做「真墓碑」那套卸载后序列化/恢复状态）。
//
// 本文件放：① 缓存键 / 分组 / 上限 / LRU 淘汰（纯函数，可单测）；② 页面可见性上下文（供页面按「是否可见」少做重活）。
// 组件壳在 App.tsx 的 KeepAliveRoutes。
import { createContext, useContext } from 'react';

/**
 * 该页面当前是否可见。隐藏的实例不应做「换源/换档案」这类重活（避免切源后每个缓存页都跟着重载）；
 * 非缓存页（直播/存储/配置/说明）恒为 `true`。
 */
export const PageActiveContext = createContext(true);

/** 页面内读取「本页是否可见」（隐藏页少做重活；重新可见时按需对齐一次全局状态） */
export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}

/** 单页内跳转时保持挂载的页面（返回零重载） */
const CACHEABLE = new Set(['/', '/boards', '/home', '/search', '/history', '/favorites']);

/** 详情页按「一部片一个实例」缓存（详情A → 详情B → 返回 也能零重载）；同一组最多保留这么多 */
export const DETAIL_CACHE_MAX = 4;

function isDetailPath(pathname: string): boolean {
  return /^\/detail(\/|$)/.test(pathname);
}

function isBoardPath(pathname: string): boolean {
  return /^\/boards\/[^/]+\/?$/.test(pathname);
}

/** 去掉尾斜杠（`/home/` 与 `/home` 视为同一页；根路径 `/` 除外） */
function normalizePath(pathname: string): string {
  const p = String(pathname || '');
  if (p.length > 1 && p.endsWith('/')) return p.replace(/\/+$/, '');
  return p;
}

/** 是否纳入伪墓碑缓存（详情按片独立缓存；直播/存储/配置/说明每次重载，保持既有语义） */
export function isCacheableRoute(pathname: string): boolean {
  if (isDetailPath(pathname)) return true;
  if (isBoardPath(pathname)) return true;
  return CACHEABLE.has(normalizePath(pathname));
}

/** 缓存键 = 完整 pathname（详情页因此做到「一部片一个实例」） */
export function cacheKeyOf(pathname: string): string {
  return pathname;
}

/** 缓存分组：同组按上限淘汰（详情同属 `/detail` 一组，其余各自成组） */
export function cacheGroupOf(pathname: string): string {
  return isDetailPath(pathname) ? '/detail' : isBoardPath(pathname) ? '/boards/item' : normalizePath(pathname);
}

/** 该路由同组实例上限（详情 4，其余 1） */
export function cacheLimitOf(pathname: string): number {
  return isDetailPath(pathname) ? DETAIL_CACHE_MAX : isBoardPath(pathname) ? 3 : 1;
}

export interface CacheEntryMeta {
  key: string;
  group: string;
  order: number;
}

/**
 * LRU 淘汰：同组实例数超过上限时，返回应淘汰的键（**最早访问的优先**，且**永不淘汰当前项**）。
 * 纯函数，仅按 `order` 判新旧；调用方删除对应条目即可。
 */
export function pickEvictions(
  entries: CacheEntryMeta[],
  currentKey: string,
  group: string,
  limit: number,
): string[] {
  const others = entries.filter((e) => e.group === group && e.key !== currentKey);
  const overflow = others.length + 1 - limit;
  if (overflow <= 0) return [];
  return others.sort((a, b) => a.order - b.order).slice(0, overflow).map((e) => e.key);
}
