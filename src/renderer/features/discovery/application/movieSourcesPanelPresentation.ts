import type { AggVodItem } from '../../../../shared/types';
import type { SearchAllReport } from '../../../../shared/types';
import { movieSearchTitle, searchTitleScore } from '../../../../shared/searchTitleMatching';

export type MovieSourcesPanelStatus =
  | { kind: 'searching'; message: string; showInitialLoading: boolean }
  | { kind: 'search-error'; message: string; retryLabel: string }
  | { kind: 'partial-error'; message: string; retryLabel: string; failedSources: number }
  | { kind: 'empty'; message: string }
  | { kind: 'results' }
  | { kind: 'folder-loading'; message: string }
  | { kind: 'folder-error'; message: string; retryLabel: string }
  | { kind: 'folder-empty'; message: string }
  | { kind: 'folder-results' }
  | { kind: 'detail-error'; message: string };

/** Keep empty, loading and failed source states distinct, including per-source failures. */
export function projectMovieSourcesPanelStatus(input: {
  searchLoading: boolean;
  searchError: string;
  report: SearchAllReport | null;
  resultCount: number;
  folderActive: boolean;
  folderLoading: boolean;
  folderError: string;
  folderErrorKind: 'folder' | 'detail' | '';
  folderItemCount: number;
}): MovieSourcesPanelStatus {
  if (input.folderError && input.folderErrorKind === 'detail') {
    return { kind: 'detail-error', message: input.folderError };
  }
  if (input.folderActive) {
    if (input.folderLoading) return { kind: 'folder-loading', message: '正在加载网盘目录…' };
    if (input.folderError && input.folderErrorKind === 'folder') {
      return { kind: 'folder-error', message: input.folderError, retryLabel: '重试加载目录' };
    }
    if (input.folderItemCount === 0) return { kind: 'folder-empty', message: '目录暂未返回条目。' };
    return { kind: 'folder-results' };
  }
  if (input.searchError) {
    return { kind: 'search-error', message: input.searchError, retryLabel: '重试搜索' };
  }
  if (input.searchLoading) return { kind: 'searching', message: '正在查找全部片源…', showInitialLoading: !input.report && input.resultCount === 0 };
  const failedSources = input.report?.failedSources ?? 0;
  if (failedSources > 0) {
    return { kind: 'partial-error', message: `${failedSources} 个源搜索失败，可重试。`, retryLabel: '重试搜索', failedSources };
  }
  if (input.resultCount === 0) return { kind: 'empty', message: '当前筛选下没有匹配片源，可以更换来源或匹配方式。' };
  return { kind: 'results' };
}

export interface MovieSourceCoverItem {
  id: string;
  name: string;
  year?: string;
  pic: string;
}

/** Keep the searched movie's poster from being applied to unrelated returned titles. */
export function projectMovieSourceCover(item: AggVodItem, query: string, fallbackPoster: string): MovieSourceCoverItem {
  const isFolder = item.tag === 'folder';
  return {
    id: JSON.stringify([item.sourceRef?.profileId, item.sourceKey, item.id]),
    name: isFolder ? query : movieSearchTitle(item.name),
    year: item.year,
    pic: item.pic || ((isFolder || searchTitleScore(query, item.name) > 0) ? fallbackPoster : ''),
  };
}

export function projectMovieSourceDetailQuery(item: AggVodItem): string {
  const params = new URLSearchParams({ name: item.name, pic: item.pic || '' });
  if (item.sourceRef?.profileId) params.set('profileId', item.sourceRef.profileId);
  return params.toString();
}
