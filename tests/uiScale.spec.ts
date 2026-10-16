// tests/uiScale.spec.ts
// ★ 2026-10-16（用户要求「自适应屏幕分辨率调节窗口大小与字体大小」）：界面缩放档位的纯函数口径。
import { describe, expect, it } from 'vitest';
import {
  autoUiScale,
  BASE_WINDOW,
  normalizeUiScalePref,
  resolveUiScale,
  scaledWindowSize,
  UI_SCALE_OPTIONS,
} from '../src/shared/uiScale';

/** 工作区（DIP）按「分辨率 − 任务栏约 40 DIP」估 */
const work = (w: number, h: number) => ({ width: w, height: h - 40 });

describe('autoUiScale（按显示器工作区推倍率）', () => {
  it('1K（1920×1080）→ 100%（保持现状）', () => {
    expect(autoUiScale(work(1920, 1080))).toBe(1);
  });

  it('2K（2560×1440）→ 125%', () => {
    expect(autoUiScale(work(2560, 1440))).toBe(1.25);
  });

  it('4K@100%（3840×2160）→ 175%（用户报「4K 特别小」的那一档，往上顶）', () => {
    expect(autoUiScale(work(3840, 2160))).toBe(1.75);
  });

  it('4K@150% 的 DIP 工作区（2560×1440）与 2K@100% 同档 ⇒ 125%', () => {
    expect(autoUiScale(work(2560, 1440))).toBe(1.25);
  });

  it('超宽屏（5120×1440）取宽/高两档的较小者 ⇒ 125%（不被宽度推到过大）', () => {
    expect(autoUiScale(work(5120, 1440))).toBe(1.25);
  });

  it('5K（5120×2880）→ 200%', () => {
    expect(autoUiScale(work(5120, 2880))).toBe(2);
  });

  it('小屏（1366×768 / 1440×900）→ 100%', () => {
    expect(autoUiScale(work(1366, 768))).toBe(1);
    expect(autoUiScale(work(1440, 900))).toBe(1);
  });
});

describe('normalizeUiScalePref / resolveUiScale', () => {
  it('非法值一律回落到 auto', () => {
    expect(normalizeUiScalePref(undefined)).toBe('auto');
    expect(normalizeUiScalePref(null)).toBe('auto');
    expect(normalizeUiScalePref('')).toBe('auto');
    expect(normalizeUiScalePref('3')).toBe('auto');
    expect(normalizeUiScalePref(1.3)).toBe('auto');
    expect(normalizeUiScalePref('abc')).toBe('auto');
  });

  it('合法档位原样保留（字符串与数字都接受）', () => {
    for (const o of UI_SCALE_OPTIONS) expect(normalizeUiScalePref(o.value)).toBe(o.value);
    expect(normalizeUiScalePref(1.5)).toBe('1.5');
    expect(normalizeUiScalePref(' 2 ')).toBe('2');
  });

  it('resolve：auto 走自动档，指定档位直接生效（不受屏幕影响）', () => {
    expect(resolveUiScale(work(3840, 2160), 'auto')).toBe(1.75);
    expect(resolveUiScale(work(1920, 1080), '2')).toBe(2);
  });
});

describe('scaledWindowSize', () => {
  it('1K/100% → 与现状完全一致（回归保护）', () => {
    const s = scaledWindowSize(BASE_WINDOW, 1, work(1920, 1080));
    expect(s).toEqual({ width: 1280, height: 800, minWidth: 960, minHeight: 600 });
  });

  it('4K@100%（100% 档位按倍率放大）→ 窗口与最小尺寸等比放大', () => {
    const s = scaledWindowSize(BASE_WINDOW, 1.75, work(3840, 2160));
    expect(s).toEqual({ width: 2240, height: 1400, minWidth: 1680, minHeight: 1050 });
  });

  it('超出工作区时收回（留 40 DIP），且最小尺寸不超过实际尺寸', () => {
    const s = scaledWindowSize(BASE_WINDOW, 2, work(1920, 1080));
    expect(s.width).toBe(1880);  // 1280×2=2560 → 收回 1920−40
    expect(s.height).toBe(1000); // 800×2=1600  → 收回 1040−40
    expect(s.minWidth).toBeLessThanOrEqual(s.width);
    expect(s.minHeight).toBeLessThanOrEqual(s.height);
  });

  it('没有工作区信息时只做等比放大', () => {
    const s = scaledWindowSize({ width: 1100, height: 720, minWidth: 900, minHeight: 560 }, 1.25);
    expect(s).toEqual({ width: 1375, height: 900, minWidth: 1125, minHeight: 700 });
  });
});
