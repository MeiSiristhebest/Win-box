// src/engine/vod/searchCache.ts
// ★ 全源搜索「秒回」缓存（2026-09-23 三轮，用户要求「秒出」）：
//   同一关键词在 TTL 内再次搜索 → 直接返回上次报告（不再打任何源站），
//   用户按「重新搜索」可强制刷新（refresh=true 绕过缓存）。
//
// 纯 TS：可注入 now（单测无时钟依赖）、零 Node 依赖。

export interface CacheEntry<T> {
  /** 写入时间戳（ms） */
  at: number;
  value: T;
}

/** 缓存有效期：5 分钟（够「刚搜过又搜一次」的秒回；过期自动重搜，避免长期陈旧） */
export const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
/** 最多保留多少个关键词（LRU 淘汰最旧的） */
const MAX_ENTRIES = 20;
/** 搜索报告可能包含大量源与条目；限制缓存总占用，避免只按关键词数计算时长期保留过多结果。 */
export const SEARCH_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_WEIGHT_NODES = 100_000;

type StoredCacheEntry<T> = CacheEntry<T> & { weight: number };

/** 以有上限的遍历估算对象大小，不序列化整份报告，也不会因循环引用卡住。 */
function estimateWeight(value: unknown, maxBytes: number): number {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  const tooLarge = (): number => maxBytes + 1;

  while (stack.length > 0) {
    if (++nodes > MAX_WEIGHT_NODES) return tooLarge();
    const current = stack.pop();
    if (typeof current === 'string') bytes += current.length * 2;
    else if (typeof current === 'number' || typeof current === 'bigint') bytes += 8;
    else if (typeof current === 'boolean') bytes += 4;
    else if (current && typeof current === 'object') {
      if (seen.has(current)) continue;
      seen.add(current);
      if (Array.isArray(current)) {
        if (current.length > MAX_WEIGHT_NODES - nodes) return tooLarge();
        bytes += current.length * 8;
        for (const item of current) stack.push(item);
      } else {
        const keys = Object.keys(current);
        if (keys.length > MAX_WEIGHT_NODES - nodes) return tooLarge();
        bytes += keys.length * 16;
        for (const key of keys) {
          bytes += key.length * 2;
          stack.push((current as Record<string, unknown>)[key]);
        }
      }
    } else bytes += 4;

    if (bytes > maxBytes || stack.length > MAX_WEIGHT_NODES - nodes) return tooLarge();
  }
  return bytes;
}

/** 关键词归一：trim + 小写 + 折叠空白（「狂飙 」与「狂飙」「kuangbiao」大小写差异不该各存一份） */
export function searchCacheKey(wd: string): string {
  return (wd || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export class SearchCache<T> {
  private map = new Map<string, StoredCacheEntry<T>>();
  private bytes = 0;

  constructor(
    private readonly ttlMs: number = SEARCH_CACHE_TTL_MS,
    private readonly max = MAX_ENTRIES,
    private readonly maxBytes = SEARCH_CACHE_MAX_BYTES,
  ) {}

  private remove(k: string): void {
    const entry = this.map.get(k);
    if (!entry) return;
    this.map.delete(k);
    this.bytes = Math.max(0, this.bytes - entry.weight);
  }

  /** 取缓存条目（过期即删并返回 null；命中会刷新 LRU 顺序） */
  getEntry(wd: string, now = Date.now()): CacheEntry<T> | null {
    const k = searchCacheKey(wd);
    if (!k) return null;
    const e = this.map.get(k);
    if (!e) return null;
    if (now - e.at > this.ttlMs) {
      this.remove(k);
      return null;
    }
    this.map.delete(k);
    this.map.set(k, e);
    return { at: e.at, value: e.value };
  }

  set(wd: string, value: T, now = Date.now()): void {
    const k = searchCacheKey(wd);
    if (!k) return;
    for (const [existingKey, entry] of this.map) {
      if (now - entry.at > this.ttlMs) this.remove(existingKey);
    }
    let weight: number;
    try {
      weight = estimateWeight(value, this.maxBytes) + k.length * 2 + 64;
    } catch {
      this.remove(k);
      return;
    }
    this.remove(k);
    if (weight > this.maxBytes) return;

    this.map.set(k, { at: now, value, weight });
    this.bytes += weight;
    while (this.map.size > this.max || this.bytes > this.maxBytes) {
      const first = this.map.keys().next().value;
      if (first === undefined) break;
      this.remove(first);
    }
  }

  delete(wd: string): void {
    this.remove(searchCacheKey(wd));
  }

  /** 配置变更（源列表变了）→ 整表作废（旧报告里的源可能已不存在） */
  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }

  get estimatedBytes(): number {
    return this.bytes;
  }
}
