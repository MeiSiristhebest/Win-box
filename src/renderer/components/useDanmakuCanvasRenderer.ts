import { useEffect, useMemo, useRef, useState } from 'react';
import { danmakuArea, eachScrollDraw, layoutDanmaku, scrollDrawStart, type TextMeasurer } from '../../engine/danmaku/layout';
import type { DanmakuItem, DanmakuRegion } from '../../shared/danmaku';
import { DanmakuBitmapCache, type BitmapEntry } from '../lib/danmakuBitmap';
import { clearDanmakuCanvas, prepareDanmakuCanvas } from '../lib/danmakuCanvas';
import { createCanvasTextMeasurement } from './danmakuCanvasMeasurement';

const DRAW_BUDGET_MS = 12;
const BITMAP_PAD = 4;
const danmakuLineH = (fontSize: number) => Math.round(fontSize * 1.4);
const danmakuFont = (fontSize: number) => `${fontSize}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;

function rasterizeText(
  text: string,
  fontSize: number,
  color: string,
  dpr: number,
  measure: TextMeasurer,
): BitmapEntry<HTMLCanvasElement> | null {
  const textWidth = measure(text, fontSize);
  if (!(textWidth >= 0)) return null;
  const bitmap = document.createElement('canvas');
  const context = bitmap.getContext('2d');
  if (!context) return null;
  const width = Math.ceil(textWidth) + BITMAP_PAD * 2;
  const height = danmakuLineH(fontSize) + BITMAP_PAD * 2;
  bitmap.width = Math.max(1, Math.ceil(width * dpr));
  bitmap.height = Math.max(1, Math.ceil(height * dpr));
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.font = danmakuFont(fontSize);
  context.textBaseline = 'top';
  context.lineWidth = 2.4;
  context.strokeStyle = 'rgba(0,0,0,.8)';
  context.lineJoin = 'round';
  context.fillStyle = color || '#fff';
  context.strokeText(text, BITMAP_PAD, BITMAP_PAD);
  context.fillText(text, BITMAP_PAD, BITMAP_PAD);
  return { bitmap, w: width, h: height, pad: BITMAP_PAD, bytes: bitmap.width * bitmap.height * 4 };
}

function createDanmakuBitmapCache(measure: TextMeasurer): DanmakuBitmapCache<HTMLCanvasElement> {
  return new DanmakuBitmapCache<HTMLCanvasElement>({
    rasterize: (text, fontSize, color, dpr) => rasterizeText(text, fontSize, color, dpr, measure),
    release: (bitmap) => {
      bitmap.width = 0;
      bitmap.height = 0;
    },
  });
}

export interface DanmakuOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** mpv advances through the main-process clock because its native surface has no HTML media timeline. */
  mpv?: { time: React.RefObject<number>; size: React.RefObject<{ w: number; h: number }> } | null;
  items: DanmakuItem[];
  enabled: boolean;
  region: DanmakuRegion;
  fontSize: number;
  opacity: number;
  density: number;
  speed: number;
  offset: number;
  /** When contain is active, keep danmaku inside the video image and out of letterbox bars. */
  fit?: string;
}

/** Owns canvas measurement, observation, bitmap cache and animation-frame lifecycles for one overlay. */
export function useDanmakuCanvasRenderer({
  videoRef,
  mpv = null,
  items,
  enabled,
  region,
  fontSize,
  opacity,
  density,
  speed,
  offset,
  fit = 'contain',
}: DanmakuOverlayProps) {
  // The player may recreate this wrapper object on every render. Its refs are
  // stable, so key browser lifecycles to those refs instead of wrapper identity.
  const mpvTimeRef = mpv?.time ?? null;
  const mpvSizeRef = mpv?.size ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textMeasurement = useMemo(() => createCanvasTextMeasurement(), []);
  const bitmapCache = useMemo(() => createDanmakuBitmapCache(textMeasurement.measure), [textMeasurement]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [area, setArea] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const video = videoRef.current;
    if (!canvas || !parent) return;
    const update = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      setSize((current) => current.w === width && current.h === height ? current : { w: width, h: height });
      const videoWidth = mpvSizeRef ? mpvSizeRef.current.w : video?.videoWidth || 0;
      const videoHeight = mpvSizeRef ? mpvSizeRef.current.h || parent.clientHeight : video?.videoHeight || 0;
      const nextArea = danmakuArea({ fit, canvasW: width, canvasH: height, videoW: videoWidth, videoH: videoHeight });
      setArea((current) => current.top === nextArea.top && current.height === nextArea.height ? current : nextArea);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    video?.addEventListener('loadedmetadata', update);
    video?.addEventListener('resize', update);
    const timer = mpvTimeRef && mpvSizeRef ? setInterval(update, 800) : null;
    return () => {
      observer.disconnect();
      video?.removeEventListener('loadedmetadata', update);
      video?.removeEventListener('resize', update);
      if (timer !== null) clearInterval(timer);
    };
  }, [videoRef, mpvTimeRef, mpvSizeRef, fit]);

  useEffect(() => () => {
    bitmapCache.clear();
    textMeasurement.dispose();
  }, [bitmapCache, textMeasurement]);

  const layout = useMemo(() => layoutDanmaku(items, {
    width: size.w || 1,
    height: area.height || size.h || 1,
    fontSize,
    speed,
    density,
    region,
    offsetSec: offset,
    mergeDuplicates: true,
    textMeasurer: textMeasurement.measure,
  }), [items, size.w, size.h, area.height, fontSize, speed, density, region, offset, textMeasurement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!enabled) {
      clearDanmakuCanvas(context, canvas);
      return;
    }
    if (!video && !mpvTimeRef) return;

    let animationFrame = 0;
    let lastTime = -1;
    let scrollStart = 0;
    const seekJump = 0.3;
    const draw = () => {
      animationFrame = requestAnimationFrame(draw);
      const time = mpvTimeRef ? mpvTimeRef.current : (video as HTMLVideoElement).currentTime;
      if (time < lastTime || Math.abs(time - lastTime) > seekJump) scrollStart = 0;
      lastTime = time;

      const dpr = window.devicePixelRatio || 1;
      const canvasWidth = canvas.clientWidth;
      prepareDanmakuCanvas(context, canvas, dpr);
      context.globalAlpha = opacity;
      context.font = danmakuFont(fontSize);
      context.textBaseline = 'top';
      context.lineWidth = 2.4;
      context.strokeStyle = 'rgba(0,0,0,.8)';
      context.lineJoin = 'round';

      const drawText = (text: string, x: number, y: number, color: string) => {
        const entry = bitmapCache.get(text, fontSize, color, dpr);
        if (!entry) {
          context.fillStyle = color || '#fff';
          context.strokeText(text, x, area.top + y);
          context.fillText(text, x, area.top + y);
          return;
        }
        context.drawImage(entry.bitmap, x - entry.pad, area.top + y - entry.pad, entry.w, entry.h);
      };

      const frameStarted = performance.now();
      const overBudget = () => performance.now() - frameStarted > DRAW_BUDGET_MS;
      scrollStart = scrollDrawStart(layout.scroll, time, canvasWidth, fontSize, scrollStart);
      eachScrollDraw(layout.scroll, time, canvasWidth, scrollStart, (x, y, text, color) => {
        if (overBudget()) return false;
        drawText(text, x, y, color);
      });
      for (const placed of layout.top) {
        if (time < placed.item.time || time > placed.activeUntil) continue;
        if (overBudget()) break;
        drawText(placed.displayText, (canvasWidth - placed.width) / 2, placed.y, placed.item.color);
      }
      for (const placed of layout.bottom) {
        if (time < placed.item.time || time > placed.activeUntil) continue;
        if (overBudget()) break;
        drawText(placed.displayText, (canvasWidth - placed.width) / 2, placed.y, placed.item.color);
      }
    };
    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [enabled, layout, fontSize, opacity, region, area.top, videoRef, speed, mpvTimeRef, bitmapCache]);

  return canvasRef;
}
