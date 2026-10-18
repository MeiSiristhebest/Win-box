// src/engine/danmaku/layout.ts
// 纯 TS 弹幕轨道布局：把解析后的弹幕按时间排布到有限轨道，
// 输出渲染层可直接使用的定位数据（行号 / 速度 / 存活区间），渲染层免重算。
// 不依赖 Electron/Node，可独立单测。
//
// ★ 速度模型 = **恒定行程时长**（2026-10-18 用户拍板，取代原「恒定 px/s」）：
//   所有滚动弹幕都花同样的 `duration = 屏宽 / speed` 走完「屏宽 + 自身文本宽」⇒ **长句更快、短句更慢**
//   （同 B 站 / DanmakuFlameMaster / DPlayer 口径）。代价 = 长短句视觉速度不再统一（用户已接受），
//   换来的是**同轨允许多条共存**（靠 willHitScroll 判「后车会不会追上前车」）⇒ 同屏密度量级提升。

import type { DanmakuItem, DanmakuRegion } from '../../shared/danmaku';

export interface PlacedDanmaku {
  item: DanmakuItem;
  /** 轨道行号（类型内：滚动 0..，顶 0..，底 0..；不跨类型） */
  row: number;
  /** ★ 最终 y 坐标（px，已按分区/方向算好），渲染层直接用，免重复计算 */
  y: number;
  /** 初始 x（滚动 = 容器宽，从右缘进入；顶/底 = 0） */
  x0: number;
  /** ★ 速度（px/s）= (容器宽 + width) / duration ⇒ 长句更快、短句更慢；顶/底为 0 */
  velocity: number;
  /** 存活到时间（秒；滚动 = 出左界，顶/底 = 固定显示结束） */
  activeUntil: number;
  /** ★ 占屏时长（秒）= 恒定行程时长；滚动「出左界」与顶/底「显示结束」都等于 time + duration */
  duration: number;
  /** ★ 文本像素宽（布局时测一次并 memo；渲染层逐帧判定出界 / 居中直接用，免每帧重测） */
  width: number;
  /** ★ 实际绘制文本（重复合并后带「 ×N」后缀；未合并时 = item.text） */
  displayText: string;
  /** ★ 同屏重复合并计数（1 = 未合并） */
  count: number;
}

export interface DanmakuLayout {
  scroll: PlacedDanmaku[];
  top: PlacedDanmaku[];
  bottom: PlacedDanmaku[];
}

export interface LayoutOpts {
  /** 容器宽（px） */
  width: number;
  /** 容器高（px） */
  height: number;
  /** 字号（px，用户可调，绘制统一用此值） */
  fontSize: number;
  /** 滚动速度（px/s） */
  speed: number;
  /** 密度 0.25-1（1 = 全量） */
  density: number;
  region: DanmakuRegion;
  /** 时间偏移（秒，与片源时间轴对齐） */
  offsetSec: number;
  /**
   * ★ 重复弹幕合并（默认关）：同类型同文本、且落在"已显示那条"存活窗内的，只显示 1 条 + 后缀「 ×N」。
   *   仿 DanmakuFlameMaster 的 DuplicateMergingFilter；默认关以免改变既有布局结果。
   */
  mergeDuplicates?: boolean;
}

export const REGION_RATIO: Record<DanmakuRegion, number> = { full: 1, half: 0.5, quarter: 0.25 };

/** ★ 弹幕总量上限（超限时均匀抽稀而非丢尾部，见 layoutDanmaku）——2h 电影 ~10k 条也全片可显示 */
const MAX_ITEMS = 10000;

