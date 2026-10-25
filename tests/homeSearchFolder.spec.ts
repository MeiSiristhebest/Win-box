import { describe, expect, it, vi } from 'vitest';
import type { SearchAllReport, VodItem } from '../src/shared/types';
import {
  openHomeSearchFolder,
  resolveHomeSearchFolderExit,
  type HomeSearchFolderBack,
} from '../src/renderer/features/home/application/homeSearchFolder';

const report: SearchAllReport = {
  items: [],
  perSource: [],
  hitSources: 0,
  failedSources: 0,
  totalRaw: 0,
};

describe('home search folder application flow', () => {
  it('loads and normalizes folder items into a source-scoped search report', async () => {
    const item = { id: 'item-1', name: 'Episode' } as unknown as VodItem;
    const category = vi.fn(async () => ({ items: [item] }));

    const result = await openHomeSearchFolder({
      sourceKey: 'source-a',
      categoryId: 'folder-a',
      name: 'Cloud drive',
      profileId: 'profile-a',
      sourceName: 'Source A',
    }, { category, isCurrent: () => true });

    expect(category).toHaveBeenCalledWith({ key: 'source-a', tid: 'folder-a', pg: '1', profileId: 'profile-a' });
    expect(result.kind).toBe('opened');
    if (result.kind !== 'opened') return;
    expect(result.folder).toEqual({ key: 'source-a', tid: 'folder-a', name: 'Cloud drive', profileId: 'profile-a', sourceName: 'Source A' });
    expect(result.report.items[0]).toMatchObject({ id: 'item-1', sourceKey: 'source-a' });
    expect(result.report.perSource[0]).toMatchObject({ key: 'source-a', name: 'Source A · Cloud drive', status: 'ok' });
  });

  it('discards a folder response after its request becomes stale', async () => {
    const result = await openHomeSearchFolder({
      sourceKey: 'source-a', categoryId: 'folder-a', name: 'Cloud', profileId: 'profile-a', sourceName: 'Source A',
    }, {
      category: async () => ({ items: [] }),
      isCurrent: () => false,
    });

    expect(result).toEqual({ kind: 'stale' });
  });

  it('returns current failures as data while suppressing errors from stale requests', async () => {
    const command = {
      sourceKey: 'source-a', categoryId: 'folder-a', name: 'Cloud', profileId: 'profile-a', sourceName: 'Source A',
    };
    const failed = await openHomeSearchFolder(command, {
      category: async () => { throw new Error('offline'); },
      isCurrent: () => true,
    });
    const stale = await openHomeSearchFolder(command, {
      category: async () => { throw new Error('offline'); },
      isCurrent: () => false,
    });

    expect(failed).toEqual({ kind: 'failed', message: 'offline' });
    expect(stale).toEqual({ kind: 'stale' });
  });

  it('restores the previous search scope and result filter for the same profile', () => {
    const snapshot: HomeSearchFolderBack = {
      report,
      scope: 'all-profiles',
      sourceFilter: 'source-a',
      profileId: 'profile-a',
      searchAllProfiles: true,
    };

    expect(resolveHomeSearchFolderExit(snapshot, 'profile-a', 'show')).toEqual({
      kind: 'restored',
      memory: {
        wd: 'show', profileId: 'profile-a', aggMode: true, aggScope: 'all-profiles',
        searchAllSources: true, searchAllProfiles: true, agg: report, folder: null,
      },
      report,
      scope: 'all-profiles',
      sourceFilter: 'source-a',
      searchAllSources: true,
      searchAllProfiles: true,
    });
  });

  it('requires a fresh search when the folder snapshot belongs to another profile', () => {
    const snapshot: HomeSearchFolderBack = {
      report, scope: 'all', sourceFilter: '', profileId: 'profile-a', searchAllProfiles: false,
    };
    expect(resolveHomeSearchFolderExit(snapshot, 'profile-b', 'show')).toEqual({ kind: 'search-again' });
    expect(resolveHomeSearchFolderExit(null, 'profile-a', 'show')).toEqual({ kind: 'search-again' });
  });
});
