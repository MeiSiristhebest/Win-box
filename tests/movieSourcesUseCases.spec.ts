import { describe, expect, it, vi } from 'vitest';
import type { SearchAllProgressEvent, SearchAllReport, VodItem } from '../src/shared/types';
import { loadMovieSourceFolder, searchMovieSources } from '../src/renderer/features/discovery/application/movieSourcesUseCases';
import type { MovieSourceFolderPort, MovieSourcesSearchPort } from '../src/renderer/features/discovery/application/movieSourcesPorts';

const item = (name: string, sourceKey = 'cloud'): VodItem => ({
  id: name,
  name,
  pic: '',
  remarks: '',
  year: '',
  area: '',
  type: '',
  sourceKey,
});

const emptyReport: SearchAllReport = { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };

describe('movie source application use cases', () => {
  it('searches all saved profiles, filters foreign progress, and unsubscribes at completion', async () => {
    let onProgress: ((event: SearchAllProgressEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const port: MovieSourcesSearchPort = {
      readScope: async () => ({ activeProfileId: 'A', profileIds: ['A', 'B', 'A'], hasConfiguredSources: true }),
      onProgress: listener => { onProgress = listener; return unsubscribe; },
      searchAll: vi.fn(async () => emptyReport),
    };
    const progress = vi.fn();
    const search = searchMovieSources('目标', false, port, progress);
    await Promise.resolve();
    onProgress?.({ wd: 'other', profileId: 'A', done: 1, total: 3 });
    onProgress?.({ wd: '目标', profileId: 'C', done: 1, total: 3 });
    onProgress?.({ wd: '目标', profileId: 'B', profileOrder: 1, sourceOrder: 0, done: 2, total: 3,
      source: { profileId: 'B', profileName: '乙仓', key: 'cloud', name: '云盘', status: 'ok', items: [item('目标')] } });

    const result = await search;
    expect(port.searchAll).toHaveBeenCalledWith('目标', { profileIds: ['A', 'B'], refresh: false });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0][0].report.items[0]).toMatchObject({ name: '目标', sourceRef: { profileId: 'B', key: 'cloud' } });
    expect(result.progress).toEqual({ done: 2, total: 3 });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('falls back to the active profile when legacy configuration has no profile list', async () => {
    const port: MovieSourcesSearchPort = {
      readScope: async () => ({ activeProfileId: 'legacy', profileIds: [], hasConfiguredSources: true }),
      onProgress: () => vi.fn(),
      searchAll: vi.fn(async () => emptyReport),
    };
    await searchMovieSources('目标', true, port, () => undefined);
    expect(port.searchAll).toHaveBeenCalledWith('目标', { profileId: 'legacy', refresh: true });
  });

  it('explains the missing-search-scope error before subscribing or searching', async () => {
    const port: MovieSourcesSearchPort = {
      readScope: async () => ({ activeProfileId: '', profileIds: [], hasConfiguredSources: false }),
      onProgress: vi.fn(() => vi.fn()),
      searchAll: vi.fn(async () => emptyReport),
    };
    await expect(searchMovieSources('目标', false, port, () => undefined)).rejects.toThrow('请先导入订阅');
    expect(port.onProgress).not.toHaveBeenCalled();
    expect(port.searchAll).not.toHaveBeenCalled();
  });

  it('expands a folder with the source profile identity preserved on every returned item', async () => {
    const port: MovieSourceFolderPort = {
      category: vi.fn(async () => ({ items: [item('第01集', 'other')] })),
    };
    const [episode] = await loadMovieSourceFolder(port, {
      id: 'folder-id',
      name: '文件夹',
      sourceKey: 'cloud',
      sourceRef: { profileId: 'B', key: 'cloud' },
      sourceName: '夸克盘',
      sourceProfileName: '乙仓',
    });
    expect(port.category).toHaveBeenCalledWith({ key: 'cloud', tid: 'folder-id', pg: '1', extend: {}, profileId: 'B' });
    expect(episode).toMatchObject({ sourceKey: 'cloud', sourceRef: { profileId: 'B', key: 'cloud' }, sourceName: '夸克盘', sourceProfileName: '乙仓', sameFromOtherSources: 0 });
  });
});
