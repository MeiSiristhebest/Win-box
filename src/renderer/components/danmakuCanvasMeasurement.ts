import type { TextMeasurer } from '../../engine/danmaku/layout';

const MEASURE_CACHE_MAX = 2000;

export interface CanvasTextMeasurement {
  measure: TextMeasurer;
  dispose: () => void;
}

/** Creates an overlay-scoped text measurement port and bounded memo cache. */
export function createCanvasTextMeasurement(
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): CanvasTextMeasurement {
  const measureCache = new Map<string, number>();
  let measureCtx: CanvasRenderingContext2D | null = null;
  const measure: TextMeasurer = (text, fontSize) => {
    const key = `${fontSize}\u0000${text}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) {
      measureCache.delete(key);
      measureCache.set(key, hit);
      return hit;
    }
    if (!measureCtx) {
      measureCtx = createCanvas().getContext('2d');
      if (!measureCtx) return -1;
    }
    measureCtx.font = `${fontSize}px 'Microsoft YaHei', 'PingFang SC', sans-serif`;
    const width = measureCtx.measureText(text).width;
    if (measureCache.size >= MEASURE_CACHE_MAX) {
      const oldest = measureCache.keys().next().value;
      if (oldest !== undefined) measureCache.delete(oldest);
    }
    measureCache.set(key, width);
    return width;
  };
  return {
    measure,
    dispose: () => {
      measureCache.clear();
      if (measureCtx) {
        measureCtx.canvas.width = 0;
        measureCtx.canvas.height = 0;
        measureCtx = null;
      }
    },
  };
}