/** 滚动 / 顶 / 底 三类对行空间的占用比例（滚动态量最大，顶/底少量占位） */
const ZONE_RATIO = { scroll: 0.7, top: 0.15, bottom: 0.15 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 重复合并键：类型 + 文本（同类型同文本才合并，跨类型不合并）。 */
const mergeKey = (it: DanmakuItem): string => `${it.type}\u0000${it.text}`;

/**
 * ★ 追尾判定（willHit）：在「后车 A」入场后的存活期内，A 的左缘会不会追上「前车 B」的右缘（= 叠字）。
 *   **恒定行程时长**模型下速度随文本宽变化（长句更快、短句更慢）⇒ 必须判追赶；旧「恒定 px/s」模型同速
 *   永不追尾，所以只需等前车出屏（那条旧判据正是密度被压死的根因）。仿 DanmakuFlameMaster
 *   `DanmakuUtils.willHitInDuration`。所有量自洽（v 已含屏宽）⇒ 不需要单独传屏宽。
 *   记 d = A 比 B 晚入场的时间、s = 两车共存时长，则间隙 f(s) = (B.v − A.v)·s + (B.v·d − B.w)：
 *   f(0) < 0 ⇒ A 入场即压在「还没完全进屏」的 B 上；B 不快于 A ⇒ 间隙只增不减，无需再看末刻。
 * @param at A 入场时间（秒） @param av A 速度（px/s） @param adur A 行程时长（秒） @param b 前车（已排在同轨）
 */
export function willHitScroll(at: number, av: number, adur: number, b: PlacedDanmaku): boolean {
  const d = at - b.item.time;
  if (d < 0) return false; // B 晚于 A（同轨不应出现）→ 不判
  const f0 = b.velocity * d - b.width; // A 入场瞬间两车间隙（A 左缘 − B 右缘）
  if (f0 < 0) return true; // B 尚未完全进屏（右缘还在屏外右侧）→ 直接压上
  if (av <= b.velocity) return false; // A 不更快 ⇒ 间隙不再缩小
  const span = Math.min(adur, b.duration - d); // 两车同时在屏的剩余时长（B 先出屏则取 B 的）
  if (span <= 0) return false; // B 已在 A 入场前出屏
  return (b.velocity - av) * span + f0 < 0;
}

/** 区域高度 → 可用轨道行数（滚动/顶/底共用行空间）。 */
export function regionRows(height: number, fontSize: number, region: DanmakuRegion): number {
  const lineHeight = Math.round(fontSize * 1.4);
  return Math.max(1, Math.floor((height * REGION_RATIO[region]) / lineHeight));
}

/** ★ 行空间分区：滚动 / 顶 / 底 各自行数（保证至少 1 行，且滚动不挤占顶/底）。 */
export function zoneRows(height: number, fontSize: number, region: DanmakuRegion): { scroll: number; top: number; bottom: number } {
  const total = regionRows(height, fontSize, region);
  const top = Math.max(1, Math.floor(total * ZONE_RATIO.top));
  const bottom = Math.max(1, Math.floor(total * ZONE_RATIO.bottom));
  const scroll = Math.max(1, total - top - bottom);
  return { scroll, top, bottom };
}

/** 文本宽度估算兜底（纯 Node 可跑）：CJK/全角 ≈ size，ASCII ≈ size*0.6。 */
function estimateWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0xff ? fontSize : fontSize * 0.6;
  }
  return w;
}

/** 真实文本测量器（渲染层注入，如 canvas `measureText`）；返回负数 / NaN 表示量不了 → 回退估算。 */
export type TextMeasurer = (text: string, fontSize: number) => number;

let textMeasurer: TextMeasurer | null = null;

/**
 * 注入真实文本测量器（传 null 恢复估算）。
 * ★ 引擎保持纯 TS（不 import DOM/Electron）：渲染层在模块加载时注入，单测环境不注入 → 走估算、断言不变。
 *   测量结果的缓存由注入方自带（见 DanmakuOverlay 的 LRU）。
 */
export function setTextMeasurer(fn: TextMeasurer | null): void {
  textMeasurer = fn;
}

