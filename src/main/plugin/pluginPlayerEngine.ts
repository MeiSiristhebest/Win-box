// src/main/plugin/pluginPlayerEngine.ts
// 插件第三方播放内核适配层：把 `contributes.player.engine`（L2 描述符）解析成宿主视图 `PlayerEngineView`。
//
// ★ 形态（D1 已拍板，见 R11 spec §4）：插件**只给描述符**，宿主负责进程托管；本文件只做
//   「exe 解析 + 就绪判定 + 视图摊平」这一层，**不拉进程、不 import electron**（便于单测）。
// ★ 二进制来源（D3 已拍板）：
//   · `plugin-file`（主）→ `<pluginsDir>/<id>.winbox/` + 插件内相对名（解析后必须仍落在插件目录内）；
//   · `local-path`（次）→ 用户在配置页指定的本机路径（对位 `mpvPath` 口径；空/不存在 → 未就绪 + 人话原因）。
// 事实源：docs/design/插件制作规范.md §6.3；机器契约见 src/shared/plugin.ts。
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { PlayerEngineContribute, PlayerEngineView } from '../../shared/plugin';

/** 归属插件（id + 显示名 + 插件根目录） */
export interface PlayerEngineOwner {
  id: string;
  name: string;
  /** 插件根目录（`<pluginsDir>/<id>.winbox`） */
  dir: string;
}

/**
 * 声明式贡献 → 视图（纯函数，`exists` 可注入便于单测）。
 * ★ 未就绪**仍出现在列表里**（`ready:false` + `note`），由渲染层显示为不可选 + 原因（不静默消失）。
 */
export function playerEngineFromContribute(
  c: PlayerEngineContribute,
  owner: PlayerEngineOwner,
  localPath: string,
  exists: (p: string) => boolean = existsSync,
): PlayerEngineView {
  const source = c.binary?.source ?? 'plugin-file';
  const base: PlayerEngineView = {
    id: `engine:${c.id}`,
    pluginId: owner.id,
    pluginName: owner.name,
    label: c.label,
    capabilities: [...(c.capabilities ?? [])],
    source,
    ready: false,
  };
  if (source === 'local-path') {
    const p = String(localPath || '').trim();
    if (!p) return { ...base, note: '未指定本机程序路径（请在配置页「插件播放内核」中填写）' };
    if (!exists(p)) return { ...base, path: p, note: '指定的本机程序不存在（请在配置页检查路径）' };
    return { ...base, path: p, ready: true };
  }
  const rel = String(c.binary?.file || '').trim();
  if (!rel) return { ...base, note: '插件未声明引擎可执行文件' };
  const full = join(owner.dir, rel);
  // 兜底（防磁盘篡改 / 越界）：解析后必须仍落在插件目录内
  const root = resolve(owner.dir);
  const target = resolve(full);
  if (target !== root && !target.startsWith(root + sep)) {
    return { ...base, note: '引擎可执行文件越出插件目录（已拒绝）' };
  }
  if (!exists(full)) return { ...base, path: full, note: '插件内的引擎可执行文件缺失（插件包不完整？）' };
  return { ...base, path: full, ready: true };
}
