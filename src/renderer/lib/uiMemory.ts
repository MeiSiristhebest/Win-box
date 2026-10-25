import { canWriteRendererStorage } from './storageEpoch';
// src/renderer/lib/uiMemory.ts
// ★ 页面切换（含系统返回/前进）后保留关键状态的模块级内存：
//   同一渲染进程内页面卸载再挂载时共享，覆盖"播放进度/资源列表定位"。
//   与 Electron 系统级返回（Alt+← / 浏览器返回）天然协同：popstate 触发路由切换，
//   页面重挂载时从此处恢复状态。
// 聚合搜索结果记忆（搜索 → 详情 → 返回时恢复搜索结果界面）
import { playbackProgressKey, type PlaybackSourceRef } from './playbackProgress';
import type { RecordWatchInput, UiMemory, WatchHistory } from './uiMemoryTypes';
import { historyGroupKey, mergeHistoryViews, normalizeWatch, regroupHistory, tombstoneActive, unionTombstones } from './uiHistoryMerge';
import { mergeHomeOnLoad, normalizeHome, pickHomeForSave } from './uiHomeMemory';
export type { DetailMem, HomeMem, HomeSearchMem, RecordWatchInput, UiMemory, WatchHistory } from './uiMemoryTypes';
export { historyGroupKey, latestEpisodeOf, mergeHistoryViews, normalizeWatch, pruneTombstones, regroupHistory, tombstoneActive, unionTombstones, watchedEpisodeOf, TOMB_KEEP_MS, TOMB_MAX } from './uiHistoryMerge';
export { mergeHomeOnLoad, normalizeHome, pickHomeForSave } from './uiHomeMemory';


export const uiMem: UiMemory = {
  home: { key: '', tid: '', pg: 1, scrollTop: 0, filters: {}, search: null },
  detail: new Map(),
  playTime: new Map(),
  playSource: null,
  history: new Map(),
  deleted: new Map(),
};

/** 在内存历史里按「分组键或记录 url」定位真实键（删除/续播/迁移用） */
function resolveHistoryKey(keyOrUrl: string): string {
  if (!keyOrUrl) return '';
  if (uiMem.history.has(keyOrUrl)) return keyOrUrl;
  for (const [k, it] of uiMem.history) {
    if (it.url === keyOrUrl || it.rawUrl === keyOrUrl) return k;
  }
  return keyOrUrl;
}

/** 记录一次观看（同源同片**合并为一条**：换集即更新该条的当前集/进度；保留已有刮削信息）。 */
export function recordWatch(meta: RecordWatchInput): void {
  const { url } = meta;
  if (!url) return;
  const key = historyGroupKey(meta) || url;
  // 兼容旧键：早先按「url」存下的同一条记录一并迁到分组键（否则会留两条）
  const oldKey = historyGroupKey({ ...meta, profileId: undefined });
  const old = key !== oldKey ? uiMem.history.get(oldKey) : undefined;
  const legacy = (old && !old.profileId ? old : undefined) || (key !== url ? uiMem.history.get(url) : undefined);
  const prev = uiMem.history.get(key) || legacy;
  if (legacy && key !== url) uiMem.history.delete(url);
  if (old === legacy && key !== oldKey) uiMem.history.delete(oldKey);
  const curEp = meta.rawUrl || url;
  const prevEp = prev?.rawUrl || prev?.url || '';
  const sameEp = !!prev && prevEp === curEp;
  uiMem.history.set(key, {
    name: meta.name || prev?.name || url,
    url,
    rawUrl: meta.rawUrl ?? prev?.rawUrl,
    flag: meta.flag ?? prev?.flag,
    pic: meta.pic ?? prev?.pic,
    remarks: meta.remarks ?? prev?.remarks,
    sourceName: meta.sourceName ?? prev?.sourceName,
    sourceKey: meta.sourceKey ?? prev?.sourceKey,
    profileId: meta.profileId ?? prev?.profileId,
    vodId: meta.vodId ?? prev?.vodId,
    // ★ 换成新一集时进度归零重算（不能沿用上一集看到第 40 分钟的位置）
    time: Math.max(0, sameEp ? (meta.time ?? prev?.time ?? 0) : (meta.time ?? 0)),
    updatedAt: Date.now(),
  });
  schedulePersist(); // ★ 变更即落盘，避免只靠退出时保存（崩溃/强杀不丢）
}