/** 文本像素宽：优先真实测量器，缺省走估算。 */
export function measureWidth(text: string, fontSize: number): number {
  if (textMeasurer) {
    const w = textMeasurer(text, fontSize);
    if (Number.isFinite(w) && w >= 0) return w;
  }
  return estimateWidth(text, fontSize);
}

/**
 * 轨道分配：
 * - 滚动：**恒定行程时长** ⇒ 同轨允许多条共存；自上而下扫行，取**首个「不会追尾」**的行（= DFM AlignTopRetainer 口径），
 *   全部轨道都会追尾才丢弃该条。★ 旧口径（每行维护 next、要求前车**完全出屏**才放行）在 110px/s × 1920px 下
 *   等于每轨 18~23s 才能再进一条 ⇒ 密度被结构性压死（用户报「弹幕少」的根因）。
 * - 顶/底：固定区，行按 duration 占用，取最早空闲行（底从末行向上取）。
 * - 滚动 / 顶 / 底 **分区独立行空间**（zoneRows）：滚动占上区、顶占中区、底占下区，
 *   三类互不重叠（修复 D2：原先共用行号池导致滚动与顶部弹幕 y 重叠视觉互挡）。
 * - 超量（>MAX_ITEMS）时按原时间顺序**均匀抽稀**而非丢尾部（修复 D1：
 *   原先 sort 后 slice(0,MAX_ITEMS) 只保留最早 N 条，长视频后半段弹幕整体丢失）。
 * - 无可用轨道时**丢弃**该弹幕（宁可少显示也不重叠，同 B 站高密度策略）。
 */
