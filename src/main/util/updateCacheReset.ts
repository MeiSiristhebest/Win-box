// src/main/util/updateCacheReset.ts
// ★ 2026-10-15（用户要求）：**更新后首次启动**清空应用私有缓存（winbox-cache）。
//   背景：升级时下载的安装包落在 `winbox-cache/update/` 且**从不删除**，逐版累积会让整个安装目录
//   膨胀到 GB 级（实测有人已 2G+）。
//
//   判定口径 = 在 `<userData>/last-run-version.json` 记「上次运行版本」，本次版本与之不同即视为
//   「更新后首次启动」。★ 标记文件**必须放在 winbox-cache 之外**，否则会被本次清理自己删掉 →
//   变成「每次启动都清」。
//
//   本模块只做**纯判定 + fs 读写**（不依赖 electron），可单测；electron 接线见 `main/index.ts`。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 「上次运行版本」标记文件绝对路径（★ 放在 userData 根，不能被 winbox-cache 清理波及） */
export function lastRunVersionPath(userData: string): string {
  return join(userData, 'last-run-version.json');
}

/**
 * 是否「更新后首次启动」：
 *  - 无历史版本（全新安装 / 标记丢失）→ false（不清理，仅记录）；
 *  - 与当前版本相同 → false；
 *  - 版本发生变化 → true。
 */
export function isFirstLaunchAfterUpdate(prevVersion: string, currentVersion: string): boolean {
  const p = (prevVersion || '').trim();
  const c = (currentVersion || '').trim();
  if (!p || !c) return false;
  return p !== c;
}

/** 读取上次运行版本（文件缺失/损坏 → ''，不抛） */
export function readLastRunVersion(file: string): string {
  try {
    const o = JSON.parse(readFileSync(file, 'utf-8')) as { version?: unknown };
    return typeof o?.version === 'string' ? o.version : '';
  } catch {
    return '';
  }
}

/** 写入当前运行版本（失败仅忽略：下次启动再记） */
export function writeLastRunVersion(file: string, version: string): void {
  try {
    writeFileSync(file, JSON.stringify({ version, at: new Date().toISOString() }, null, 2));
  } catch {
    /* ignore */
  }
}