/**
 * ★ 2026-09-30（用户要求「从历史记录启动第三方播放器，播放器也应该正确识别历史播放的位置」）：
 * 同一集已有进度（秒）—— 拉起外部播放器时作为起播位置。
 * 不同集（或没有记录）→ 0（外部播放器无法回传进度，跨集沿用旧位置会"跳错集"）。
 */
export function sameEpProgress(sourceKey: string | undefined, vodId: string | undefined, rawUrl: string, profileId?: string): number {
  const ep = (rawUrl || '').trim();
  if (!ep) return 0;
  const key = historyGroupKey({ sourceKey, vodId, url: ep, profileId });
  const legacyKey = historyGroupKey({ sourceKey, vodId, url: ep });
  const it = uiMem.history.get(key) || uiMem.history.get(legacyKey) || uiMem.history.get(ep);
  if (!it) return 0;
  const same = (it.rawUrl || it.url) === ep;
  return same ? Math.max(0, Math.floor(it.time || 0)) : 0;
}

/**
 * 删除单条历史（返回内存里是否命中）。
 * ★ 2026-09-28：写入**删除墓碑**并**立即落盘**（不等 2s 防抖）——
 *   否则另一个窗口（播放器窗口每 5s 写一次盘）的合并会把这条从 localStorage 原样补回。
 */
export function deleteWatch(keyOrUrl: string): boolean {
  if (!keyOrUrl) return false;
  const key = resolveHistoryKey(keyOrUrl) || keyOrUrl;
  const hit = uiMem.history.delete(key);
  const hitAlt = keyOrUrl !== key ? uiMem.history.delete(keyOrUrl) : false;
  uiMem.deleted.set(key, Date.now());
  // 旧 url 键的残留条目同样打墓碑（否则写盘合并时会从盘上补回）
  if (keyOrUrl !== key) uiMem.deleted.set(keyOrUrl, Date.now());
  saveUiMemory();
  return hit || hitAlt;
}

/**
 * 恢复一条被删除的历史（"撤销"用）：整条原样写回，**保留原有 updatedAt 与进度**。
 *
 * 为什么不复用 recordWatch：recordWatch 会把 updatedAt 刷成 now（并做字段合并），
 * 撤销后记录会跳到列表最前、时间显示也变了。撤销必须是无损还原，故单独提供。
 */
export function restoreWatch(item: WatchHistory): boolean {
  if (!item || !item.url) return false;
  const key = historyGroupKey(item) || item.url;
  // 仅在"当前离线"时恢复，避免把用户后来的新记录覆盖掉
  if (uiMem.history.has(key) || uiMem.history.has(item.url)) return false;
  // ★ 记一条**撤销**标记（负数）而不是删掉标记：盘上可能已有删除标记，
  //   只删内存里的会被下一次合并（并盘上）重新并回来，撤销等于没做。
  uiMem.deleted.set(key, -Date.now());
  if (key !== item.url) uiMem.deleted.set(item.url, -Date.now());
  uiMem.history.set(key, item);
  saveUiMemory();
  return true;
}

