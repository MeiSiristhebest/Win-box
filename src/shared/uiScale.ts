/**
 * Display scale controls text and controls through Electron zoom.
 * Gallery posters compensate for this zoom using a separate size preference.
 * Window startup size follows the display scale; later zoom changes preserve window bounds.
 */

export const BASE_WINDOW = { width: 1280, height: 800, minWidth: 960, minHeight: 600 } as const;

/** 允许的缩放档位 */
export type UiScaleValue = 1 | 1.25 | 1.5 | 1.75 | 2;

/** 偏好：`auto`（跟随屏幕）或指定档位（**字符串**形态，便于落盘与比较，避免浮点相等问题） */
export type UiScalePref = 'auto' | '1' | '1.25' | '1.5' | '1.75' | '2';

/** 配置页展示用的档位清单 */
export const UI_SCALE_OPTIONS: ReadonlyArray<{ value: UiScalePref; label: string }> = [
  { value: 'auto', label: '跟随屏幕' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '1.75', label: '175%' },
  { value: '2', label: '200%' },
];

/** 生效状态：偏好 + 推导出的倍率 + 依据的显示器工作区（IPC 回给渲染层显示用） */
export interface UiScaleState {
  pref: UiScalePref;
  scale: UiScaleValue;
  work: { width: number; height: number };
}

/** 归一偏好（非法值/缺省 → `auto`） */
export function normalizeUiScalePref(v: unknown): UiScalePref {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return UI_SCALE_OPTIONS.some((o) => o.value === s) ? (s as UiScalePref) : 'auto';
}

/**
 * 自动档位：分别按**工作区宽 / 高**各推一档，再取**较小者** ——
 * 这样超宽屏（5120×1440）不会被宽度推到过大，4K（3840×2160）也不会被高度压小。
 *
 *   宽：`<2048 → 100%` · `<3072 → 125%` · `<3400 → 150%` · `<4800 → 175%` · 其余 → 200%
 *   高：`<1180 → 100%` · `<1560 → 125%` · `<2100 → 150%` · `<2600 → 175%` · 其余 → 200%
 *
 * 实测样例（工作区按减去任务栏约 40 DIP 估）：1920×1040 → 100% · 2560×1400 → 125% ·
 * 3840×2120（4K@100%）→ 175% · 2560×1400（4K@150% 与 2K@100% 同）→ 125% · 5120×1400 → 125%。
 */
export function autoUiScale(work: { width: number; height: number }): UiScaleValue {
  const byW: UiScaleValue = work.width < 2048 ? 1 : work.width < 3072 ? 1.25 : work.width < 3400 ? 1.5 : work.width < 4800 ? 1.75 : 2;
  const byH: UiScaleValue = work.height < 1180 ? 1 : work.height < 1560 ? 1.25 : work.height < 2100 ? 1.5 : work.height < 2600 ? 1.75 : 2;
  return byW < byH ? byW : byH;
}

/** 生效倍率 = 指定档位；`auto` 则按工作区自动推导 */
export function resolveUiScale(work: { width: number; height: number }, pref: UiScalePref): UiScaleValue {
  const p = normalizeUiScalePref(pref);
  return p === 'auto' ? autoUiScale(work) : (Number(p) as UiScaleValue);
}

/**
 * 把基准窗口尺寸按倍率放大，并**收回工作区内**（留 40 DIP 给任务栏/贴边）。
 * 最小尺寸同样放大 —— 否则 175% 下 960 DIP 的最小窗只放得下 ~548 CSS px，布局会挤坏；
 * 但不允许超过实际尺寸（保证 window 本身合法）。
 */
export function scaledWindowSize(
  base: { width: number; height: number; minWidth?: number; minHeight?: number },
  scale: number,
  work?: { width: number; height: number },
): { width: number; height: number; minWidth: number; minHeight: number } {
  const width = Math.min(Math.round(base.width * scale), work ? Math.max(1, work.width - 40) : Number.MAX_SAFE_INTEGER);
  const height = Math.min(Math.round(base.height * scale), work ? Math.max(1, work.height - 40) : Number.MAX_SAFE_INTEGER);
  return {
    width,
    height,
    minWidth: Math.min(Math.round((base.minWidth ?? 640) * scale), width),
    minHeight: Math.min(Math.round((base.minHeight ?? 400) * scale), height),
  };
}

/** 调整尺寸和位置，使窗口完整位于当前显示器工作区；支持副屏的负坐标。 */
export function fitWindowToWorkArea(
  bounds: { x: number; y: number; width: number; height: number },
  work: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const margin = Math.max(0, Math.min(20, Math.floor((Math.min(work.width, work.height) - 1) / 2)));
  const width = Math.min(Math.max(1, Math.round(bounds.width)), Math.max(1, work.width - margin * 2));
  const height = Math.min(Math.max(1, Math.round(bounds.height)), Math.max(1, work.height - margin * 2));
  return {
    width, height,
    x: Math.round(Math.max(work.x + margin, Math.min(bounds.x, work.x + work.width - margin - width))),
    y: Math.round(Math.max(work.y + margin, Math.min(bounds.y, work.y + work.height - margin - height))),
  };
}
