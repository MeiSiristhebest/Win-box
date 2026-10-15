import { client } from '../api/client';
import { isSearchWinHash, searchWindowRoute } from '../../shared/searchWin';
import { isDetailWinHash } from '../../shared/detailWin';
import { getNavMode } from './uiPrefs';

const searchWindow = isSearchWinHash(window.location.hash);
export function isSearchWindow(): boolean { return searchWindow; }

/** ★ 2026-10-15：本窗口的导航函数（App 注入）—— 「单页内」模式下搜索在**本窗口内**跳转。 */
let navFn: ((to: string) => void) | null = null;
export function bindSearchNav(fn: (to: string) => void): void { navFn = fn; }

/** 「单页内」模式的搜索结果路由（不带窗口标记 `sw=1`，否则会被误判成搜索窗口） */
function inlineSearchRoute(term: string): string {
  return `/search?agg=${encodeURIComponent(String(term).trim())}`;
}

/**
 * 搜索入口统一分流：
 *   · 搜索窗口内 → 改本窗口 hash（原行为）；
 *   · 详情窗口内（辅助窗口）→ 仍走主进程开/复用搜索窗口（原行为）；
 *   · 主窗口「单页内」模式 → 在**本窗口内**跳 `/search?agg=…`（主界面里替换可见内容）；
 *   · 其余（独立窗口模式）→ 主进程开搜索窗口。
 */
export async function openSearchWindow(term: string): Promise<void> {
  const t = String(term || '').trim();
  if (!t) return;
  if (searchWindow) {
    window.location.hash = searchWindowRoute(t);
    return;
  }
  if (!isDetailWinHash(window.location.hash) && getNavMode() === 'inline' && navFn) {
    navFn(inlineSearchRoute(t));
    return;
  }
  await client.winOpenSearch(t);
}
