// Source runtime cache. A cached adapter may own a node:vm context or process handle,
// so the cache bounds retained instances and delays teardown until active calls settle.
import { markSpiderMethodOrigin, type Spider } from './Spider';

export interface SpiderCacheOptions {
  /** Maximum retained source runtime configurations. Defaults to 64. */
  maxEntries?: number;
  /** Time since last use before an idle entry is destroyed. Defaults to 10 minutes. */
  ttlMs?: number;
  now?: () => number;
}

export class SpiderCacheCapacityError extends Error {
  constructor(readonly capacity: number) {
    super(`蜘蛛运行时缓存已满（${capacity} 个实例仍在使用），暂时无法创建新实例`);
    this.name = 'SpiderCacheCapacityError';
  }
}

interface SpiderRecord {
  spider: Spider;
  entries: Set<SpiderCacheEntry>;
  activeLeases: number;
  retired: boolean;
  destroyed: boolean;
  proxyRequired: boolean;
}

interface SpiderCacheEntry {
  key: string;
  record: SpiderRecord;
  lastUsedAt: number;
  activeLeases: number;
  removed: boolean;
  value: Spider;
  methodWrappers: Map<PropertyKey, { original: Function; wrapped: Function }>;
}

const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TTL_MS = 10 * 60_000;

