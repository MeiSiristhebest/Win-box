import { app, BrowserWindow, shell } from 'electron';
import { DEFAULT_THEME } from '../../shared/ui/themeTokens';
import type { UiThemeId } from '../../shared/uiPreferences';
import { windowSurfaceColor } from '../preferences/WindowSurfacePolicy';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc-channels';
import { searchWindowRoute } from '../../shared/searchWin';
import { applyWindowCorner } from '../util/windowCorner';
import { applyUiScale, registerUiWindow, scaledWindowFor } from '../ui/uiScale';

declare const __dirname: string;
let searchWin: BrowserWindow | null = null;
export function searchWindow(): BrowserWindow | null { return searchWin; }
let pendingRoute = '';
let ready = false;

function pushPendingRoute(): void {
  if (searchWin && !searchWin.isDestroyed() && ready && !searchWin.webContents.isLoading()) {
    searchWin.webContents.send(IPC.WIN_NAVIGATE, pendingRoute);
  }
}

export function searchWindowReady(senderId: number): void {
  if (!searchWin || searchWin.isDestroyed() || searchWin.webContents.id !== senderId) return;
  ready = true;
  searchWin.webContents.send(IPC.WIN_NAVIGATE, pendingRoute);
}

export function openSearchWindow(term: string | { term: string; profileId?: string; allProfiles?: boolean }, themeId: UiThemeId = DEFAULT_THEME): { ok: boolean; reused: boolean } {
  const value = typeof term === 'string' ? { term } : term;
  const searchTerm = String(value?.term || '');
  if (!searchTerm.trim()) throw new Error('搜索词不能为空');
  pendingRoute = searchWindowRoute(searchTerm, value.profileId, value.allProfiles ?? true);
  if (searchWin && !searchWin.isDestroyed()) {
    if (searchWin.isMinimized()) searchWin.restore();
    searchWin.show();
    searchWin.focus();
    if (ready) {
      pushPendingRoute();
      // 连续搜索与首次挂载交错时，只补发最新路由。
      setTimeout(pushPendingRoute, 80).unref();
    }
    return { ok: true, reused: true };
  }
  ready = false;
  // ★ 2026-10-16（界面缩放）：窗口尺寸随屏幕分辨率放大（内容由 setZoomFactor 等比放大）
  const size = scaledWindowFor({ width: 1100, height: 760, minWidth: 900, minHeight: 560 });
  const win = new BrowserWindow({
    width: size.width, height: size.height, minWidth: size.minWidth, minHeight: size.minHeight,
    title: 'Win-Box · 搜索结果', frame: false, autoHideMenuBar: true, show: false,
    backgroundColor: windowSurfaceColor(themeId, 'application'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  searchWin = win;
  registerUiWindow(win);
  applyUiScale();
  win.on('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); setTimeout(pushPendingRoute, 80).unref(); } });
  win.on('maximize', () => { applyWindowCorner(win, false); win.webContents.invalidate(); });
  win.on('unmaximize', () => { applyWindowCorner(win, true); win.webContents.invalidate(); });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { if (searchWin === win) { searchWin = null; ready = false; } });
  if (!app.isPackaged && process.env.NODE_ENV !== 'production') {
    void win.loadURL(`http://localhost:5173/#${pendingRoute}`);
  } else {
    void win.loadFile(join(__dirname, 'renderer', 'index.html'), { hash: pendingRoute });
  }
  return { ok: true, reused: false };
}
