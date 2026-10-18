// tests/danmakuLayout.spec.ts
// 弹幕轨道布局纯函数单测：不重叠不变量、区域三档、密度抽样、时间偏移、超量抽稀、三分区、
// 重复合并 / 真实测量注入 / 零分配遍历（P0：测量 memo + 重复合并 + 绘制预算热路径）。
import { afterEach, describe, expect, it } from 'vitest';
import {
  danmakuArea,
  eachScrollDraw,
  layoutDanmaku,
  measureWidth,
  regionRows,
  scrollDrawList,
  scrollDrawStart,
  setTextMeasurer,
  zoneRows,
  REGION_RATIO,
} from '../src/engine/danmaku/layout';
import type { PlacedDanmaku, ScrollDraw } from '../src/engine/danmaku/layout';
import type { DanmakuItem, DanmakuRegion } from '../src/shared/danmaku';

const scroll = (time: number, text = '这是一条很长的弹幕内容'): DanmakuItem => ({
  time,
  type: 'scroll',
  text,
  size: 25,
  color: '#ffffff',
});

const base = { width: 800, height: 450, fontSize: 24, speed: 110, density: 1, offsetSec: 0 };

/**
 * ★ 独立几何校验（**故意不复用引擎里的 willHitScroll**，以免实现有错时测试跟着错）：
 * 同轨「后车 a」（更晚入场）与「前车 b」在共存期间的最小间隙（a 左缘 − b 右缘；< 0 = 追尾叠字）。
 */
const minGap = (a: PlacedDanmaku, b: PlacedDanmaku): number => {
  const d = a.item.time - b.item.time;
  const f0 = b.velocity * d - b.width;
  const span = Math.min(a.duration, b.duration - d);
  if (span <= 0) return Infinity; // 不共存
  return b.velocity >= a.velocity ? f0 : (b.velocity - a.velocity) * span + f0;
};

/** 同轨**全对**校验（不只看相邻两条：恒定行程时长下「后车追上前车」可能跨过中间车）。
 *  ★ 只做纯算术、最后断言一次 —— 高密度用例单轨可有上万条，逐对调 `expect` 会卡死（≈5×10⁷ 次）。 */
const expectNoHitPerRow = (placed: PlacedDanmaku[]) => {
  const byRow = new Map<number, PlacedDanmaku[]>();
  for (const p of placed) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
  for (const [row, arr] of byRow) {
    arr.sort((x, y) => x.item.time - y.item.time);
    let worst = Infinity;
    for (let i = 0; i < arr.length && worst >= 0; i++) {
      for (let j = i + 1; j < arr.length && worst >= 0; j++) {
        const g = minGap(arr[j], arr[i]);
        if (g < worst) worst = g;
      }
    }
    expect(worst, `行 ${row} 出现追尾（最小间隙 ${worst}）`).toBeGreaterThanOrEqual(-1e-6);
  }
};

describe('regionRows', () => {
  it('区域三档 → 行数映射（full 13 / half 6 / quarter 3，@450px×24px）', () => {
    expect(regionRows(450, 24, 'full')).toBe(13);
    expect(regionRows(450, 24, 'half')).toBe(6);
    expect(regionRows(450, 24, 'quarter')).toBe(3);
    expect(regionRows(0, 24, 'full')).toBe(1); // 极小高度保底 1 行
  });
  it('ratio 与 REGION_RATIO 一致', () => {
    expect(REGION_RATIO).toEqual({ full: 1, half: 0.5, quarter: 0.25 });
  });
});