/** 最近观看列表（按 updatedAt 倒序） */
export function recentWatch(limit = 100): WatchHistory[] {
  return Array.from(uiMem.history.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * ★ 2026-09-26：**只写播放进度与观看历史**（独立播放器窗口专用）。
 *
 * 为什么需要：播放器窗口与主窗口是两个渲染进程、共享同一份 localStorage。播放器窗口启动时
 * 会把当时 localStorage 的 `home/detail`（含「上次搜索态」）读进自己的 uiMem；此后它每写一次历史
 * （recordWatch / setPlayTime → schedulePersist）都会**整份**写盘 → 把主窗口已经清掉的旧值
 * **复活**。用户症状：不在搜索页进的资源，返回列表却回到了上一次的搜索页。
 * 打开本开关后，播放器窗口写盘时沿用 localStorage 里的 `home/detail`，只覆盖 history/playTime。
 */
let historyOnlyWriter = false;
export function markHistoryOnlyWriter(): void {
  historyOnlyWriter = true;
}

/**
 * 防抖持久化：2s 内多次变更合并为一次写盘。
 * localStorage 同步写、量小（≤100 条历史 + 浏览状态），2s 防抖在 IO 与丢失风险间取平衡。
 */
export function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveUiMemory();
  }, 2000);
}

/** 立即写盘（退出/切页等确定时机调用；内部做了容量异常兜底）。 */
export function saveUiMemory() {
  if (!canWriteRendererStorage()) return;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // ★ 多窗口合并写盘：主窗口与独立播放器窗口是不同渲染进程，各自持有一份 uiMem。
  //   若直接覆盖 localStorage，任一阵地 flush 都会把另一窗口刚写的历史冲掉（历史上"历史为空"的根因）。
  //   这里把 localStorage 现存 history 按每条 url 合并（同 url 取 updatedAt 更新者），再整写。
  //   ★ 2026-09-28：合并**必须先施加删除墓碑**，否则被删条目会从盘上原样补回（"删一次删不掉"）。
  const prev = (() => {
    try {
      const raw = localStorage.getItem('tvboxUiMemory');
      if (!raw) return null;
      return JSON.parse(raw) as {
        history?: Array<[string, unknown]>;
        deleted?: Array<[string, unknown]>;
      } | null;
    } catch {
      return null;
    }
  })();
  const existing = prev && Array.isArray(prev.history) ? prev.history : null;
  uiMem.deleted = unionTombstones(uiMem.deleted, prev?.deleted, Date.now());
  // ★ 2026-09-29：合并后按分组键归并（同源同片多集 → 一条），并回写内存保持一致
  const map = regroupHistory(mergeHistoryViews(uiMem.history, existing, uiMem.deleted), uiMem.deleted);
  uiMem.history = map;
  // 播放器窗口：浏览态（home/detail）沿用盘里主窗口写的那份，绝不用自己的旧快照覆盖（见 markHistoryOnlyWriter）
  const keep = prev as { home?: unknown; detail?: unknown } | null;
  // ★ 2026-09-28：home 取「更新的那份」——播放器窗口不再把自己的旧快照（含上一次搜索态）写回去
  const home = historyOnlyWriter ? (normalizeHome(keep?.home) || { key: '', tid: '', pg: 1, scrollTop: 0, filters: {}, search: null }) : pickHomeForSave(uiMem.home, keep?.home, false);
  const detail = historyOnlyWriter ? (Array.isArray(keep?.detail) ? keep.detail : []) : Array.from(uiMem.detail.entries());
  const tombstones = Array.from(uiMem.deleted.entries());
  const data = {
    home,
    detail,
    playTime: Array.from(uiMem.playTime.entries()),
    history: Array.from(map.entries()),
    deleted: tombstones,
  };
  try {
    localStorage.setItem('tvboxUiMemory', JSON.stringify(data));
  } catch {
    // 容量满等：降级为只保留历史（核心数据），丢弃浏览状态
    try {
      localStorage.setItem(
        'tvboxUiMemory',
        JSON.stringify({ home, detail: [], playTime: [], history: Array.from(map.entries()), deleted: tombstones }),
      );
    } catch {
      // ignore（彻底写不进去时静默，避免影响播放）
    }
  }
}

