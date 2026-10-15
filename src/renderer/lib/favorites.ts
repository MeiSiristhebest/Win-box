// src/renderer/lib/favorites.ts
// ★ 2026-10-17（用户要求「详情页加收藏按钮 + 收藏列表增删改查」）：收藏存储。
//
// 口径与「观看历史」保持一致：**同订阅同源同片一条**（键复用 `historyGroupKey`，换集不新增）。
// 但**刻意不并入 lib/uiMemory.ts**，而是用独立 localStorage 键（`winbox-favorites`）：
//   · 那边是历史/墓碑最脆弱的一处（`clearUiMemory` 会整删 `tvboxUiMemory`、播放器/详情窗口走
//     `historyOnlyWriter` 分支），收藏塞进去会互相牵连（「清空全部历史」会连带删掉收藏）；
//   · 独立键天然被设置备份带上（`ConfigPage.collectLocalStorage()` 导出全部 localStorage 键）。
//
// 跨窗口：写盘 = 「本窗口内存 ∪ 盘上（同键取 updatedAt 新者）− 生效墓碑」，
//   墓碑复用 uiMemory 的带符号语义（`+ts`=删除、`-ts`=撤销），所以辅助窗口删掉的条目
//   不会被主窗口的旧快照复活（与 `mergeHistoryViews` 同构）。
import { historyGroupKey, tombstoneActive, unionTombstones } from './uiMemory';

/** 收藏变更广播（同窗口 UI 即时同步；跨窗口由 App 的 focus/恢复可见重读兜底） */
export const FAVORITES_EVENT = 'winbox:favorites-changed';

/** localStorage 键（与 `tvboxUiMemory` 分开放，互不影响） */
const FAVORITES_KEY = 'winbox-favorites';

/** 一条收藏（字段命名与 `WatchHistory` 对齐，可直接喂给 `historyCategories` / `restoreHistorySource`） */
export interface FavoriteItem {
  name: string;
  sourceKey?: string;
  vodId?: string;
  profileId?: string;
  sourceName?: string;
  pic?: string;
  remarks?: string;
  year?: string;
  type?: string;
  /** 用户自定义显示名（留空 = 用源片名） */
  title?: string;
  /** 用户备注 / 短评 */
  note?: string;
  /** 收藏时间（ms，列表默认按它倒序） */
  createdAt: number;
  /** 最后修改时间（ms，跨窗口合并取新者） */
  updatedAt: number;
}

export interface FavoriteInput {
  name: string;
  sourceKey?: string;
  vodId?: string;
  profileId?: string;
  sourceName?: string;
  pic?: string;
  remarks?: string;
  year?: string;
  type?: string;
}

/** 收藏身份引用（查询/删除用） */
export interface FavoriteRef {
  sourceKey?: string;
  vodId?: string;
  name?: string;
  profileId?: string;
}

/** 收藏键（同订阅同源同片一条）——复用观看历史的分组键口径 */
export function favoriteKey(ref: FavoriteRef): string {
  return historyGroupKey(ref);
}

/**
 * 候选键：带订阅 id / 不带订阅 id 两种写法都算命中
 * （老记录可能没写 `profileId`；同一部片不该因为档案 id 缺失就查不到）。
 */
export function favoriteKeyCandidates(ref: FavoriteRef): string[] {
  const a = historyGroupKey(ref);
  const b = historyGroupKey({ ...ref, profileId: undefined });
  return a === b ? [a] : [a, b];
}

/** 列表展示名（用户改过的名字优先，其次源片名去掉「 - 副标题」） */
export function favoriteTitle(it: FavoriteItem): string {
  const custom = (it.title || '').trim();
  if (custom) return custom;
  return (it.name || '').split(' - ')[0]?.trim() || it.name || '';
}

let items = new Map<string, FavoriteItem>();
/**
 * 删除/撤销标记（键 → 带符号时间戳 ms）—— 与 `uiMemory.deleted` 同语义：
 * `+ts` = 删除、`-ts` = 撤销；合并取 |ts| 更大的那次动作。
 */
let tombs = new Map<string, number>();
let loaded = false;

type DiskShape = { favorites?: Array<[string, unknown]>; deleted?: Array<[string, unknown]> } | null;