describe('zoneRows（D2 分区）', () => {
  it('全屏 @450×24 → 滚动占大头，顶/底各 ≥1 行且互不占位', () => {
    const z = zoneRows(450, 24, 'full');
    expect(z.scroll + z.top + z.bottom).toBe(13);
    expect(z.scroll).toBeGreaterThanOrEqual(9);
    expect(z.top).toBeGreaterThanOrEqual(1);
    expect(z.bottom).toBeGreaterThanOrEqual(1);
  });
  it('极小高度保底：每区至少 1 行', () => {
    const z = zoneRows(10, 40, 'full');
    expect(z.scroll).toBeGreaterThanOrEqual(1);
    expect(z.top).toBeGreaterThanOrEqual(1);
    expect(z.bottom).toBeGreaterThanOrEqual(1);
  });
  it('半屏/四分之一屏行数不超总行数', () => {
    for (const r of ['full', 'half', 'quarter'] as const) {
      const z = zoneRows(450, 24, r);
      expect(z.scroll + z.top + z.bottom).toBe(regionRows(450, 24, r));
    }
  });
});

describe('layoutDanmaku', () => {
  it('同轨不追尾（几何不变量）：同轨允许多条共存，但任意两条共存期间间隙 ≥ 0', () => {
    const items = Array.from({ length: 60 }, (_, i) => scroll(i * 0.1)); // 6s 内 60 条密集弹幕
    const { scroll: s } = layoutDanmaku(items, { ...base, region: 'full' });
    expect(s.length).toBeGreaterThan(0);
    expectNoHitPerRow(s);
    // ★ 新模型下同轨确实会「共存多车」（旧口径要求前车完全出屏 ⇒ 每轨只会 1 条）
    const rows = [...new Set(s.map((p) => p.row))];
    expect(Math.max(...rows.map((r) => s.filter((p) => p.row === r).length))).toBeGreaterThan(1);
  });

  it('滚动弹幕不越界进入其它轨道空间（D2：row 限滚动区行数）', () => {
    const { scroll: s } = layoutDanmaku([scroll(1), scroll(2), scroll(3)], { ...base, region: 'half' });
    const maxRow = Math.max(...s.map((p) => p.row));
    expect(maxRow).toBeLessThan(zoneRows(450, 24, 'half').scroll);
  });

  it('密度抽样：density=0.5 时条数减半', () => {
    // 快速滚动（speed 2000 + 短文本）保证无轨道饱和丢弃，纯观察抽样效果
    const items = Array.from({ length: 20 }, (_, i) => scroll(i, 'a'));
    const fast = { width: 800, height: 450, fontSize: 24, speed: 2000, region: 'full' as DanmakuRegion, offsetSec: 0 };
    const full = layoutDanmaku(items, { ...fast, density: 1 });
    const half = layoutDanmaku(items, { ...fast, density: 0.5 });
    expect(full.scroll.length).toBe(20);
    expect(half.scroll.length).toBe(10);
  });

  it('时间偏移：负偏移把弹幕提前（时间 clamp ≥0）', () => {
    const items = [scroll(1), scroll(2.5), scroll(-3)]; // -3 被 clamp 到 0
    const out = layoutDanmaku(items, { ...base, region: 'full', offsetSec: -0.5 });
    const times = out.scroll.map((p) => p.item.time).sort((a, b) => a - b);
    expect(times[0]).toBeGreaterThanOrEqual(0);
    expect(times).toEqual([0, 0.5, 2]);
  });

  it('顶部/底部固定弹幕：activeUntil = time + dwell，velocity = 0', () => {
    const items: DanmakuItem[] = [
      { time: 1, type: 'top', text: '顶部', size: 25, color: '#ffffff' },
      { time: 2, type: 'bottom', text: '底部', size: 25, color: '#ffffff' },
    ];
    const out = layoutDanmaku(items, { ...base, region: 'full' });
    expect(out.top).toHaveLength(1);
    expect(out.bottom).toHaveLength(1);
    expect(out.top[0].velocity).toBe(0);
    expect(out.top[0].x0).toBe(0);
    expect(out.top[0].activeUntil).toBeGreaterThan(1);
    expect(out.bottom[0].activeUntil).toBeGreaterThan(2);
  });

  it('D2：滚动/顶/底三分区 y 不重叠（同刻出现也各居其位）', () => {
    const items: DanmakuItem[] = [
      { time: 1, type: 'scroll', text: '滚动弹幕滚动弹幕滚', size: 25, color: '#fff' },
      { time: 1, type: 'top', text: '顶部公告', size: 25, color: '#fff' },
      { time: 1, type: 'bottom', text: '底部公告', size: 25, color: '#fff' },
    ];
    const out = layoutDanmaku(items, { ...base, region: 'full' });
    const z = zoneRows(450, 24, 'full');
    const lineH = Math.round(24 * 1.4);
    expect(out.scroll.length).toBe(1);
    expect(out.top.length).toBe(1);
    expect(out.bottom.length).toBe(1);
    const sY = out.scroll[0].y;
    const tY = out.top[0].y;
    const bY = out.bottom[0].y;
    // 滚动区 y ∈ [0, scroll*lineH)；顶区在滚动区之下
    expect(sY).toBeGreaterThanOrEqual(0);
    expect(sY).toBeLessThan(z.scroll * lineH);
    expect(tY).toBeGreaterThanOrEqual(z.scroll * lineH);
    // 底区从区域底部向上：y ≥ bottom 区上边界（在滚动+顶之下）
    expect(bY).toBeGreaterThan(tY);
    expect(bY).toBeGreaterThanOrEqual(450 - (z.bottom - 1 + 1) * lineH); // 最底行 y = zoneH - lineH
  });

  it('D1：超量（>MAX_ITEMS）均匀抽稀而非丢尾部——末尾时间弹幕仍在', () => {
    // 11000 条跨 11000s：旧实现 slice(0,2000) 只留下 0~2000s，区间 [9000,11000] 全丢
    const items = Array.from({ length: 11000 }, (_, i) => scroll(i, 'a')); // 短文本→不饱和
    const fast = { width: 800, height: 450, fontSize: 24, speed: 2000, density: 1, region: 'full' as DanmakuRegion, offsetSec: 0 };
    const out = layoutDanmaku(items, fast);
    expect(out.scroll.length).toBeLessThanOrEqual(10000);
    expect(out.scroll.length).toBeGreaterThan(5000);
    const maxT = Math.max(...out.scroll.map((p) => p.item.time));
    const minT = Math.min(...out.scroll.map((p) => p.item.time));
    expect(minT).toBe(0);
    // 末尾区间仍有保留（均匀抽稀保分布）：尾部 ~2% 范围内应有弹幕
    expect(maxT).toBeGreaterThan(11000 * 0.98);
  });

  it('D1 抽稀不破排序与轨道不追尾', () => {
    const items = Array.from({ length: 12000 }, (_, i) => scroll(i * 0.1)); // 触发 >MAX_ITEMS 均匀抽稀
    const out = layoutDanmaku(items, { ...base, region: 'full' });
    // ★ 上万条时逐对全量校验是 O(n²)（实测拖到 ~5s，会扰动套件里其它时序用例）⇒ 每轨抽查前 40 条；
    //   全量逐对校验由「同轨不追尾（几何不变量）」与新增的密度/追赶用例覆盖。
    const byRow = new Map<number, PlacedDanmaku[]>();
    for (const p of out.scroll) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
    for (const arr of byRow.values()) expectNoHitPerRow(arr.slice(0, 40));
  });
});