// 从 localStorage 加载（可选，按需调用）
export function loadUiMemory() {
  try {
    // ★ 与 saveUiMemory 对称：取盘动作也放在 try 内（存储不可用时不炸调用方）
    const raw = localStorage.getItem('tvboxUiMemory');
    if (!raw) return;
    const data = JSON.parse(raw);
    // ★ 2026-09-28：浏览态从盘上刷新，搜索态取 updatedAt 更新的一方（防盘上旧搜索覆盖内存里的新搜索）
    if (!historyOnlyWriter) {
      uiMem.home = mergeHomeOnLoad(uiMem.home, data.home);
      uiMem.detail = new Map(data.detail || []);
    }
    uiMem.playTime = new Map(data.playTime || []);
    // ★ 2026-09-28：墓碑一起载入（本窗口内存 ∪ 盘上），再按墓碑过滤历史 —— 否则"删了再切回本页"会回弹
    uiMem.deleted = unionTombstones(uiMem.deleted, data.deleted, Date.now());
    const h: Array<[string, unknown]> = data.history || [];
    const norm = new Map<string, WatchHistory>();
    for (const [k, v] of h) {
      if (!k) continue;
      if (v && typeof v === 'object' && 'updatedAt' in (v as object)) {
        norm.set(k, v as WatchHistory);
      } else {
        norm.set(k, { name: k, url: k, time: Number(v) || 0, updatedAt: 0 });
      }
    }
    uiMem.history = regroupHistory(mergeHistoryViews(norm, null, uiMem.deleted), uiMem.deleted);
  } catch {
    // ignore
  }
}

// 在 App.tsx 中调用 loadUiMemory() 初始化，在页面卸载时调用 saveUiMemory() 保存
// 示例：在 App.tsx 的 useEffect 中 load，在各个页面的 useEffect(unmount) 中 save

/** 会话标记键（**主进程 sessionId** 落在这里；两窗口共享 localStorage） */
const SESSION_ID_KEY = 'winbox-session-id';

/**
 * ★★ 2026-09-30（用户要求「软件关闭后，所有的墓碑机制都应该脱钩」）★★
 *
 * 丢**页面状态类**记忆：浏览态 `home`（含搜索态 `search`）、详情态 `detail`、播放来源 `playSource`。
 * 这类记忆只在**本会话**内有意义（「搜索 → 详情 → 返回」要能回到搜索页；「点播 → 详情 → 返回」要回到原分类），
 * 跨启动保留只会让用户重启后点「点播」被拉回上一次的搜索界面（用户报的正是这个）。
 * 跨启动保留的只有**用户资产**：观看历史 `history`、播放进度 `playTime`、历史删除墓碑 `deleted`。
 *
 * ★ `updatedAt` 必须 bump 成当前时间 —— `pickHomeForSave()` 取「更新的那份」，
 *   不 bump 的话写盘时盘上那份旧 home（含旧搜索态）会被判定为更新而**原地复活**。
 */
export function dropSessionUiMemory(): void {
  uiMem.home = { key: '', tid: '', pg: 1, scrollTop: 0, filters: {}, search: null, updatedAt: Date.now() };
  uiMem.detail.clear();
  uiMem.playSource = null;
  saveUiMemory();
}

/**
 * ★ 会话凭据 = **主进程给的 sessionId**（进程启动时生成，重启必变）。
 *
 * 为什么不看 sessionStorage：Electron/Chromium 会把 sessionStorage **落盘**
 * （`<userData>/Session Storage/` leveldb）并在下次启动给同一 origin 恢复 ——
 * 实测「重启后 sessionStorage 仍在」，据此判定"新会话"会**永远判不出重启**（本次踩过）。
 * @returns 是否判定为「新一次启动」并已执行脱钩
 */
export function dropSessionUiMemoryIfRestarted(sessionId: string): boolean {
  const sid = String(sessionId || '');
  if (!sid) return false;
  let prev = '';
  try {
    prev = localStorage.getItem(SESSION_ID_KEY) || '';
  } catch {
    return false; // 存储不可用：保守不动
  }
  if (prev === sid) return false;
  try {
    localStorage.setItem(SESSION_ID_KEY, sid);
  } catch {
    /* ignore */
  }
  dropSessionUiMemory();
  return true;
}