function readDisk(): DiskShape {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DiskShape;
  } catch {
    return null;
  }
}

/** 归一一条盘上/来源不明的记录（缺字段兜底，非法一律兜底不抛） */
export function normalizeFavorite(key: string, ex: Partial<FavoriteItem>): FavoriteItem {
  const updatedAt = Number(ex.updatedAt) || 0;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    name: str(ex.name) || key,
    sourceKey: str(ex.sourceKey),
    vodId: str(ex.vodId),
    profileId: str(ex.profileId),
    sourceName: str(ex.sourceName),
    pic: str(ex.pic),
    remarks: str(ex.remarks),
    year: str(ex.year),
    type: str(ex.type),
    title: str(ex.title),
    note: str(ex.note),
    createdAt: Number(ex.createdAt) || updatedAt,
    updatedAt,
  };
}

/**
 * 合并「本窗口内存 ∪ 盘上/传入」，并施加墓碑：
 * ① 内存里被删除标记覆盖的 → 先剔除（别的窗口的旧快照会被清掉）；
 * ② 传入条目被删除标记覆盖 → 不复活；
 * ③ 其余同键取 `updatedAt` 更新者。
 */
export function mergeFavoriteViews(
  memory: Map<string, FavoriteItem>,
  persisted: Array<[string, unknown]> | null | undefined,
  tombstones: Map<string, number>,
): Map<string, FavoriteItem> {
  const out = new Map(memory);
  for (const key of tombstones.keys()) {
    const cur = out.get(key);
    if (cur && tombstoneActive(tombstones, key, cur.updatedAt || 0)) out.delete(key);
  }
  if (!Array.isArray(persisted)) return out;
  for (const [k, v] of persisted) {
    if (typeof k !== 'string' || !k || !v || typeof v !== 'object') continue;
    const ex = v as Partial<FavoriteItem>;
    const up = Number(ex.updatedAt) || 0;
    if (tombstoneActive(tombstones, k, up)) continue; // 删得比这条更晚 → 保持删除
    const cur = out.get(k);
    if (!cur || (cur.updatedAt || 0) < up) out.set(k, normalizeFavorite(k, ex));
  }
  return out;
}

function persist(): void {
  const disk = readDisk();
  tombs = unionTombstones(tombs, disk?.deleted);
  items = mergeFavoriteViews(items, disk?.favorites, tombs);
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify({ favorites: Array.from(items), deleted: Array.from(tombs) }));
  } catch {
    /* 容量满等：静默（不影响界面） */
  }
}

function emit(): void {
  // 注意：本文件会被 tests 间接引入，主 tsconfig 的 lib 只有 ES2022（无 DOM）→ 不能直接写 `window`；
  // 渲染进程里 `globalThis` 就是 window，`globalThis.dispatchEvent` 存在即可派发；Node 下不存在 → 静默。
  try {
    const g = globalThis as unknown as { dispatchEvent?: (e: unknown) => void; Event?: new (t: string) => unknown };
    if (typeof g.dispatchEvent === 'function' && typeof g.Event === 'function') g.dispatchEvent(new g.Event(FAVORITES_EVENT));
  } catch {
    /* 非渲染环境（单测）无 window */
  }
}

/**
 * 记一次动作标记（`+ts` 删除 / `-ts` 撤销）。
 * ★ 必须保证 |ts| **严格大于**该键已有标记、且（删除时）大于被删记录的 `updatedAt` ——
 *   否则同毫秒内的「收藏 → 移除」会因 `ts === updatedAt` 判不出删除（实测踩过）。
 */
function markAction(key: string, kind: 'delete' | 'restore', afterUpdatedAt = 0): void {
  const prev = Math.abs(tombs.get(key) || 0);
  const ts = Math.max(Date.now(), prev + 1, afterUpdatedAt + 1);
  tombs.set(key, kind === 'delete' ? ts : -ts);
}

/** 盘 → 内存（App 启动、窗口 focus / 恢复可见时调用） */
export function loadFavorites(): void {
  const disk = readDisk();
  tombs = unionTombstones(tombs, disk?.deleted);
  items = mergeFavoriteViews(items, disk?.favorites, tombs);
  loaded = true;
}

function ensureLoaded(): void {
  if (!loaded) loadFavorites();
}