// ---- ★ 2026-10-18 速度模型变更（用户拍板）：恒定行程时长 + willHit 追赶判定 ----
describe('恒定行程时长 + willHit 排轨', () => {
  // 单轨场景（滚动区恰好 1 行）：不放过就只能丢弃 ⇒ 便于断言「放行 / 不放行」
  const oneRow = { width: 800, height: 10, fontSize: 40, speed: 110, density: 1, region: 'quarter' as DanmakuRegion, offsetSec: 0 };

  it('行程时长恒定（= 屏宽/速度，与文本宽无关）；长句因此更快', () => {
    const out = layoutDanmaku([scroll(0, 'a'), scroll(1, '一二三四五六七八九十一二三四五六七八九十')], { ...base, region: 'full' });
    expect(out.scroll).toHaveLength(2);
    const dur = base.width / base.speed;
    for (const p of out.scroll) expect(p.activeUntil - p.item.time).toBeCloseTo(dur, 6);
    const short = out.scroll.find((p) => p.item.text === 'a')!;
    const long = out.scroll.find((p) => p.item.text !== 'a')!;
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.velocity).toBeGreaterThan(short.velocity); // 长句更快（同一个 duration）
    expect(short.velocity).toBeCloseTo((base.width + short.width) / dur, 6);
  });

  it('密度提升：前车「未出屏」也放行同轨第二辆（旧口径要等它完全出屏）', () => {
    expect(zoneRows(10, 40, 'quarter').scroll).toBe(1);
    const t = '测试弹幕测试弹幕';
    const dur = 800 / 110;
    const w = measureWidth(t, 40); // 8×40 = 320
    const enterDone = w / ((800 + w) / dur); // 前车「完全进屏」所需时间 ≈ 2.08s
    expect(enterDone).toBeGreaterThan(1);
    // d = 3s（> 完全进屏）→ 同速不追尾 ⇒ 放行（旧口径要 7.27s 才放行）
    const both = layoutDanmaku([scroll(0, t), scroll(3, t)], oneRow).scroll;
    expect(both).toHaveLength(2);
    expect(both.map((p) => p.row)).toEqual([0, 0]);
    expectNoHitPerRow(both);
    // d = 1s（< 完全进屏 ⇒ 入场即压在还没进屏的前车上）→ 不放过（单轨无别处可去 ⇒ 丢弃）
    expect(layoutDanmaku([scroll(0, t), scroll(1, t)], oneRow).scroll).toHaveLength(1);
  });

  it('追赶判定：长句更快、会在存活期内追上慢前车 ⇒ 不放过（否则会叠字）', () => {
    const out = layoutDanmaku([scroll(0, 'a'), scroll(2, '中'.repeat(30))], oneRow).scroll;
    expect(out).toHaveLength(1);
    expect(out[0].item.text).toBe('a');
  });
});

