// src/renderer/lib/danmakuBitmap.ts
// ★ 弹幕文本位图缓存（P1-①，仿 DFM 的 DrawingCache / LruCache）：
//   「文本 + 字号 + 颜色 + DPR」→ 一张离屏位图；逐帧只做 drawImage（blit），
//   绕开每帧对每条在屏弹幕的 strokeText + fillText（两次文字栅格化）。
//
// 本模块**只做策略**（键 / LRU / 字节预算 / 统计），栅格化与释放由调用方注入
// ⇒ 不碰 DOM、可在纯 Node 环境单测；DOM 实现在 `renderer/components/DanmakuOverlay`。

/** 栅格化产物：位图本体 + CSS px 下的尺寸/内边距（描边外扩），以及占用字节数（含 DPR 放大）。 */
export interface BitmapEntry<T> {
  bitmap: T;
  /** 位图在 CSS px 下的宽（= 文本宽 + 两侧 pad） */
  w: number;
  /** 位图在 CSS px 下的高（= 行高 + 上下 pad） */
  h: number;
  /** 内边距（CSS px）：绘制时左上角要回退 pad，让文本起笔仍落在 (x, y) */
  pad: number;
  /** 位图字节数（deviceW × deviceH × 4），用于字节预算淘汰 */
  bytes: number;
}

/** 栅格化器：画不了/量不了时返回 null（调用方回退到逐帧 strokeText + fillText）。 */
export interface BitmapRasterizer<T> {
  rasterize(text: string, fontSize: number, color: string, dpr: number): BitmapEntry<T> | null;
  /** 淘汰时释放位图（DOM 实现可把 canvas 置 0×0 帮浏览器尽早回收；无此能力可空转） */
  release(bitmap: T): void;
}

export interface BitmapCacheOptions {
  /** 条目数上限（默认 800） */
  maxEntries?: number;
  /** 字节预算（默认 24MB；★ 这笔内存计入「内存优化」专项预算） */
  maxBytes?: number;
  /** 单张位图超过该字节数则**不入缓存**（默认 maxBytes/8）—— 避免一张巨图把整池挤空 */
  skipBytes?: number;
}

export interface BitmapCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  skipped: number;
}

const MB = 1024 * 1024;

/**
 * LRU 位图缓存。命中即移到队尾；插入后按「条目数 + 字节」双阈值淘汰最旧，
 * 且**永不动刚插入的那一条**（哪怕它单独超预算 —— 这种图在 `get` 里已被 skipBytes 拦下）。
 */
export class DanmakuBitmapCache<T> {
  private cache = new Map<string, BitmapEntry<T>>(); // 插入序 = LRU（越靠前越旧）
  private used = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly skipBytes: number;
  private stats: BitmapCacheStats = { hits: 0, misses: 0, evictions: 0, skipped: 0 };

  constructor(private readonly rasterizer: BitmapRasterizer<T>, opts: BitmapCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? 800));
    this.maxBytes = Math.max(1, Math.floor(opts.maxBytes ?? 24 * MB));
    this.skipBytes = Math.max(1, Math.floor(opts.skipBytes ?? this.maxBytes / 8));
  }

  private key(text: string, fontSize: number, color: string, dpr: number): string {
    // DPR 入键 ⇒ 换屏/改缩放后旧位图自然老化（不会被错用）；颜色/字号同理
    return `${dpr}\u0000${fontSize}\u0000${color}\u0000${text}`;
  }

  /** 取位图（命中即 LRU touch）；未命中则栅格化并尝试入缓存。栅格化失败返回 null。 */
  get(text: string, fontSize: number, color: string, dpr: number): BitmapEntry<T> | null {
    const k = this.key(text, fontSize, color, dpr);
    const hit = this.cache.get(k);
    if (hit) {
      this.stats.hits++;
      this.cache.delete(k);
      this.cache.set(k, hit); // LRU touch
      return hit;
    }
    this.stats.misses++;
    const made = this.rasterizer.rasterize(text, fontSize, color, dpr);
    if (!made) return null;
    if (made.bytes > this.skipBytes || made.bytes > this.maxBytes) {
      this.stats.skipped++; // 太大 ⇒ 本次照画但不入缓存（下帧重栅格化，也不会拖垮池子）
      return made;
    }
    this.cache.set(k, made);
    this.used += made.bytes;
    this.evict();
    return made;
  }

  private evict(): void {
    while ((this.cache.size > this.maxEntries || this.used > this.maxBytes) && this.cache.size > 1) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const entry = this.cache.get(oldestKey);
      if (!entry) break;
      this.cache.delete(oldestKey);
      this.used -= entry.bytes;
      this.stats.evictions++;
      try {
        this.rasterizer.release(entry.bitmap);
      } catch {
        /* 释放失败不影响功能 */
      }
    }
  }

  /** 清空并释放全部位图（如组件卸载时调用，避免常驻 24MB）。 */
  clear(): void {
    for (const e of this.cache.values()) {
      try {
        this.rasterizer.release(e.bitmap);
      } catch {
        /* ignore */
      }
    }
    this.cache.clear();
    this.used = 0;
  }

  get size(): number {
    return this.cache.size;
  }

  get bytes(): number {
    return this.used;
  }

  getStats(): BitmapCacheStats {
    return { ...this.stats };
  }
}
