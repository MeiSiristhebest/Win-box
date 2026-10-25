// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDanmakuController } from '../src/renderer/features/playback/useDanmakuController';
import type { DanmakuControllerPorts } from '../src/renderer/features/playback/application/danmakuControllerPorts';
import { DEFAULT_DANMAKU_SETTINGS, type DanmakuCandidate } from '../src/shared/danmaku';

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
    const ports: DanmakuControllerPorts = {
      loadSettings: vi.fn().mockResolvedValue({ ...DEFAULT_DANMAKU_SETTINGS }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      fetchEpisode: vi.fn().mockResolvedValue(''),
      searchCandidates: vi.fn().mockReturnValue(search.promise),
    };

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useDanmakuController({
        url,
        resourceName: 'Show Episode 1',
        danmakuTitle: 'Show',
        formatTime: (seconds) => String(seconds),
        formatCandidateLabel: (candidate) => candidate.title || '',
        ports,
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
    expect(ports.fetchEpisode).not.toHaveBeenCalled();
    expect(ports.searchCandidates).toHaveBeenCalledWith('Show', undefined, '1', false);
  });

  it('automatically matches danmaku when autoMatch is enabled', async () => {
    const search = deferred<DanmakuCandidate[]>();
    const ports: DanmakuControllerPorts = {
      loadSettings: vi.fn().mockResolvedValue({ ...DEFAULT_DANMAKU_SETTINGS, enabled: true }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      fetchEpisode: vi.fn().mockResolvedValue('<?xml version="1.0" encoding="utf-8"?><danmaku><d p="1.0,1,25,16777215,0,0,0,0">Test comment</d></danmaku>'),
      searchCandidates: vi.fn().mockReturnValue(search.promise),
    };

    const { result } = renderHook(
      () => useDanmakuController({
        url: 'episode-auto-1',
        resourceName: 'Anime Title E01',
        danmakuTitle: 'Anime Title',
        autoMatch: true,
        formatTime: (seconds) => String(seconds),
        formatCandidateLabel: (candidate) => candidate.title || '',
        ports,
      }),
    );

    // Initial render loads settings with enabled=true
    await act(async () => {
      // allow settings promise to resolve
    });

    expect(ports.searchCandidates).toHaveBeenCalledWith('Anime Title', undefined, '1', false);
    expect(result.current.searching).toBe(true);

    await act(async () => {
      search.resolve([candidate]);
    });

    expect(result.current.searching).toBe(false);
    expect(result.current.activeEpisodeId).toBe(12);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].text).toBe('Test comment');
  });
});