describe('measureWidth', () => {
  it('CJK ≈ size，ASCII ≈ size*0.6', () => {
    const f = 20;
    expect(measureWidth('中', f)).toBe(f);
    expect(measureWidth('a', f)).toBe(f * 0.6);
    expect(measureWidth('ab中', f)).toBe(f * 0.6 * 2 + f);
  });
});

// ---- ★ 2026-09-26 真 bug 回归：滚动弹幕"逐帧重绘"（旧实现每条只画一帧 → 平时看不到弹幕） ----
describe('scrollDrawStart / scrollDrawList（逐帧在屏集合）', () => {
  const opts = { ...base, width: 800, region: 'full' as DanmakuRegion };
  const one = (text: string, time = 0) => layoutDanmaku([scroll(time, text)], opts).scroll;

  it('一条滚动弹幕在其存活期内**每一帧都出现在绘制列表**（旧实现只画入界那一帧）', () => {
    const placed = one('测试弹幕');
    const v = placed[0].velocity; // ★ 恒定行程时长 ⇒ 速度随文本宽变化，不再等于 opts.speed
    let start = 0;
    const frames = [0.1, 1, 2, 3, 4, 5];
    for (const t of frames) {
      start = scrollDrawStart(placed, t, opts.width, opts.fontSize, start);
      const list = scrollDrawList(placed, t, opts.width, start);
      expect(list).toHaveLength(1); // 全程可见（存活 = duration = 屏宽/速度 ≈ 7.27s）
      expect(list[0].x).toBeCloseTo(opts.width - t * v, 5);
    }
  });

  it('彻底出左界后起点前移、不再重复绘制', () => {
    const placed = one('短');
    const exit = placed[0].duration; // ★ 恒定行程时长 ⇒「出左界」时刻 = duration（与文本宽无关）
    expect(scrollDrawStart(placed, exit + 0.01, opts.width, opts.fontSize, 0)).toBe(1);
    expect(scrollDrawList(placed, exit + 0.01, opts.width, 1)).toEqual([]);
  });

  it('未到时间的弹幕不出现在列表；到点后出现', () => {
    const placed = one('晚点出现', 5);
    expect(scrollDrawList(placed, 4.9, opts.width, 0)).toEqual([]);
    expect(scrollDrawList(placed, 5, opts.width, 0)).toHaveLength(1);
  });

  it('seek 回退（起点归零重扫）后仍在屏的条目照常绘制', () => {
    const placed = one('回退也要看得见');
    const atLate = scrollDrawStart(placed, 9, opts.width, opts.fontSize, 0); // 存活期（≈8.8s）已过 → 起点前移
    expect(atLate).toBeGreaterThanOrEqual(1);
    const back = scrollDrawStart(placed, 1, opts.width, opts.fontSize, 0); // 回调时间 → 从 0 重扫
    expect(back).toBe(0);
    expect(scrollDrawList(placed, 1, opts.width, back)).toHaveLength(1);
  });
});

