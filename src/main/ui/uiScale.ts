// src/main/ui/uiScale.ts
/**
 * ★ 2026-10-16（用户要求「自适应屏幕分辨率调节窗口大小与字体大小」）：界面缩放的**主进程侧**。
 *
 * 职责：
 *  ① 偏好落盘（`<userData>/ui-scale.json`，与 bosskey.json / proxy.json 同一套 JsonStore 口径）；
 *  ② 按「主显示器工作区（DIP）」推导自动倍率（纯函数见 `shared/uiScale.ts`）；
 *  ③ 把倍率应用到**本应用自己的 UI 窗口**（`registerUiWindow` 登记过的主 / 详情 / 搜索 / 播放器窗），
 *     用 `webContents.setZoomFactor` 把整套 UI（字号/间距/圆角）等比放大；
 *  ④ 配置页改档位时**顺带把主窗口按新倍率改尺寸**（未最大化时），否则大倍率下窗口只装得下半个界面。
 *
 * ★ 为什么不用 CSS `zoom`/根字号：全项目尺寸都是 px（不是 rem），CSS `zoom` 还会把
 *   `html{height:100%}` 这类百分比高度算错（根元素缩放后仍按未缩放的 ICB 解析 → 溢出）。
 *   `setZoomFactor` 是 Chromium 的**页面缩放**（等同 Ctrl+滚轮），视口/ICB 一起缩，布局不会走样。
 *
 * ★ 网页源窗口（`webbridge/WebHomeWindow`）加载的是**外部网页**，不参与缩放（不登记即可）。
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { JsonStore } from '../store/JsonStore';
import { userDataDir } from '../util/paths';
import { fileLogger } from '../util/logger';
import {
  BASE_WINDOW,
  normalizeUiScalePref,
  resolveUiScale,
  scaledWindowSize,
  type UiScalePref,
  type UiScaleState,
  type UiScaleValue,
} from '../../shared/uiScale';

const KEY = 'uiScale';

/**
 * ★ 惰性建 store：**不在模块导入期**碰 `app.getPath`（`userDataDir()` 依赖它）——
 *   否则任何 import 本模块的单元测试都得先把 electron 的 `app` 桩补全（本次就踩过）。
 */
let storeRef: JsonStore | null = null;
function store(): JsonStore {
  if (!storeRef) storeRef = new JsonStore(join(userDataDir(), 'ui-scale.json'));
  return storeRef;
}

/** 已登记的「本应用 UI 窗口」（主 / 详情 / 搜索 / 播放器） */
const uiWindows = new Set<BrowserWindow>();

/** 供 `setUiScalePref` 改尺寸用的主窗口取用器（index.ts 在 createWindow 后注入） */
let getMainWindow: () => BrowserWindow | null = () => null;

/** 登记一个需要参与缩放的 UI 窗口（窗口销毁时自动移除） */
export function registerUiWindow(w: BrowserWindow): void {
  uiWindows.add(w);
  w.once('closed', () => uiWindows.delete(w));
}

/** 注入主窗口取用器（改档位时要按新倍率重排窗口尺寸） */
export function setMainWindowProvider(fn: () => BrowserWindow | null): void {
  getMainWindow = fn;
}

/** 当前偏好（读盘；非法值回落到 auto） */
export function getUiScalePref(): UiScalePref {
  return normalizeUiScalePref(store().getObject<{ value?: unknown }>(KEY, {}).value);
}

/** 当前生效状态（偏好 + 推导倍率 + 依据的工作区），供 IPC 回给配置页 */
export function uiScaleState(): UiScaleState {
  const work = screen.getPrimaryDisplay().workAreaSize;
  const pref = getUiScalePref();
  return { pref, scale: resolveUiScale(work, pref), work: { width: work.width, height: work.height } };
}

/** 主窗口（或其它基准窗口）按当前倍率应有的尺寸 */
export function scaledWindowFor(base: { width: number; height: number; minWidth?: number; minHeight?: number }) {
  const work = screen.getPrimaryDisplay().workAreaSize;
  return scaledWindowSize(base, resolveUiScale(work, getUiScalePref()), work);
}

/** 把当前倍率应用到所有已登记的 UI 窗口（返回生效倍率；启动时与改档位时各调一次） */
export function applyUiScale(): UiScaleValue {
  const { pref, scale, work } = uiScaleState();
  for (const w of uiWindows) {
    if (w.isDestroyed()) continue;
    try {
      w.webContents.setZoomFactor(scale);
    } catch {
      /* webContents 尚未就绪等：忽略（窗口创建处还会再调一次 applyUiScale） */
    }
  }
  fileLogger.i(`ui-scale: 偏好=${pref} 工作区=${work.width}x${work.height} → ${Math.round(scale * 100)}%（已应用 ${uiWindows.size} 个窗口）`);
  return scale;
}

/**
 * 改档位：落盘 → 立即应用 → **未最大化的主窗口按新倍率改尺寸**（含最小尺寸）→ 回最新状态。
 * 最大化/全屏时不动窗口（用户当前视图优先），只改缩放。
 */
export function setUiScalePref(v: unknown): UiScaleState {
  store().setObject(KEY, { value: normalizeUiScalePref(v) });
  const scale = applyUiScale();
  const mw = getMainWindow();
  if (mw && !mw.isDestroyed() && !mw.isMaximized() && !mw.isFullScreen()) {
    const s = scaledWindowFor(BASE_WINDOW);
    mw.setMinimumSize(s.minWidth, s.minHeight);
    mw.setSize(s.width, s.height);
    fileLogger.i(`ui-scale: 主窗口按 ${Math.round(scale * 100)}% 重排 → ${s.width}x${s.height}（min ${s.minWidth}x${s.minHeight}）`);
  }
  return uiScaleState();
}
