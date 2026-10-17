// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import { useDanmakuController } from '../src/renderer/features/playback/useDanmakuController';
import { orderCandidatesForEpisode, searchDanmakuCandidates } from '../src/renderer/features/playback/danmakuSearch';
import { DEFAULT_DANMAKU_SETTINGS, type DanmakuCandidate } from '../src/shared/danmaku';

vi.mock('../src/renderer/api/client', () => ({
  client: {
    danmakuGet: vi.fn(),
    danmakuSet: vi.fn(),
    danmakuFetch: vi.fn(),
  },
}));

vi.mock('../src/renderer/features/playback/danmakuSearch', () => ({
  orderCandidatesForEpisode: vi.fn(),
  searchDanmakuCandidates: vi.fn(),
}));

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const candidate: DanmakuCandidate = {
  episodeId: 12,
  title: 'Show',
  episodeTitle: 'Episode 1',
  episodeNumber: '1',
  source: 'https://danmaku.example',
  sourceName: 'Test source',
};

describe('useDanmakuController', () => {
  it('ignores search results from the previous URL', async () => {
    const search = deferred<DanmakuCandidate[]>();
    vi.mocked(client.danmakuGet).mockResolvedValue(
      { ...DEFAULT_DANMAKU_SETTINGS } as Awaited<ReturnType<typeof client.danmakuGet>>,
    );
    vi.mocked(client.danmakuSet).mockResolvedValue(
      {} as Awaited<ReturnType<typeof client.danmakuSet>>,
    );
    vi.mocked(searchDanmakuCandidates).mockReturnValue(search.promise);
    vi.mocked(orderCandidatesForEpisode).mockImplementation((candidates) => candidates);

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useDanmakuController({
        url,
        resourceName: 'Show Episode 1',
        danmakuTitle: 'Show',
        formatTime: (seconds) => String(seconds),
      }),
      { initialProps: { url: 'episode-1' } },
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.matchDanmaku('Show', '1');
    });
    expect(result.current.searching).toBe(true);

    rerender({ url: 'episode-2' });
    expect(result.current.searching).toBe(false);

    await act(async () => {
      search.resolve([candidate]);
      await pending;
    });

    expect(result.current.candidates).toEqual([]);
    expect(result.current.items).toEqual([]);
    expect(result.current.activeEpisodeId).toBeNull();
    expect(result.current.message).toBe('');
    expect(client.danmakuFetch).not.toHaveBeenCalled();
  });
});