export class SpiderCache {
  private readonly entries = new Map<string, SpiderCacheEntry>();
  private readonly records = new WeakMap<Spider, SpiderRecord>();
  private readonly liveRecords = new Set<SpiderRecord>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onDisposeError: (error: unknown, spider: Spider) => void = () => undefined,
    options: SpiderCacheOptions = {},
  ) {
    this.maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
    this.ttlMs = positiveInteger(options.ttlMs, DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  /** Number of retained source configurations, useful for bounded-cache diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  /** Current in-flight method calls across distinct cached spiders. */
  get activeLeaseCount(): number {
    let total = 0;
    for (const record of this.liveRecords) total += record.activeLeases;
    return total;
  }

  get(key: string): Spider | undefined {
    this.expireIdleEntries();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.touch(entry);
    return entry.value;
  }

  set(key: string, spider: Spider): void {
    this.expireIdleEntries();
    const current = this.entries.get(key);
    if (current?.record.spider === spider) {
      this.touch(current);
      return;
    }
    if (current) this.retireEntry(current);
    const existingRecord = this.records.get(spider);
    if (!this.makeRoom(!existingRecord || existingRecord.retired || existingRecord.destroyed)) {
      throw new SpiderCacheCapacityError(this.maxEntries);
    }
    this.insert(key, spider);
    this.scheduleExpiry();
  }

  getOrPut(key: string, factory: () => Spider): Spider {
    this.expireIdleEntries();
    const current = this.entries.get(key);
    if (current) {
      this.touch(current);
      return current.value;
    }
    // Do not construct a native/VM adapter if every retained instance is leased.
    if (!this.makeRoom()) throw new SpiderCacheCapacityError(this.maxEntries);
    const spider = factory();
    const entry = this.insert(key, spider);
    this.scheduleExpiry();
    return entry.value;
  }

  /** Retires all current entries. Active calls finish before their adapter is destroyed. */
  clear(): void {
    this.cancelExpiry();
    for (const entry of this.entries.values()) this.retireEntry(entry);
  }

  private insert(key: string, spider: Spider): SpiderCacheEntry {
    const record = this.recordFor(spider);
    const entry: SpiderCacheEntry = {
      key,
      record,
      lastUsedAt: this.now(),
      activeLeases: 0,
      removed: false,
      value: spider,
      methodWrappers: new Map(),
    };
    if (record.proxyRequired) entry.value = this.createLeaseProxy(entry);
    record.entries.add(entry);
    this.entries.set(key, entry);
    return entry;
  }

  private recordFor(spider: Spider): SpiderRecord {
    const existing = this.records.get(spider);
    if (existing) {
      if (existing.destroyed || existing.retired) throw new Error('不能重新缓存已销毁的蜘蛛实例');
      return existing;
    }
    const record: SpiderRecord = {
      spider,
      entries: new Set(),
      activeLeases: 0,
      retired: false,
      destroyed: false,
      proxyRequired: false,
    };
    this.records.set(spider, record);
    this.liveRecords.add(record);
    this.installMethodLeases(record);
    return record;
  }

  private installMethodLeases(record: SpiderRecord): void {
    const spider = record.spider as Spider & Record<PropertyKey, unknown>;
    if (!Object.isExtensible(spider)) {
      record.proxyRequired = true;
      return;
    }
    const methodNames = new Set<PropertyKey>();
    for (let prototype: object | null = spider; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype) as object | null) {
      for (const property of Reflect.ownKeys(prototype)) {
        if (property === 'constructor' || property === 'destroy' || property === 'cancelByTag' || methodNames.has(property)) continue;
        const original = Reflect.get(spider, property, spider) as unknown;
        if (typeof original !== 'function') continue;
        methodNames.add(property);
        const wrapped = this.leaseMethod(record, original);
        markSpiderMethodOrigin(wrapped, original);
        const ownDescriptor = Object.getOwnPropertyDescriptor(spider, property);
        try {
          Object.defineProperty(spider, property, ownDescriptor
            ? { ...ownDescriptor, value: wrapped }
            : { configurable: true, enumerable: false, writable: true, value: wrapped });
        } catch {
          // Sealed custom adapters use a method proxy instead of mutating the instance.
          record.proxyRequired = true;
          return;
        }
      }
    }
  }

  private createLeaseProxy(entry: SpiderCacheEntry): Spider {
    const target = entry.record.spider;
    return new Proxy(target, {
      get: (spider, property) => {
        const value = Reflect.get(spider, property, spider) as unknown;
        if (property === 'destroy' || property === 'cancelByTag') {
          return typeof value === 'function' ? value.bind(spider) : value;
        }
        if (typeof value !== 'function') return value;
        const cached = entry.methodWrappers.get(property);
        if (cached?.original === value) return cached.wrapped;
        const wrapped = this.leaseMethod(entry.record, value);
        markSpiderMethodOrigin(wrapped, value);
        entry.methodWrappers.set(property, { original: value, wrapped });
        return wrapped;
      },
    });
  }

  private leaseMethod(record: SpiderRecord, original: Function): (...args: unknown[]) => unknown {
    return (...args: unknown[]): unknown => {
      const entry = this.currentEntry(record);
      const release = this.acquire(entry);
      let result: unknown;
      try {
        result = Reflect.apply(original, record.spider, args);
      } catch (error) {
        release();
        throw error;
      }
      try {
        if (isPromiseLike(result)) return Promise.resolve(result).finally(release);
      } catch (error) {
        release();
        throw error;
      }
      release();
      return result;
    };
  }

  private currentEntry(record: SpiderRecord): SpiderCacheEntry {
    let current: SpiderCacheEntry | undefined;
    for (const entry of record.entries) {
      if (entry.removed || this.entries.get(entry.key) !== entry) continue;
      if (!current || entry.lastUsedAt >= current.lastUsedAt) current = entry;
    }
    if (!current) throw new Error(`蜘蛛运行时缓存项已回收（${record.spider.siteKey}）`);
    this.touch(current);
    return current;
  }

  private acquire(entry: SpiderCacheEntry): () => void {
    if (entry.removed || entry.record.destroyed || this.entries.get(entry.key) !== entry) {
      throw new Error(`蜘蛛运行时缓存项已回收（${entry.key}）`);
    }
    entry.activeLeases += 1;
    entry.record.activeLeases += 1;
    entry.lastUsedAt = this.now();
    this.scheduleExpiry();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.activeLeases = Math.max(0, entry.activeLeases - 1);
      entry.record.activeLeases = Math.max(0, entry.record.activeLeases - 1);
      if (!entry.removed) entry.lastUsedAt = this.now();
      this.disposeRetiredRecord(entry.record);
      this.expireIdleEntries();
      this.scheduleExpiry();
    };
  }

  private makeRoom(additionalRecord = true): boolean {
    while (this.entries.size >= this.maxEntries || (additionalRecord && this.liveRecords.size >= this.maxEntries)) {
      let candidate: SpiderCacheEntry | undefined;
      for (const entry of this.entries.values()) {
        if (entry.activeLeases > 0) continue;
        if (!candidate || entry.lastUsedAt < candidate.lastUsedAt) candidate = entry;
      }
      if (!candidate) return false;
      this.retireEntry(candidate);
    }
    return true;
  }

  private expireIdleEntries(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const entry of this.entries.values()) {
      if (entry.activeLeases === 0 && entry.lastUsedAt <= cutoff) this.retireEntry(entry);
    }
  }

  private touch(entry: SpiderCacheEntry): void {
    if (entry.removed) return;
    entry.lastUsedAt = this.now();
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    this.scheduleExpiry();
  }

  private retireEntry(entry: SpiderCacheEntry): void {
    if (entry.removed) return;
    entry.removed = true;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    entry.record.entries.delete(entry);
    if (entry.record.entries.size === 0) entry.record.retired = true;
    this.disposeRetiredRecord(entry.record);
  }

  private disposeRetiredRecord(record: SpiderRecord): void {
    if (!record.retired || record.entries.size > 0 || record.activeLeases > 0 || record.destroyed) return;
    record.destroyed = true;
    this.liveRecords.delete(record);
    try {
      record.spider.cancelByTag();
    } catch (error) {
      this.reportDisposeError(error, record.spider);
    }
    try {
      const disposal = record.spider.destroy();
      if (disposal) void disposal.catch((error) => this.reportDisposeError(error, record.spider));
    } catch (error) {
      this.reportDisposeError(error, record.spider);
    }
  }

  private scheduleExpiry(): void {
    this.cancelExpiry();
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const entry of this.entries.values()) {
      if (entry.activeLeases > 0) continue;
      nextExpiry = Math.min(nextExpiry, entry.lastUsedAt + this.ttlMs);
    }
    if (!Number.isFinite(nextExpiry)) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.expireIdleEntries();
      this.scheduleExpiry();
    }, Math.max(0, nextExpiry - this.now()));
    this.expiryTimer.unref?.();
  }

  private cancelExpiry(): void {
    if (!this.expiryTimer) return;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  }

  private reportDisposeError(error: unknown, spider: Spider): void {
    try {
      this.onDisposeError(error, spider);
    } catch {
      // Cleanup must not abort cache invalidation because its diagnostic sink failed.
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null && (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function';
}