describe('danmakuArea（绘制区：contain 避让宽银幕黑边）', () => {
  it('contain + 2.35:1 片源 → 上下留黑边，只在画面内画弹幕', () => {
    // 1040×602 容器，视频 1920×817（2.35:1）→ 显示高 ≈ 442.5 → 取整 443，上下黑边各 ≈ 80
    const a = danmakuArea({ fit: 'contain', canvasW: 1040, canvasH: 602, videoW: 1920, videoH: 817 });
    expect(a.height).toBe(443);
    expect(a.top).toBe(80);
  });

  it('contain + 16:9 → 留边极小', () => {
    const a = danmakuArea({ fit: 'contain', canvasW: 1040, canvasH: 602, videoW: 1920, videoH: 1080 });
    expect(a.height).toBe(585);
    expect(a.top).toBe(9);
  });

  it('非 contain（fill/cover/none/强制比例）→ 用整块画布；无元数据时同样整块', () => {
    for (const fit of ['fill', 'cover', 'none', 'r169', 'r43']) {
      expect(danmakuArea({ fit, canvasW: 1040, canvasH: 602, videoW: 1920, videoH: 817 })).toEqual({ top: 0, height: 602 });
    }
    expect(danmakuArea({ fit: 'contain', canvasW: 1040, canvasH: 602, videoW: 0, videoH: 0 })).toEqual({ top: 0, height: 602 });
  });
});

// ---- ★ P0-1：渲染层注入真实测量（canvas measureText）+ 宽度 memo ----
describe('setTextMeasurer / 宽度 memo（P0：不再逐帧重测文本宽）', () => {
  afterEach(() => setTextMeasurer(null)); // 防泄漏（后续 measureWidth 断言依赖估算兜底）

  it('注入后 measureWidth 走注入值；清空回退估算', () => {
    setTextMeasurer((text, f) => text.length * f);
    expect(measureWidth('ab', 10)).toBe(20);
    setTextMeasurer(null);
    expect(measureWidth('ab', 10)).toBe(10 * 0.6 * 2);
  });

  it('注入返回负数 / NaN（量不了）→ 回退估算', () => {
    setTextMeasurer(() => -1);
    expect(measureWidth('中', 20)).toBe(20);
    setTextMeasurer(() => NaN);
    expect(measureWidth('a', 20)).toBe(20 * 0.6);
  });

  it('布局宽度写入 PlacedDanmaku.width；scrollDrawStart 以它为出界判据', () => {
    setTextMeasurer(() => 1000); // 统一宽，便于断言
    const placed = layoutDanmaku([scroll(0, 'x')], { ...base, region: 'full' }).scroll;
    expect(placed).toHaveLength(1);
    expect(placed[0].width).toBe(1000);
    expect(placed[0].displayText).toBe('x');
    const exit = placed[0].duration; // ★ 出左界时刻 = 屏宽/速度（与文本宽无关）
    expect(exit).toBeCloseTo(base.width / base.speed, 6);
    expect(scrollDrawStart(placed, exit - 0.01, base.width, base.fontSize, 0)).toBe(0);
    expect(scrollDrawStart(placed, exit + 0.01, base.width, base.fontSize, 0)).toBe(1);
  });
});

