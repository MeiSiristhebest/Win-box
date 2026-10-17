// src/renderer/lib/sessionSort.ts
// 会话内「分类/筛选」状态记忆（不落盘）：切换分类或筛选后记住每个 (profileId, sourceKey, tid) 的
// 选中筛选与页码，切走再切回时恢复。模块级 Map，仅在当前渲染进程存活期内有效。
export interface SessionSortEntry {
  /** 当前选中的筛选（分组 key → 选中 value） */
  filter: Record<string, string>;
  /** 当前页码 */
  pg: number;
}

const store = new Map<string, SessionSortEntry>();
const keyOf = (sourceKey: string, tid: string, profileId: string) => JSON.stringify([profileId, sourceKey, tid]);

export function getSessionSort(sourceKey: string, tid: string, profileId = ''): SessionSortEntry | undefined {
  if (!tid) return undefined;
  return store.get(keyOf(sourceKey, tid, profileId));
}

export function setSessionSort(sourceKey: string, tid: string, entry: SessionSortEntry, profileId = ''): void {
  if (!tid) return;
  store.set(keyOf(sourceKey, tid, profileId), { filter: { ...entry.filter }, pg: entry.pg });
}

/** 仅用于测试：清空会话内记忆。 */
export function clearSessionSort(): void {
  store.clear();
}