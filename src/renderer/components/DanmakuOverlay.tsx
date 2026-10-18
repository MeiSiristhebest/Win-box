// src/renderer/components/DanmakuOverlay.tsx
// 弹幕叠加层：全屏 canvas，按 video.currentTime 驱动滚动/顶/底弹幕渲染。
// 布局（轨道分配）与"逐帧在屏集合"由纯 TS 引擎负责（layoutDanmaku / scrollDrawStart / eachScrollDraw / danmakuArea），
// 本组件只负责绘制。
import { useEffect, useMemo, useRef, useState } from 'react';
import { danmakuArea, eachScrollDraw, layoutDanmaku, scrollDrawStart, setTextMeasurer } from '../../engine/danmaku/layout';
import { DanmakuBitmapCache, type BitmapEntry } from '../lib/danmakuBitmap';
import type { DanmakuItem, DanmakuRegion } from '../../shared/danmaku';

/** 弹幕字体串（测量与绘制必须同串，否则量出的宽度与实画不符）。 */
const danmakuFont = (fontSize: number) => `${fontSize}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;

/** ★ 单帧弹幕绘制预算（ms）：超出则本帧丢弃剩余条目 —— 高密度时不拖垮播放帧率（仿 DFM ElapsedTimeFilter 思路）。 */
const DRAW_BUDGET_MS = 12;

/**
 * ★ 真实文本测量（canvas `measureText`）+ 小型 LRU，注入引擎（{@link setTextMeasurer}）。
 *   旧实现按 charCode 估宽（ASCII 一律 0.6×字号）→ 英文/数字/标点判据偏差大；且逐帧重测。
 *   LRU：容量上限后淘汰最久未用；命中即移到队尾（Map 插入序）。
 */
const MEASURE_CACHE_MAX = 2000;
const measureCache = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null = null;

function canvasMeasure(text: string, fontSize: number): number {
  const key = `${fontSize}\u0000${text}`;
  const hit = measureCache.get(key);
  if (hit !== undefined) {
    measureCache.delete(key);
    measureCache.set(key, hit); // LRU touch
    return hit;
  }
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) return -1; // 量不了 → 引擎回退估算
  }
  measureCtx.font = danmakuFont(fontSize);
  const w = measureCtx.measureText(text).width;
  if (measureCache.size >= MEASURE_CACHE_MAX) {
    const oldest = measureCache.keys().next().value;
    if (oldest !== undefined) measureCache.delete(oldest);
  }
  measureCache.set(key, w);
  return w;
}

setTextMeasurer(canvasMeasure);

/** 描边（lineWidth 2.4）外扩留量，防位图边缘把描边切掉 */
const BITMAP_PAD = 4;
/** 行盒高（与引擎的 lineHeight 同口径：round(fontSize × 1.4)） */
const danmakuLineH = (fontSize: number) => Math.round(fontSize * 1.4);

/**
 * ★ 文本位图栅格化（P1-①）：在离屏 canvas 上把「描边 + 填充」一次性画好，之后逐帧只 drawImage。
 *   与绘制路径**同字体串 / 同描边参数 / 同 textBaseline** ⇒ 视觉与原来的逐帧 strokeText+fillText 一致。
 *   透明度**不烘进位图**（由逐帧 ctx.globalAlpha 施加）⇒ 调透明度不会失效缓存；DPR 放大后存，HiDPI 依然清晰。
 *   量不了宽 / 拿不到 2D 上下文 ⇒ 返回 null，调用方回退逐帧路径。
 */
function rasterizeText(text: string, fontSize: number, color: string, dpr: number): BitmapEntry<HTMLCanvasElement> | null {
  const tw = canvasMeasure(text, fontSize);
  if (!(tw >= 0)) return null;
  const off = document.createElement('canvas');
  const c = off.getContext('2d');
  if (!c) return null;
  const w = Math.ceil(tw) + BITMAP_PAD * 2;
  const h = danmakuLineH(fontSize) + BITMAP_PAD * 2;
  off.width = Math.max(1, Math.ceil(w * dpr));
  off.height = Math.max(1, Math.ceil(h * dpr));
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.font = danmakuFont(fontSize);
  c.textBaseline = 'top';
  c.lineWidth = 2.4;
  c.strokeStyle = 'rgba(0,0,0,.8)';
  c.lineJoin = 'round';
  c.fillStyle = color || '#fff';
  c.strokeText(text, BITMAP_PAD, BITMAP_PAD);
  c.fillText(text, BITMAP_PAD, BITMAP_PAD);
  return { bitmap: off, w, h, pad: BITMAP_PAD, bytes: off.width * off.height * 4 };
}

/** 文本位图缓存：800 条 / 24MB 双阈值，单图超 3MB 不入缓存（★ 这笔内存计入「内存优化」专项预算）。 */
const bitmapCache = new DanmakuBitmapCache<HTMLCanvasElement>({
  rasterize: rasterizeText,
  release: (b) => {
    b.width = 0; // 置 0×0，让浏览器尽早回收位图内存
    b.height = 0;
  },
});

interface DanmakuOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /**
   * ★ 2026-10-08 MPV 内核：`<video>` 不再推进播放 —— 时间与画面尺寸改由主进程事件驱动
   *   （time = 当前播放秒；size = 画面物理像素）。缺省（html5 内核）走 videoRef。
   */
  mpv?: { time: React.RefObject<number>; size: React.RefObject<{ w: number; h: number }> } | null;
  items: DanmakuItem[];
  enabled: boolean;
  region: DanmakuRegion;
  fontSize: number;
  opacity: number;
  density: number;
  speed: number;
  offset: number;
  /** 画面比例模式（playTarget/playerPrefs 的 fit）：`contain` 时弹幕只覆盖视频真实显示区，不落宽银幕黑边 */
  fit?: string;
}

export default function DanmakuOverlay({ videoRef, mpv = null, items, enabled, region, fontSize, opacity, density, speed, offset, fit = 'contain' }: DanmakuOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** 视频真实显示区（相对画布）：contain 时上下留出黑边高度 */
  const [area, setArea] = useState({ top: 0, height: 0 });

  // 尺寸跟随父容器（.vplayer）+ 视频真实显示区随窗口/全屏/元数据缩放自动更新
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const v = videoRef.current;
    if (!canvas || !parent) return;
    const update = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
      // ★ mpv 内核：画面尺寸来自主进程事件（mpv 子窗口按物理像素渲染）；无则按容器满幅
      const videoW = mpv ? mpv.size.current.w : v?.videoWidth || 0;
      const videoH = mpv ? mpv.size.current.h || parent.clientHeight : v?.videoHeight || 0;
      const a = danmakuArea({ fit, canvasW: w, canvasH: h, videoW, videoH });
      setArea((p) => (p.top === a.top && p.height === a.height ? p : a));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    v?.addEventListener('loadedmetadata', update);
    v?.addEventListener('resize', update);
    const t = mpv ? setInterval(update, 800) : null; // mpv：尺寸事件无 DOM 可监听，低频校准
    return () => {
      ro.disconnect();
      v?.removeEventListener('loadedmetadata', update);
      v?.removeEventListener('resize', update);
      if (t) clearInterval(t);
    };
  }, [videoRef, mpv, fit]);

  // ★ 卸载时释放位图缓存（避免 24MB 常驻）；独立空依赖 effect ⇒ 不会随布局重算被反复清空
  useEffect(() => () => bitmapCache.clear(), []);

  // 轨道布局：items/绘制区/偏好变化时重算（纯函数，渲染层只负责绘制）
  const layout = useMemo(
    () =>
      layoutDanmaku(items, {
        width: size.w || 1,
        height: area.height || size.h || 1,
        fontSize,
        speed,
        density,
        region,
        offsetSec: offset,
        mergeDuplicates: true, // ★ 同屏重复弹幕只留 1 条 + 「 ×N」
      }),
    [items, size.w, size.h, area.height, fontSize, speed, density, region, offset],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const v = videoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // ★ 2026-09-28 真 bug 修复（用户报「关闭弹幕只是卡住不消失」）：
    //   旧实现在 enabled=false 时直接 return（取消 rAF），**画布上最后一帧从未清除** →
    //   弹幕定格在屏幕上。这里关闭时先把画布清空再退出。
    if (!enabled) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    // ★ mpv 内核：无 <video> 时间源，用主进程推送的 time（mpv.time.current）
    if (!v && !mpv) return;

    let raf = 0;
    let lastT = -1;
    let si = 0; // 滚动弹幕绘制起点（只前移到"彻底出左界"处，见 scrollDrawStart）
    // ★ D7：seek 前进/回退都重启扫描源点——时间回退或一次性跳变（>0.3s，非正常播放推进）时
    //   重置 si=0，让跳过的弹幕从右缘按新时间轴重新进入（此前仅回退重置，前进会"中途冒出"）
    const SEEK_JUMP = 0.3;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = mpv ? mpv.time.current : (v as HTMLVideoElement).currentTime;
      // 暂停不跳过绘制：t 不变则弹幕位置不变，画面自然冻结（否则暂停时加载弹幕看不到出现）
      if (t < lastT || Math.abs(t - lastT) > SEEK_JUMP) si = 0;
      lastT = t;

      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, cw, ch);
      ctx.globalAlpha = opacity;
      ctx.font = danmakuFont(fontSize);
      ctx.textBaseline = 'top';
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.lineJoin = 'round';

      const top = area.top; // 绘制区上边距（contain 时为黑边高度）
      // ★ 逐帧只用位图 blit（P1-①，绕开 strokeText+fillText）；位图不可用时回退逐帧文字栅格化
      const drawText = (text: string, x: number, y: number, color: string) => {
        const e = bitmapCache.get(text, fontSize, color, dpr);
        if (!e) {
          ctx.fillStyle = color || '#fff';
          ctx.strokeText(text, x, top + y);
          ctx.fillText(text, x, top + y);
          return;
        }
        // pad 回退 ⇒ 文本起笔仍落在 (x, top + y)；dest 尺寸用 CSS px（位图内部已按 DPR 放大）
        ctx.drawImage(e.bitmap, x - e.pad, top + y - e.pad, e.w, e.h);
      };

      // ★ 2026-09-26 真 bug 修复：**每帧重绘所有在屏滚动弹幕**。
      //   旧实现在同一个循环里又画、又把扫描指针自增越过已画条目 → 每条只在"入界那一帧"被画到
      //   （x≈右缘、几乎在画布外）→ 屏幕上看不到弹幕，只有 seek 重扫时才"满屏"。
      // ★ 零分配遍历（eachScrollDraw）+ 单帧预算：超预算即停，剩余条目留到下帧（不卡播放）。
      const t0 = performance.now();
      const overBudget = () => performance.now() - t0 > DRAW_BUDGET_MS;
      si = scrollDrawStart(layout.scroll, t, cw, fontSize, si);
      eachScrollDraw(layout.scroll, t, cw, si, (x, y, text, color) => {
        if (overBudget()) return false;
        drawText(text, x, y, color);
      });
      // 顶部固定（居中；y 在滚动区之下，避免与滚动弹幕重叠）——宽度用布局时 memo 的 p.width
      for (const p of layout.top) {
        if (t < p.item.time || t > p.activeUntil) continue;
        if (overBudget()) break;
        drawText(p.displayText, (cw - p.width) / 2, p.y, p.item.color);
      }
      // 底部固定（居中；y 从区域底部向上排）
      for (const p of layout.bottom) {
        if (t < p.item.time || t > p.activeUntil) continue;
        if (overBudget()) break;
        drawText(p.displayText, (cw - p.width) / 2, p.y, p.item.color);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [enabled, layout, fontSize, opacity, region, area.top, videoRef, speed, mpv]);

  return (
    <canvas
      ref={canvasRef}
      className="vp-danmaku"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}
    />
  );
}