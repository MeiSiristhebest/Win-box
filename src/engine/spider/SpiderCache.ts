// src/engine/spider/SpiderCache.ts
// key → Spider 缓存（对应 JsLoader.spiders）。同源复用，避免重复初始化。
import type { Spider } from './Spider';

export class SpiderCache {
  private map = new Map<string, Spider>();

  constructor(private readonly onDisposeError: (error: unknown, spider: Spider) => void = () => undefined) {}

  get(key: string): Spider | undefined {
    return this.map.get(key);
  }

  set(key: string, spider: Spider): void {
    this.map.set(key, spider);
  }

  getOrPut(key: string, factory: () => Spider): Spider {
    let s = this.map.get(key);
    if (!s) {
      s = factory();
      this.map.set(key, s);
    }
    return s;
  }

  clear(): void {
    const spiders = [...new Set(this.map.values())];
    this.map.clear();

    for (const spider of spiders) {
      try {
        spider.cancelByTag();
      } catch (error) {
        this.reportDisposeError(error, spider);
      }

      try {
        const disposal = spider.destroy();
        if (disposal) void disposal.catch((error) => this.reportDisposeError(error, spider));
      } catch (error) {
        this.reportDisposeError(error, spider);
      }
    }
  }

  private reportDisposeError(error: unknown, spider: Spider): void {
    try {
      this.onDisposeError(error, spider);
    } catch {
      // Cleanup must not abort cache invalidation because its diagnostic sink failed.
    }
  }
}
