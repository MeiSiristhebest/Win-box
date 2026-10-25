import type { WatchHistory } from './uiMemoryTypes';

function baseNameOfHistory(name?: string): string {
  return (name || '').split(' - ')[0]?.trim() || '';
}

/**
 * ★ 2026-09-29（用户报「同一部剧第一集/第二集算两条历史」）：**历史分组键** —— 同源同片合并为一条。
 *   判据优先级：`sourceKey + vodId`（最稳，跨集同键）→ `sourceKey + 片名基底` → 退回 url（保持旧行为）。
 */
export function historyGroupKey(meta: { sourceKey?: string; vodId?: string; name?: string; url?: string; profileId?: string }): string {
  const sk = (meta.sourceKey || '').trim();
  const pid = (meta.profileId || '').trim();
  const prefix = pid ? `p:${pid}:` : '';
  const vid = (meta.vodId || '').trim();
  if (sk && vid) return `${prefix}k:${sk}:${vid}`;
  const base = baseNameOfHistory(meta.name);
  if (sk && base) return `${prefix}n:${sk}#${base}`;
  return (meta.url || '').trim();
}

// ---- ★ 2026-09-26：历史页「有更新」检测的两个纯函数（可单测）----

/** 从历史记录的备注/名称里解析**已看到第几集**（解析不到返回 0，如电影「HD」） */
export function watchedEpisodeOf(it: Pick<WatchHistory, 'remarks' | 'name'>): number {
  const s = `${it.remarks || ''} ${it.name || ''}`;
  const m = /(?:[Ss]\d{1,2})?[Ee][Pp]?\s*0*(\d{1,4})|第\s*0*(\d{1,4})\s*[集话話期]/.exec(s);
  const n = m ? Number(m[1] ?? m[2]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 源当前最新集数：取各线路集数最大值与备注「更新至N集」两处的大者 */
export function latestEpisodeOf(d: { episodes?: Record<string, Array<unknown>>; remarks?: string }): number {
  let n = 0;
  for (const list of Object.values(d.episodes || {})) n = Math.max(n, Array.isArray(list) ? list.length : 0);
  const m = /(?:更新至|全)\s*0*(\d{1,4})\s*[集话話期]/.exec(d.remarks || '');
  if (m) n = Math.max(n, Number(m[1]) || 0);
  return n;
}

// ---- ★ 2026-09-28：历史删除墓碑（纯函数，可单测）----

/** 墓碑保留时长（30 天）——过期的墓碑不再影响合并（用户很久以前删过的片子可以正常重新记录） */
export const TOMB_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** 墓碑条数上限（超出按时间新→旧保留），防 localStorage 无限膨胀 */
export const TOMB_MAX = 500;

/** 归一一条「持久化形态」的历史记录（缺字段兜底，与 recordWatch 的字段集保持一致） */
export function normalizeWatch(url: string, ex: Partial<WatchHistory>): WatchHistory {
  return {
    name: typeof ex.name === 'string' ? ex.name : url,
    url,
    rawUrl: ex.rawUrl,
    flag: ex.flag,
    pic: ex.pic,
    remarks: ex.remarks,
    sourceName: ex.sourceName,
    sourceKey: ex.sourceKey,
    profileId: ex.profileId,
    vodId: ex.vodId,
    time: Number(ex.time) || 0,
    updatedAt: Number(ex.updatedAt) || 0,
  };
}

/** 清理标记：丢弃 |ts| 超过 TOMB_KEEP_MS 的，并按 |ts| 新→旧截断到 TOMB_MAX 条 */
export function pruneTombstones(tombs: Map<string, number>, now: number): Map<string, number> {
  const cutoff = now - TOMB_KEEP_MS;
  const live: Array<[string, number]> = [];
  for (const [url, ts] of tombs) {
    if (url && Number.isFinite(ts) && ts !== 0 && Math.abs(ts) >= cutoff) live.push([url, ts]);
  }
  live.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return new Map(live.slice(0, TOMB_MAX));
}

/**
 * 合并两处标记（本窗口内存 ∪ 盘上）：同 url 取**最近一次动作**（|ts| 更大者，保留其符号 = 删除/撤销），
 * 再统一清理。
 *
 * 为什么要并盘上的：播放器窗口是另一个渲染进程，它启动后再由主窗口执行的删除**不在它的内存里**；
 * 只有把盘上的标记一起并进来，它的下一次写盘才不会把主窗口刚删的条目复活。
 */
export function unionTombstones(
  base: Map<string, number>,
  persisted: Array<[string, unknown]> | null | undefined,
  now: number,
): Map<string, number> {
  const out = new Map(base);
  if (Array.isArray(persisted)) {
    for (const [k, v] of persisted) {
      if (typeof k !== 'string' || !k) continue;
      const ts = Number(v) || 0;
      if (ts !== 0 && Math.abs(ts) > Math.abs(out.get(k) || 0)) out.set(k, ts);
    }
  }
  return pruneTombstones(out, now);
}

/**
 * 该 url 的记录是否被「删除」标记抑制：仅当当前动作是**删除**（ts > 0）且删除晚于记录自身 updatedAt。
 * （用户删除后又重新观看 → 新记录的 updatedAt 更新 ⇒ 自动放行；撤销标记为负数 ⇒ 永不抑制。）
 */
export function tombstoneActive(tombs: Map<string, number>, url: string, updatedAt: number): boolean {
  const ts = tombs.get(url) || 0;
  return ts > 0 && ts > updatedAt;
}

/**
 * 合并「本窗口内存 history」与「盘上 history」，并施加删除标记语义：
 * 1. 内存里已被删除标记覆盖 → 先从内存剔除（播放器窗口的旧快照会被清掉）；
 * 2. 盘上条目若被删除标记覆盖 → **不复活**；
 * 3. 其余同 url 取 `updatedAt` 更新者（原有跨窗口合并语义）。
 */
export function mergeHistoryViews(
  memory: Map<string, WatchHistory>,
  persisted: Array<[string, unknown]> | null | undefined,
  tombstones: Map<string, number>,
): Map<string, WatchHistory> {
  const map = new Map(memory);
  for (const url of tombstones.keys()) {
    const cur = map.get(url);
    if (cur && tombstoneActive(tombstones, url, cur.updatedAt || 0)) map.delete(url);
  }
  if (!Array.isArray(persisted)) return map;
  for (const [k, v] of persisted) {
    if (typeof k !== 'string' || !k || !v || typeof v !== 'object') continue;
    const ex = v as Partial<WatchHistory>;
    const updatedAt = Number(ex.updatedAt) || 0;
    if (tombstoneActive(tombstones, k, updatedAt)) continue; // 删得比这条记录更晚 → 保持删除
    const cur = map.get(k);
    if (!cur || (cur.updatedAt || 0) < updatedAt) map.set(k, normalizeWatch(k, ex));
  }
  return map;
}

/**
 * ★ 2026-09-29：把「按 url 存的旧记录」归并到**分组键**（同源同片多集合并为一条）。
 *   载入/写盘都过一遍 —— 用户既有历史（ep1/ep2 两条）在升级后自动合并；
 *   合并取 `updatedAt` 更新者（即最近看的那一集），并施加墓碑（旧键或新键命中即丢弃）。
 */
export function regroupHistory(
  map: Map<string, WatchHistory>,
  tombstones: Map<string, number>,
): Map<string, WatchHistory> {
  const out = new Map<string, WatchHistory>();
  // 旧历史首次续播补齐 profileId 后，写盘合并不能把原来的无档案记录复活成第二条。
  const scoped = new Set(Array.from(map.values()).filter((it) => it?.profileId)
    .map((it) => `${historyGroupKey({ ...it, profileId: undefined })}\n${it.rawUrl || it.url}`));
  for (const [k, it] of map) {
    if (!it) continue;
    if (!it.profileId && scoped.has(`${historyGroupKey(it)}\n${it.rawUrl || it.url}`)) continue;
    const gk = historyGroupKey(it) || k;
    if (tombstoneActive(tombstones, gk, it.updatedAt || 0)) continue;
    const cur = out.get(gk);
    if (!cur || (cur.updatedAt || 0) < (it.updatedAt || 0)) out.set(gk, it);
  }
  return out;
}