// 清除历史记录与浏览状态（可选功能）
export function clearUiMemory() {
  uiMem.home = { key: '', tid: '', pg: 1, scrollTop: 0, filters: {}, search: null };
  uiMem.detail.clear();
  uiMem.playTime.clear();
  uiMem.playSource = null;
  uiMem.history.clear();
  uiMem.deleted.clear(); // ★ 整表清空 = 显式意图，墓碑一并清掉（否则重新观看同一条会被自己的墓碑挡住）
  try {
    localStorage.removeItem('tvboxUiMemory');
  } catch {
    // ignore
  }
}

/** 播放进度按档案与源隔离；写入后防抖落盘。 */
export function setPlayTime(url: string, sec: number, source?: PlaybackSourceRef): void {
  uiMem.playTime.set(playbackProgressKey(url, source), sec);
  schedulePersist();
}

export function getPlayTime(url: string, source?: PlaybackSourceRef): number {
  return uiMem.playTime.get(playbackProgressKey(url, source)) || 0;
}

/**
 * ★ 2026-09-20 修复「历史续播位置过期」：
 * 从「历史数组（[url, 记录] 对）」中取指定 url **updatedAt 最新**的一条。
 * 纯函数（可单测）：播放器窗口可能把更新的进度写进 localStorage，主窗口内存快照过期，
 * 续播前应以此为准。
 */
export function latestOf(entries: Array<[string, unknown]> | null | undefined, url: string): WatchHistory | null {
  if (!entries) return null;
  let best: WatchHistory | null = null;
  for (const [k, v] of entries) {
    if (k !== url || !v || typeof v !== 'object') continue;
    const it = v as Partial<WatchHistory>;
    const rec: WatchHistory = {
      name: typeof it.name === 'string' ? it.name : url,
      url,
      rawUrl: it.rawUrl,
      flag: it.flag,
      pic: it.pic,
      remarks: it.remarks,
      sourceName: it.sourceName,
      sourceKey: it.sourceKey,
      profileId: it.profileId,
      vodId: it.vodId,
      time: Number(it.time) || 0,
      updatedAt: Number(it.updatedAt) || 0,
    };
    if (!best || rec.updatedAt > best.updatedAt) best = rec;
  }
  return best;
}

/**
 * ★ 从 localStorage 读指定记录的最新历史（无/异常/已被删除返回 null，调用方回退内存快照）。
 * ★ 2026-09-29：入参可为**分组键**或**记录 url/rawUrl**（同源同片多集合并后键不再是 url）。
 */
export function loadLatestWatch(keyOrUrl: string): WatchHistory | null {
  try {
    const raw = localStorage.getItem('tvboxUiMemory');
    if (!raw) return null;
    const d = JSON.parse(raw) as {
      history?: Array<[string, unknown]>;
      deleted?: Array<[string, unknown]>;
    } | null;
    const rows = d?.history;
    if (!Array.isArray(rows) || !keyOrUrl) return null;
    let best: WatchHistory | null = null;
    let bestKey = '';
    for (const [k, v] of rows) {
      if (typeof k !== 'string' || !k || !v || typeof v !== 'object') continue;
      const rec = normalizeWatch(k, v as Partial<WatchHistory>);
      if (k !== keyOrUrl && rec.url !== keyOrUrl && rec.rawUrl !== keyOrUrl) continue;
      if (!best || rec.updatedAt > best.updatedAt) {
        best = rec;
        bestKey = k;
      }
    }
    if (!best) return null;
    // ★ 已被删除（删除标记更晚）→ 视为不存在，避免从历史续播到用户删掉的条目
    const tombs = unionTombstones(uiMem.deleted, d?.deleted, Date.now());
    if (tombstoneActive(tombs, bestKey, best.updatedAt || 0)) return null;
    if (bestKey !== keyOrUrl && tombstoneActive(tombs, keyOrUrl, best.updatedAt || 0)) return null;
    return best;
  } catch {
    return null;
  }
}
