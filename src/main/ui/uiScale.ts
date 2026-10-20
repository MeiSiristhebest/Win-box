import { BrowserWindow, screen } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { join } from 'node:path';
import { JsonStore } from '../store/JsonStore';
import { userDataDir } from '../util/paths';
import { fileLogger } from '../util/logger';
import {
  BASE_WINDOW, fitWindowToWorkArea, normalizeUiScalePref, resolveUiScale, scaledWindowSize,
  type UiScalePref, type UiScaleState, type UiScaleValue,
} from '../../shared/uiScale';

const KEY = 'uiScale';
let storeRef: JsonStore | null = null;
function store(): JsonStore {
  if (!storeRef) storeRef = new JsonStore(join(userDataDir(), 'ui-scale.json'));
  return storeRef;
}

const uiWindows = new Set<BrowserWindow>();
let getMainWindow: () => BrowserWindow | null = () => null;
let watchingDisplays = false;

function displayFor(window?: BrowserWindow | null): Electron.Display {
  if (window && !window.isDestroyed()) return screen.getDisplayMatching(window.isMinimized() ? window.getNormalBounds() : window.getBounds());
  return screen.getPrimaryDisplay();
}

export function getUiScalePref(): UiScalePref {
  return normalizeUiScalePref(store().getObject<{ value?: unknown }>(KEY, {}).value);
}

export function uiScaleState(window: BrowserWindow | null = getMainWindow()): UiScaleState {
  const work = displayFor(window).workArea;
  const pref = getUiScalePref();
  return { pref, scale: resolveUiScale(work, pref), work: { width: work.width, height: work.height } };
}

export function scaledWindowFor(base: { width: number; height: number; minWidth?: number; minHeight?: number }) {
  const work = displayFor(getMainWindow()).workArea;
  return scaledWindowSize(base, resolveUiScale(work, getUiScalePref()), work);
}

/** 缩放使用窗口所在显示器；尺寸和位置同时限制在该显示器的工作区内。 */
function reconcileWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  const work = displayFor(window).workArea;
  const scale = resolveUiScale(work, getUiScalePref());
  if (window.webContents.isDestroyed()) return;
  if (window.webContents.getZoomFactor() !== scale) window.webContents.setZoomFactor(scale);
  window.webContents.send(IPC.UI_SCALE_CHANGED, uiScaleState(window));
  const preferred = scaledWindowSize(BASE_WINDOW, scale, work);
  const [oldMinWidth, oldMinHeight] = window.getMinimumSize();
  const main = window === getMainWindow();
  const minWidth = main ? preferred.minWidth : Math.min(oldMinWidth, Math.max(1, work.width - 40));
  const minHeight = main ? preferred.minHeight : Math.min(oldMinHeight, Math.max(1, work.height - 40));
  if (minWidth !== oldMinWidth || minHeight !== oldMinHeight) window.setMinimumSize(minWidth, minHeight);
  if (window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
  const before = window.getBounds();
  const target = fitWindowToWorkArea({ ...before,
    width: Math.max(before.width, minWidth),
    height: Math.max(before.height, minHeight),
  }, work);
  if (before.x !== target.x || before.y !== target.y || before.width !== target.width || before.height !== target.height) {
    window.setBounds(target);
  }
}

export function registerUiWindow(window: BrowserWindow): void {
  if (uiWindows.has(window)) return;
  window.webContents.setZoomMode('isolated');
  uiWindows.add(window);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastDisplay = displayFor(window);
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.isDestroyed()) return;
      const next = displayFor(window);
      if (next.id !== lastDisplay.id || next.workArea.width !== lastDisplay.workArea.width || next.workArea.height !== lastDisplay.workArea.height || next.scaleFactor !== lastDisplay.scaleFactor) {
        lastDisplay = next;
        reconcileWindow(window);
      }
    }, 120);
  };
  const restored = () => {
    clearTimeout(timer);
    timer = setTimeout(() => reconcileWindow(window), 0);
  };
  window.on('move', schedule);
  window.on('resize', schedule);
  window.on('restore', restored);
  window.on('unmaximize', restored);
  window.on('leave-full-screen', restored);
  window.once('closed', () => { clearTimeout(timer); uiWindows.delete(window); });
  if (!watchingDisplays) {
    watchingDisplays = true;
    screen.on('display-metrics-changed', () => applyUiScale());
    screen.on('display-removed', () => applyUiScale());
    screen.on('display-added', () => applyUiScale());
  }
}

export function setMainWindowProvider(provider: () => BrowserWindow | null): void {
  getMainWindow = provider;
}

export function applyUiScale(): UiScaleValue {
  for (const window of uiWindows) {
    try { reconcileWindow(window); }
    catch (error) { fileLogger.w('界面缩放暂未应用：' + (error as Error).message); }
  }
  return uiScaleState().scale;
}

export function setUiScalePref(value: unknown): UiScaleState {
  store().setObject(KEY, { value: normalizeUiScalePref(value) });
  applyUiScale();
  return uiScaleState();
}
