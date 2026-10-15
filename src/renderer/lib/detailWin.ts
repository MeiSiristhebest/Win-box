// src/renderer/lib/detailWin.ts
// 详情打开方式：默认「单页内在主界面跳转」（伪墓碑），配置页可切到「独立窗口」。
// 辅助窗口（详情/搜索）内始终复用本窗口改路由，不另开窗口。
//
// 路由约定与窗口标记的纯函数在 `shared/detailWin.ts`（主进程/更新门禁/测试共用同一份）。
// 详情窗口的识别：主进程加载 `#/detail/:key/:id?…&dw=1`（见 main/player/DetailWindow）。
import { client } from '../api/client';
import { isDetailWinHash, detailRoute } from '../../shared/detailWin';
import { isSearchWinHash } from '../../shared/searchWin';
import { getNavMode } from './uiPrefs';

const detailWindow = isDetailWinHash(window.location.hash);

/** 当前窗口是否就是「独立详情窗口」（由主进程打开） */
export function isDetailWindow(): boolean {
  return detailWindow;
}

/**
 * 打开详情页统一入口：
 * ★ 2026-10-15（用户要求「伪墓碑」）：按「页面打开方式」分流 ——
 *   · 辅助窗口（详情/搜索）内 或 独立窗口模式 → 交给主进程开窗/复用窗口（原行为）；
 *   · 单页内模式（默认）→ 在**本窗口**内跳转（主界面里替换可见内容，上一个页面保持挂载 → 返回零重载）。
 * 打开失败由调用方提示，不回退内嵌展示。
 */
export async function openDetailRoute(
  nav: (to: string) => void,
  key: string,
  id: string,
  query?: string,
): Promise<void> {
  if (isDetailWindow() || isSearchWinHash(window.location.hash) || getNavMode() === 'window') {
    await client.winOpenDetail({ key, id, query: String(query || '') });
    return;
  }
  nav(detailRoute(key, id, query));
}
