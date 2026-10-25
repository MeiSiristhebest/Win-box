import type { HomeCascadeLevel } from './application/homeBrowseModel';
import type { HomeSortClassView } from './application/homePorts';

export type HomeSearchStatusModelInput = {
  loading: boolean;
  hasReport: boolean;
  isWideSearch: boolean;
  progress: { done: number; total: number; pending: number } | null;
  folder: { name: string } | null;
  folderItemCount: number;
  resultCount: number;
  scope: 'current' | 'all' | 'all-profiles';
  error: string;
  query: string;
  profileReady: boolean;
};

export type HomeSearchStatusModel = {
  topbarStatus: string;
  emptyStatus: string;
};

/**
 * Project search state into user-facing status copy without coupling workflow
 * orchestration to presentation policy. The idle state is deliberately distinct
 * from an in-flight search so an empty route cannot claim that work is running.
 */
export function buildHomeSearchStatusModel(input: HomeSearchStatusModelInput): HomeSearchStatusModel {
  const { loading, hasReport, isWideSearch, progress, folder, folderItemCount, resultCount, scope, error, query, profileReady } = input;
  const topbarStatus = loading
    ? isWideSearch
      ? progress ? `搜索中 · ${progress.done}/${progress.total} 个源` : '正在搜索全部来源'
      : folder ? `正在打开「${folder.name}」` : '正在搜索'
    : folder
      ? `${folderItemCount} 条目录内容`
      : hasReport
        ? `${resultCount} 条结果`
        : '等待搜索';

  const emptyStatus = loading
    ? folder
      ? `正在展开「${folder.name}」…`
      : isWideSearch
        ? (scope === 'all-profiles' ? '正在跨档案逐源检索' : '正在逐源检索') +
          (progress
            ? `（已出 ${progress.done}/${progress.total} 个源的结果${progress.pending > 0 ? `，其余 ${progress.pending} 个仍在补搜` : ''}）`
            : '（首次调用 jar 蜘蛛较慢）') + '，请稍候…'
        : '搜索中…'
    : error
      ? `搜索/展开失败：${error}`
      : !profileReady
        ? '正在准备搜索来源…'
        : query.trim()
          ? '搜索尚未开始，请使用顶部搜索框重新搜索。'
          : '输入影片、剧集或演员名开始搜索。';

  return { topbarStatus, emptyStatus };
}

/** Render a stable cache timestamp without reading the wall clock during render. */
export function formatSearchCacheTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Build the visible browse controls from the selected source's own category/filter metadata. */
export function buildHomeCascadeLevels({
  classes,
  tid,
  filtersActive,
  filtersOpen,
}: {
  classes: HomeSortClassView[];
  tid: string;
  filtersActive: Record<string, string>;
  filtersOpen: boolean;
}): HomeCascadeLevel[] {
  const levels: HomeCascadeLevel[] = [{
    key: 'class',
    label: '分类',
    value: tid === '' ? '' : tid,
    allLabel: '全部',
    options: classes.map((item) => ({ id: String(item.id), label: item.name })),
  }];
  let previousChosen = true;
  const currentClass = tid ? classes.find((item) => String(item.id) === tid) : undefined;
  for (const group of currentClass?.filters ?? []) {
    if (!filtersOpen && !previousChosen) break;
    const value = filtersActive[group.key];
    levels.push({
      key: `g:${group.key}`,
      label: group.name || group.key,
      value: value === undefined ? null : value,
      allLabel: '全部',
      options: group.value.filter((option) => option.v !== '').map((option) => ({ id: option.v, label: option.n })),
    });
    previousChosen = value !== undefined;
  }
  return levels;
}