/** 全部收藏（按收藏时间倒序） */
export function listFavorites(): FavoriteItem[] {
  ensureLoaded();
  return Array.from(items.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 全部收藏（**连存储键一起返回**，按收藏时间倒序）。
 * 列表页用它 —— 删除/编辑时直接拿这条记录**自身的键**，不必再按片子反推（老记录键形可能不同）。
 */
export function listFavoritesWithKeys(): Array<{ key: string; item: FavoriteItem }> {
  ensureLoaded();
  return Array.from(items.entries())
    .map(([key, item]) => ({ key, item }))
    .sort((a, b) => b.item.createdAt - a.item.createdAt);
}

/** 收藏条数 */
export function favoritesCount(): number {
  ensureLoaded();
  return items.size;
}

/**
 * 命中一条收藏（连命中用的键一起返回，删除时用它）。
 * 先按候选键精确查；**订阅 id 缺失时**再按「源 + 片」兜底扫一遍
 * —— 老记录（没写 `profileId`）与「查询才知道档案 id」两种方向都要能命中。
 */
export function findFavorite(ref: FavoriteRef): { key: string; item: FavoriteItem } | null {
  ensureLoaded();
  for (const key of favoriteKeyCandidates(ref)) {
    const item = items.get(key);
    if (item) return { key, item };
  }
  const sk = (ref.sourceKey || '').trim();
  const vid = (ref.vodId || '').trim();
  if (sk && vid) {
    for (const [key, item] of items) {
      if ((item.sourceKey || '') === sk && (item.vodId || '') === vid) return { key, item };
    }
  }
  return null;
}

/** 是否已收藏 */
export function isFavorited(ref: FavoriteRef): boolean {
  return findFavorite(ref) !== null;
}

/** 增：收藏（已存在则只刷新元数据，`createdAt` 与用户改过的名字/备注保留） */
export function addFavorite(input: FavoriteInput): FavoriteItem {
  ensureLoaded();
  const key = favoriteKey(input);
  const prev = items.get(key);
  const now = Date.now();
  items.set(key, {
    name: input.name || prev?.name || '',
    sourceKey: input.sourceKey ?? prev?.sourceKey,
    vodId: input.vodId ?? prev?.vodId,
    profileId: input.profileId ?? prev?.profileId,
    sourceName: input.sourceName ?? prev?.sourceName,
    pic: input.pic || prev?.pic,
    remarks: input.remarks || prev?.remarks,
    year: input.year || prev?.year,
    type: input.type || prev?.type,
    title: prev?.title,
    note: prev?.note,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  });
  // 重新收藏 = 覆盖之前的删除标记（否则盘上的旧墓碑会把它挡住）
  markAction(key, 'restore');
  persist();
  emit();
  return items.get(key) as FavoriteItem;
}

/** 删：移除（写删除墓碑并**立即落盘**，避免别的窗口用旧快照把它复活） */
export function removeFavorite(key: string): boolean {
  ensureLoaded();
  const cur = items.get(key);
  const hit = items.delete(key);
  markAction(key, 'delete', cur?.updatedAt || 0);
  persist();
  emit();
  return hit;
}

/** 撤销：整条无损还原（不刷新 `createdAt`/`updatedAt`） */
export function restoreFavorite(item: FavoriteItem): boolean {
  ensureLoaded();
  const key = favoriteKey(item);
  if (items.has(key)) return false;
  // 记「撤销」标记（负数）而不是删掉标记：只删内存里的会被下一次合并（并盘上）重新并回来
  markAction(key, 'restore');
  items.set(key, item);
  persist();
  emit();
  return true;
}

/** 改：更新显示名 / 备注（其余字段不动） */
export function updateFavorite(key: string, patch: { title?: string; note?: string }): boolean {
  ensureLoaded();
  const cur = items.get(key);
  if (!cur) return false;
  items.set(key, { ...cur, ...patch, updatedAt: Date.now() });
  persist();
  emit();
  return true;
}

/** 清空全部收藏（显式意图 → 墓碑一并清掉，否则重新收藏会被自己的墓碑挡住） */
export function clearFavorites(): void {
  ensureLoaded();
  items.clear();
  tombs.clear();
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch {
    /* ignore */
  }
  emit();
}
