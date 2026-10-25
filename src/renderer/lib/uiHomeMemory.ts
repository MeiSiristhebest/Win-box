import type { HomeMem, HomeSearchMem } from './uiMemoryTypes';

// ---- ★ 2026-09-28：home 状态版本守卫（搜索返回栈，纯函数可单测）----

/** 归一「盘上形态」的 home（缺字段兜底；非法输入返回 null） */
export function normalizeHome(raw: unknown): HomeMem | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Partial<HomeMem>;
  return {
    key: typeof h.key === 'string' ? h.key : '',
    tid: typeof h.tid === 'string' ? h.tid : '',
    pg: Number(h.pg) || 1,
    scrollTop: Number(h.scrollTop) || 0,
    filters: (h.filters && typeof h.filters === 'object' ? h.filters : {}) as Record<string, string>,
    search: h.search && typeof h.search === 'object' ? (h.search as HomeSearchMem) : null,
    updatedAt: Number(h.updatedAt) || 0,
  };
}

/**
 * 载入（盘 → 内存）时合并 home：**浏览态以盘上为准**（保持「从盘上刷新」的既有语义），
 * **搜索态取 `updatedAt` 更新的一方** —— 防止盘上那份「上一次搜索」覆盖掉内存里刚做的新搜索。
 */
export function mergeHomeOnLoad(mem: HomeMem, disk: unknown): HomeMem {
  const d = normalizeHome(disk);
  if (!d) return mem;
  const memTs = mem.updatedAt || 0;
  const diskTs = d.updatedAt || 0;
  return {
    ...d,
    search: diskTs >= memTs ? d.search : mem.search,
    updatedAt: Math.max(memTs, diskTs),
  };
}

/**
 * 写盘（内存 → 盘）时取哪份 home：`updatedAt` 更大者胜出；
 * 相等时 `preferDiskOnTie`（播放器窗口 = true，它自己的 home 只是启动时的旧快照）。
 */
export function pickHomeForSave(mine: HomeMem, disk: unknown, preferDiskOnTie: boolean): HomeMem {
  const d = normalizeHome(disk);
  if (!d) return mine;
  const memTs = mine.updatedAt || 0;
  const diskTs = d.updatedAt || 0;
  if (diskTs > memTs) return d;
  if (memTs > diskTs) return mine;
  return preferDiskOnTie ? d : mine;
}