// ---- ★ P0-2：重复弹幕合并（仿 DFM DuplicateMergingFilter） ----
describe('layoutDanmaku · mergeDuplicates', () => {
  const opts = { ...base, region: 'full' as DanmakuRegion, mergeDuplicates: true };
  const text = (time: number, t: DanmakuItem['type'], s = '233'): DanmakuItem => ({ time, type: t, text: s, size: 25, color: '#fff' });

  it('同类型同文本落在存活窗内 → 只留 1 条、计 ×N、绘制文本带后缀；跨类型不合并', () => {
    const out = layoutDanmaku([text(1, 'scroll'), text(2, 'scroll'), text(3, 'scroll'), text(1, 'top'), text(2, 'top')], opts);
    expect(out.scroll).toHaveLength(1);
    expect(out.scroll[0].count).toBe(3);
    expect(out.scroll[0].displayText).toBe('233 ×3');
    expect(out.top).toHaveLength(1);
    expect(out.top[0].count).toBe(2);
    expect(out.top[0].displayText).toBe('233 ×2');
    expect(out.bottom).toHaveLength(0);
  });

  it('超出存活窗的同文本不合并（各自显示）', () => {
    const fast = { ...base, region: 'full' as DanmakuRegion, speed: 4000, mergeDuplicates: true };
    // 窗 ≈ (0.6×24 + 800)/4000 ≈ 0.2s ≪ 5s 间隔 → 各自保留
    const out = layoutDanmaku([text(0, 'scroll', 'a'), text(5, 'scroll', 'a')], fast);
    expect(out.scroll).toHaveLength(2);
    expect(out.scroll.map((p) => p.count)).toEqual([1, 1]);
    expect(out.scroll.map((p) => p.displayText)).toEqual(['a', 'a']);
  });

  it('默认（不传）不合并 —— 既有布局结果不变', () => {
    const items = Array.from({ length: 5 }, (_, i) => text(i, 'scroll', '同一条'));
    const out = layoutDanmaku(items, { ...base, region: 'full', speed: 2000 });
    expect(out.scroll).toHaveLength(5);
    expect(out.scroll.every((p) => p.count === 1 && p.displayText === '同一条')).toBe(true);
  });
});

// ---- ★ P0-4：零分配遍历（eachScrollDraw）+ 缓冲复用 ----
describe('eachScrollDraw / scrollDrawList（复用缓冲）', () => {
  const opts = { ...base, region: 'full' as DanmakuRegion };
  const placed = layoutDanmaku([scroll(0, '测试弹幕')], opts).scroll;

  it('eachScrollDraw 与 scrollDrawList 结果一致；visit 返回 false 立即停止', () => {
    const hits: string[] = [];
    eachScrollDraw(placed, 1, opts.width, 0, (x, y, t) => {
      hits.push(`${x},${y},${t}`);
    });
    expect(hits).toEqual(scrollDrawList(placed, 1, opts.width, 0).map((p) => `${p.x},${p.y},${p.text}`));

    let calls = 0;
    eachScrollDraw(placed, 1, opts.width, 0, () => {
      calls++;
      return false; // 预算耗尽 → 停止
    });
    expect(calls).toBe(1);
  });

  it('传入 out 复用同一数组与元素对象（逐帧零分配）', () => {
    const buf: ScrollDraw[] = [];
    const a = scrollDrawList(placed, 1, opts.width, 0, buf);
    expect(a).toBe(buf);
    const first = a[0];
    const b = scrollDrawList(placed, 2, opts.width, 0, buf);
    expect(b[0]).toBe(first); // 同一对象被就地改写，而非新建
    expect(b[0].x).toBeCloseTo(opts.width - 2 * placed[0].velocity, 5);
  });
});
