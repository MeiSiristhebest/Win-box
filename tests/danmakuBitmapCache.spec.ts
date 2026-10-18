// tests/danmakuBitmapCache.spec.ts
// 弹幕文本位图缓存**策略**单测（P1-①）：键构成 / LRU 淘汰 / 字节预算 / 单图过大不入池 / 失败回退 / clear。
// 策略与栅格化解耦 ⇒ 纯 Node 可测（本模块不碰 DOM）。
import { describe, expect, it } from 'vitest';
import { DanmakuBitmapCache, type BitmapEntry } from '../src/renderer/lib/danmakuBitmap';

/** 假栅格化器：位图用文本标识；字节 = 文本长度 × 1000（便于制造预算压力） */
function fakeRasterizer() {
  const made: string[] = [];
  const released: string[] = [];
  const rasterizer = {
    rasterize(text: string, fontSize: number, color: string, dpr: number): BitmapEntry<string> | null {
      if (text === 'FAIL') return null; // 模拟「拿不到 2D 上下文」
      made.push(text);
      return {
        bitmap: `${text}@${fontSize}/${color}/${dpr}`,
        w: text.length * fontSize + 8,
        h: Math.round(fontSize * 1.4) + 8,
        pad: 4,
        bytes: text.length * 1000,
      };
    },
    release(b: string) {
      released.push(b);
    },
  };
  return { rasterizer, made, released };
}

describe('DanmakuBitmapCache', () => {
  it('命中缓存：同参数第二次不再栅格化（hits / misses 计数）', () => {
    const { rasterizer, made } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer);
    const a = c.get('弹幕', 24, '#fff', 1);
    const b = c.get('弹幕', 24, '#fff', 1);
    expect(a).toBe(b); // 同一条目对象（直接复用位图）
    expect(made).toEqual(['弹幕']);
    expect(c.getStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('键含 文本 / 字号 / 颜色 / DPR：任一变化都重新栅格化（防错用旧位图）', () => {
    const { rasterizer, made } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer);
    c.get('a', 24, '#fff', 1);
    c.get('a', 24, '#fff', 2); // DPR 变
    c.get('a', 24, '#000', 1); // 颜色变
    c.get('a', 25, '#fff', 1); // 字号变
    c.get('b', 24, '#fff', 1); // 文本变
    expect(made).toEqual(['a', 'a', 'a', 'a', 'b']);
    expect(c.size).toBe(5);
  });

  it('LRU 淘汰：条目超上限时淘汰最久未用（命中会把它移到最新）', () => {
    const { rasterizer, released } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer, { maxEntries: 2 });
    c.get('A', 10, '#fff', 1);
    c.get('B', 10, '#fff', 1);
    c.get('A', 10, '#fff', 1); // touch A ⇒ B 变成最旧
    c.get('C', 10, '#fff', 1); // 触发淘汰
    expect(c.size).toBe(2);
    expect(released).toEqual(['B@10/#fff/1']);
    expect(c.getStats().evictions).toBe(1);
  });

  it('字节预算：条目数没超、字节超预算也淘汰最旧的', () => {
    const { rasterizer, released } = fakeRasterizer();
    // ★ 显式给足 skipBytes（默认 = maxBytes/8，此处预算故意压小 ⇒ 必须显式放开单图门槛）
    const c = new DanmakuBitmapCache(rasterizer, { maxEntries: 100, maxBytes: 2500, skipBytes: 1_000_000 });
    c.get('aa', 10, '#fff', 1); // 2000 字节
    expect(c.bytes).toBe(2000);
    c.get('bb', 10, '#fff', 1); // +2000 = 4000 > 2500 ⇒ 淘汰 aa
    expect(c.bytes).toBe(2000);
    expect(released).toHaveLength(1);
  });

  it('单张位图过大 ⇒ 不入缓存但这一次仍可用（skipped），也不挤掉已有条目', () => {
    const { rasterizer } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer, { maxEntries: 10, maxBytes: 8000, skipBytes: 3000 });
    c.get('aaa', 10, '#fff', 1); // 3000 ≤ 3000 ⇒ 入池
    const big = c.get('aaaa', 10, '#fff', 1); // 4000 > skipBytes ⇒ 不入池
    expect(big).not.toBeNull();
    expect(c.size).toBe(1);
    expect(c.getStats().skipped).toBe(1);
    expect(c.getStats().evictions).toBe(0);
  });

  it('栅格化失败（返回 null）⇒ get 返回 null 且不污染缓存', () => {
    const { rasterizer } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer);
    expect(c.get('FAIL', 24, '#fff', 1)).toBeNull();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
    expect(c.getStats()).toMatchObject({ hits: 0, misses: 1 });
  });

  it('clear() 释放全部并归零', () => {
    const { rasterizer, released } = fakeRasterizer();
    const c = new DanmakuBitmapCache(rasterizer);
    c.get('aa', 10, '#fff', 1);
    c.get('bb', 10, '#fff', 1);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
    expect(released).toHaveLength(2);
  });
});
