import { describe, expect, it, vi } from 'vitest';
import type { AggVodItem, SearchAllReport, VodDetail } from '../src/shared/types';
import { discoverPlaybackAlternatives, sourceIdentity } from '../src/renderer/features/playback/application/discoverPlaybackAlternatives';
import type { PlayerInitData } from '../src/renderer/features/playback/application/playerPageSession';

const current: PlayerInitData = {
  key: 'current-source',
  flag: 'line-a',
  episodes: [{ name: '第01集', url: 'current-episode-1' }, { name: '第02集', url: 'current-episode-2' }],
  epIndex: 1,
  title: '海风',
  lastUrl: '',
  lastName: '',
  meta: { profileId: 'profile-current', fromKey: 'current-source', id: 'current-id', vodId: 'current-id' },
};

function searchItem(overrides: Partial<AggVodItem> = {}): AggVodItem {
  return {
    id: 'alternate-id',
    name: '海风',
    pic: 'https://images.invalid/poster.jpg',
    remarks: '更新至12集',
    year: '2024',
    area: '中国大陆',
    type: '剧情',
    sourceKey: 'alternate-source',
    sourceRef: { profileId: 'profile-alternate', key: 'alternate-source' },
    sourceName: '备用源',
    sourceProfileName: '备用档案',
    ...overrides,
  };
}

function detail(overrides: Partial<VodDetail> = {}): VodDetail {
  return {
    id: 'alternate-id',
    name: '海风',
    pic: '',
    type: '剧情',
    year: '2024',
    area: '中国大陆',
    director: '',
    actor: '',
    des: '',
    remarks: '',
    flags: ['线路B'],
    episodes: { 线路B: [{ name: '第02集', url: 'alternate-episode-2' }] },
    ...overrides,
  };
}

function report(items: AggVodItem[], overrides: Partial<SearchAllReport> = {}): SearchAllReport {
  return {
    items,
    perSource: [],
    hitSources: items.length,
    failedSources: 0,
    totalRaw: items.length,
    ...overrides,
  };
}

function makePort(items: AggVodItem[], candidateDetail: VodDetail, searchReport = report(items)) {
  return {
    search: vi.fn(async () => searchReport),
    loadDetail: vi.fn(async ({ id }: { id: string }) => id === 'current-id' ? detail({ id: 'current-id' }) : candidateDetail),
  };
}

describe('discoverPlaybackAlternatives', () => {
  it('returns only an exact-title, exact-year, explicitly matching episode and preserves position', async () => {
    const port = makePort([searchItem()], detail());
    const result = await discoverPlaybackAlternatives({
      current,
      episodeIndex: 1,
      position: 137,
      excludedSourceIds: new Set([sourceIdentity('profile-current', 'current-source', 'current-id')]),
    }, port, new AbortController().signal);

    expect(port.search).toHaveBeenCalledWith('海风', expect.any(AbortSignal));
    expect(result).toMatchObject({ incompleteSources: 0, truncated: false, candidates: [{ sourceName: '备用源' }] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].data).toMatchObject({
      key: 'alternate-source',
      flag: '线路B',
      epIndex: 0,
      startTime: 137,
      deferHistoryUntilPlayback: true,
      meta: { profileId: 'profile-alternate', vodId: 'alternate-id' },
    });
  });

  it('rejects related titles, year conflicts, and ambiguous episode matches', async () => {
    const related = searchItem({ id: 'related', name: '海风演员访谈' });
    const wrongYear = searchItem({ id: 'wrong-year', year: '2023' });
    const ambiguous = searchItem({ id: 'ambiguous' });
    const port = makePort([related, wrongYear, ambiguous], detail({
      id: 'ambiguous',
      episodes: {
        线路B: [{ name: '第02集', url: 'episode-a' }],
        线路C: [{ name: 'S01E02', url: 'episode-b' }],
      },
    }));

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toEqual([]);
    expect(port.loadDetail).toHaveBeenCalledTimes(2); // Current item plus the one exact-title candidate.
  });

  it('counts failed and pending sources as incomplete, preventing automatic selection', async () => {
    const port = makePort([searchItem()], detail(), report([searchItem()], { failedSources: 2, pendingSources: 3 }));

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toHaveLength(1);
    expect(result.incompleteSources).toBe(5);
  });

  it('marks the result truncated when more exact source details exist than the verification budget', async () => {
    const items = Array.from({ length: 4 }, (_, index) => searchItem({
      id: `alternate-${index}`,
      sourceKey: `source-${index}`,
      sourceRef: { profileId: `profile-${index}`, key: `source-${index}` },
    }));
    const port = makePort(items, detail());

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});
