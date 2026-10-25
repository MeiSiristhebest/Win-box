import { describe, expect, it, vi } from 'vitest';
import type { DanmakuAnime, DanmakuCandidate } from '../src/shared/danmaku';
import { createDanmakuSearchWorkflow, type DanmakuSearchPorts } from '../src/renderer/features/playback/application/danmakuSearchWorkflow';

const firstAnime: DanmakuAnime = {
  animeId: 11,
  bangumiId: 11,
  title: 'Show',
  source: 'source-one',
  sourceName: 'First source',
};

const secondAnime: DanmakuAnime = {
  animeId: 22,
  bangumiId: 22,
  title: 'Show',
  source: 'source-two',
  sourceName: 'Second source',
};

function episode(episodeId: number, source: string, sourceName: string, episodeNumber: string): DanmakuCandidate {
  return { episodeId, source, sourceName, title: 'Show', episodeTitle: episodeNumber, episodeNumber };
}

function createPorts(overrides: Partial<DanmakuSearchPorts> = {}): DanmakuSearchPorts {
  return {
    searchAnime: vi.fn().mockResolvedValue([]),
    expandAnime: vi.fn().mockResolvedValue([]),
    loadMemory: vi.fn().mockReturnValue({}),
    saveMemory: vi.fn(),
    now: () => 123,
    ...overrides,
  };
}

describe('createDanmakuSearchWorkflow', () => {
  it('uses cached anime metadata before starting a new search', async () => {
    const cachedEpisode = episode(101, 'cached-source', 'Cached source', '2');
    const ports = createPorts({
      loadMemory: vi.fn().mockReturnValue({
        Show: { source: 'cached-source', sourceName: 'Cached source', anime: 'Show', bangumiId: 10 },
      }),
      expandAnime: vi.fn().mockResolvedValue([cachedEpisode]),
    });

    const candidates = await createDanmakuSearchWorkflow(ports)('Show', undefined, '2', false);

    expect(candidates).toEqual([cachedEpisode]);
    expect(ports.searchAnime).not.toHaveBeenCalled();
    expect(ports.expandAnime).toHaveBeenCalledWith({
      animeId: 10,
      bangumiId: 10,
      title: 'Show',
      source: 'cached-source',
      sourceName: 'Cached source',
    });
  });

  it('keeps candidate results from every source and remembers the group matching the requested episode', async () => {
    const firstEpisode = episode(201, 'source-one', 'First source', '1');
    const secondEpisode = episode(202, 'source-two', 'Second source', '2');
    const saveMemory = vi.fn();
    const ports = createPorts({
      searchAnime: vi.fn().mockResolvedValue([firstAnime, secondAnime]),
      expandAnime: vi.fn(async (anime) => anime.source === 'source-one' ? [firstEpisode] : [secondEpisode]),
      saveMemory,
    });

    const candidates = await createDanmakuSearchWorkflow(ports)('Show', 2, '2', true);

    expect(candidates).toEqual([firstEpisode, secondEpisode]);
    expect(saveMemory).toHaveBeenCalledWith({
      Show: {
        source: 'source-two',
        sourceName: 'Second source',
        anime: 'Show',
        bangumiId: 22,
        at: 123,
      },
    });
  });

  it('continues returning candidates if optional search-memory persistence fails', async () => {
    const foundEpisode = episode(301, 'source-one', 'First source', '1');
    const ports = createPorts({
      searchAnime: vi.fn().mockResolvedValue([firstAnime]),
      expandAnime: vi.fn().mockResolvedValue([foundEpisode]),
      saveMemory: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });

    await expect(createDanmakuSearchWorkflow(ports)('Show', undefined, '1', true)).resolves.toEqual([foundEpisode]);
  });
});