export function layoutDanmaku(items: DanmakuItem[], opts: LayoutOpts): DanmakuLayout {
  const { width, height, fontSize, speed, density, region, offsetSec } = opts;
  const lineHeight = Math.round(fontSize * 1.4);
  const zoneH = height * REGION_RATIO[region];
  const rows = zoneRows(height, fontSize, region);
  // ★ 恒定行程时长（秒）：所有滚动弹幕都花同样时间走完「屏宽 + 文本宽」，顶/底同用该值作显示时长。
  //   `speed` 语义 = **零宽弹幕的参考速度** ⇒ 既有「弹幕速度」设置与滑杆手感不变（短句观感与旧口径几乎一致），
  //   长句按 (屏宽+文本宽)/duration 提速（最多 +文本宽/屏宽 倍）。下限 1s 防「首帧未测得屏宽」时退化。
  const duration = Math.max(1, width / speed);

  // 偏移 + 密度抽样 + 排序 + 超限均匀抽稀（保全片时间分布）
  const step = Math.max(1, Math.round(1 / clamp(density, 0.25, 1)));
  let sampled = items
    .map((it) => ({ ...it, time: clamp(it.time + offsetSec, 0, Number.MAX_SAFE_INTEGER) }))
    .filter((_, i) => i % step === 0)
    .sort((a, b) => a.time - b.time || a.text.localeCompare(b.text));
  if (sampled.length > MAX_ITEMS) {
    // 等间隔抽样保持全片分布（保留每个采样桶首条，含首尾边界）
    const ratio = sampled.length / MAX_ITEMS;
    sampled = sampled.filter((_, i) => i === 0 || Math.floor(i / ratio) !== Math.floor((i - 1) / ratio));
  }

  // ★ 重复弹幕合并（opt-in）：同类型同文本、时间落在"已显示那条"的显示窗内 → 只留 1 条、计一次 ×N。
  //   窗 = 该条的 duration（恒定）⇒ 「同时可见」判据与速度模型同源。
  let placed0 = sampled;
  let mergeCount: Map<string, number> | null = null;
  if (opts.mergeDuplicates) {
    mergeCount = new Map<string, number>();
    const winEnd = new Map<string, number>();
    const kept: DanmakuItem[] = [];
    for (const it of sampled) {
      const k = mergeKey(it);
      const end = winEnd.get(k);
      if (end !== undefined && it.time <= end) {
        mergeCount.set(k, (mergeCount.get(k) ?? 1) + 1);
        continue;
      }
      winEnd.set(k, it.time + duration);
      mergeCount.set(k, 1);
      kept.push(it);
    }
    placed0 = kept;
  }

  const scroll: PlacedDanmaku[] = [];
  const top: PlacedDanmaku[] = [];
  const bottom: PlacedDanmaku[] = [];
  const topUntil = Array.from({ length: rows.top }, () => 0);
  const bottomUntil = Array.from({ length: rows.bottom }, () => 0);
  // ★ 滚动轨道：每行保留「仍在本行的弹幕」（同轨可共存多车），并用游标剪枝已出屏的
  //   —— 同轨的 activeUntil = time + 同一个 duration ⇒ 随入场时间单调递增，游标只需前移。
  const rowItems: PlacedDanmaku[][] = Array.from({ length: rows.scroll }, () => []);
  const rowHead = Array.from({ length: rows.scroll }, () => 0);

  const pickRow = (until: number[], time: number, fromBottom = false): number => {
    if (!fromBottom) {
      for (let i = 0; i < until.length; i++) if (until[i] <= time) return i;
    } else {
      for (let i = 0; i < until.length; i++) {
        const r = until.length - 1 - i;
        if (until[r] <= time) return r;
      }
    }
    return -1;
  };

  // ★ 各类型 y 起点：滚动在最上（从 0 起），顶在滚动之下，底从区域底部向上铺
  const yScroll = (row: number) => row * lineHeight;
  const yTop = (row: number) => rows.scroll * lineHeight + row * lineHeight;
  const yBottom = (row: number) => zoneH - (row + 1) * lineHeight;

  for (const it of placed0) {
    const cnt = mergeCount?.get(mergeKey(it)) ?? 1;
    const displayText = cnt > 1 ? `${it.text} ×${cnt}` : it.text;
    const estW = measureWidth(displayText, fontSize); // ★ 只在这里测一次，结果 memo 进 PlacedDanmaku.width
    if (it.type === 'scroll') {
      const velocity = (width + estW) / duration; // ★ 恒定行程时长 ⇒ 速度随文本宽变化（长句更快）
      let row = -1;
      for (let r = 0; r < rowItems.length && row < 0; r++) {
        const act = rowItems[r];
        let h = rowHead[r];
        while (h < act.length && act[h].activeUntil <= it.time) h++; // 已出屏 → 剪枝
        rowHead[r] = h;
        let hit = false;
        for (let k = h; k < act.length; k++) {
          if (willHitScroll(it.time, velocity, duration, act[k])) {
            hit = true;
            break;
          }
        }
        if (!hit) row = r; // 首个无追尾的行（自上而下）
      }
      if (row < 0) continue; // 所有轨道都会追尾 → 丢弃（宁可少显示也不重叠）
      const p: PlacedDanmaku = { item: it, row, y: yScroll(row), x0: width, velocity, activeUntil: it.time + duration, width: estW, displayText, count: cnt, duration };
      rowItems[row].push(p);
      scroll.push(p);
    } else if (it.type === 'top') {
      const row = pickRow(topUntil, it.time);
      if (row < 0) continue;
      topUntil[row] = it.time + duration;
      top.push({ item: it, row, y: yTop(row), x0: 0, velocity: 0, activeUntil: it.time + duration, width: estW, displayText, count: cnt, duration });
    } else {
      const row = pickRow(bottomUntil, it.time, true);
      if (row < 0) continue;
      bottomUntil[row] = it.time + duration;
      bottom.push({ item: it, row, y: yBottom(row), x0: 0, velocity: 0, activeUntil: it.time + duration, width: estW, displayText, count: cnt, duration });
    }
  }

  return { scroll, top, bottom };
}

// ---------------- 逐帧绘制辅助（★ 2026-09-26 真 bug 修复：滚动弹幕只画一帧） ----------------

/** 一帧要绘制的滚动弹幕（相对画布坐标） */
export interface ScrollDraw {
  x: number;
  y: number;
  text: string;
  color: string;
}

