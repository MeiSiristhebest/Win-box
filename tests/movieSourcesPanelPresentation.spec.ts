import { describe, expect, it } from 'vitest';
import type { SearchAllReport } from '../src/shared/types';
import { projectMovieSourcesPanelStatus } from '../src/renderer/features/discovery/application/movieSourcesPanelPresentation';

const report: SearchAllReport = { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };

function input(overrides: Partial<Parameters<typeof projectMovieSourcesPanelStatus>[0]> = {}) {
  return {
    searchLoading: false,
    searchError: '',
    report,
    resultCount: 0,
    folderActive: false,
    folderLoading: false,
    folderError: '',
    folderErrorKind: '' as const,
    folderItemCount: 0,
    ...overrides,
  };
}

describe('projectMovieSourcesPanelStatus', () => {
  it('distinguishes initial loading from an empty successful search', () => {
    expect(projectMovieSourcesPanelStatus(input({ searchLoading: true, report: null }))).toMatchObject({ kind: 'searching', showInitialLoading: true });
    expect(projectMovieSourcesPanelStatus(input())).toMatchObject({ kind: 'empty', message: expect.stringContaining('没有匹配片源') });
  });

  it('makes global search failures retryable', () => {
    expect(projectMovieSourcesPanelStatus(input({ searchError: 'offline', report: null }))).toEqual({
      kind: 'search-error', message: 'offline', retryLabel: '重试搜索',
    });
  });

  it('surfaces partial source failures even when no source returned a result', () => {
    expect(projectMovieSourcesPanelStatus(input({ report: { ...report, failedSources: 2 } }))).toEqual({
      kind: 'partial-error', message: '2 个源搜索失败，可重试。', retryLabel: '重试搜索', failedSources: 2,
    });
  });

  it('provides a distinct loading, retry, and empty state for folder browsing', () => {
    expect(projectMovieSourcesPanelStatus(input({ folderActive: true, folderLoading: true }))).toMatchObject({ kind: 'folder-loading' });
    expect(projectMovieSourcesPanelStatus(input({ folderActive: true, folderError: 'network error', folderErrorKind: 'folder' }))).toEqual({
      kind: 'folder-error', message: 'network error', retryLabel: '重试加载目录',
    });
    expect(projectMovieSourcesPanelStatus(input({ folderActive: true }))).toMatchObject({ kind: 'folder-empty' });
  });
});