/**
 * 滚动弹幕的**绘制起点**：只跳过「已到时间且已完全出左界」的条目。
 * ★ 旧实现每帧无脑自增扫描指针（画过即丢）→ 每条滚动弹幕只被绘制**一帧**，而且那一帧它的
 *   x ≈ 画布宽（刚入界、基本在画布外）→ 屏幕上看不到弹幕；一 seek/快进指针归零重扫才"满屏"。
 *   现在起点只在条目真正出界后前移，且帧间 O(1) 摊销（条目按时间升序 ⇒ x 单调递减）。
 * ★ 宽度取 {@link PlacedDanmaku.width}（布局时已 memo）——不再逐帧重测文本宽。
 *   `fontSize` 参数保留仅为兼容既有调用签名（含单测），不参与计算。
 */
export function scrollDrawStart(
  placed: PlacedDanmaku[],
  t: number,
  width: number,
  fontSize: number,
  from = 0,
): number {
  let i = Math.max(0, from);
  while (i < placed.length) {
    const p = placed[i];
    if (p.item.time > t) break; // 未到时间（其后只会更晚）→ 起点不动
    if (width - (t - p.item.time) * p.velocity + p.width >= 0) break; // 仍在屏内
    i++;
  }
  return i;
}

/**
 * 遍历 `t` 时刻仍在屏内的滚动弹幕（时间升序；x = 宽 −(t−time)×速度）——**零分配**热路径。
 * `visit` 返回 `false` 立即停止（渲染层用它做单帧绘制预算保护）。传入的 text 为 displayText（含「 ×N」后缀）。
 */
export function eachScrollDraw(
  placed: PlacedDanmaku[],
  t: number,
  width: number,
  start: number,
  visit: (x: number, y: number, text: string, color: string) => boolean | void,
): void {
  for (let i = Math.max(0, start); i < placed.length; i++) {
    const p = placed[i];
    if (p.item.time > t) break;
    if (visit(width - (t - p.item.time) * p.velocity, p.y, p.displayText, p.item.color) === false) return;
  }
}

/**
 * {@link eachScrollDraw} 的数组版（保留既有调用 / 单测签名）。
 * ★ 传入 `out` 可复用数组与元素对象 → 逐帧零分配；不传则每次新建（单测/一次性调用）。
 */
export function scrollDrawList(placed: PlacedDanmaku[], t: number, width: number, start = 0, out: ScrollDraw[] = []): ScrollDraw[] {
  let n = 0;
  eachScrollDraw(placed, t, width, start, (x, y, text, color) => {
    const o = out[n] ?? (out[n] = { x: 0, y: 0, text: '', color: '' });
    o.x = x;
    o.y = y;
    o.text = text;
    o.color = color;
    n++;
  });
  if (out.length > n) out.length = n;
  return out;
}

/**
 * 弹幕绘制区（相对画布）：`contain` 时按视频**真实显示区**做上下留边 —— 避免弹幕落在宽银幕黑边上
 * （用户报「位置明显不对」）；其它比例模式（fill / cover / none / 强制 16:9·4:3）内容铺满盒子 → 用整块画布。
 */
export function danmakuArea(opts: {
  fit: string;
  canvasW: number;
  canvasH: number;
  videoW: number;
  videoH: number;
}): { top: number; height: number } {
  const { fit, canvasW, canvasH, videoW, videoH } = opts;
  const full = { top: 0, height: Math.max(1, Math.round(canvasH || 0)) };
  if (fit !== 'contain' || !(videoW > 0) || !(videoH > 0) || !(canvasW > 0) || !(canvasH > 0)) return full;
  const scale = Math.min(canvasW / videoW, canvasH / videoH);
  const dispH = Math.max(1, Math.round(videoH * scale));
  return { top: Math.max(0, Math.round((canvasH - dispH) / 2)), height: dispH };
}
