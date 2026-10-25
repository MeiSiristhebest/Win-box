// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlayerHistoryProgressPort,
  PlayerHistoryProgressSnapshot,
} from '../src/renderer/features/playback/application/playerHistoryProgress';
import { usePlayerHistoryProgress } from '../src/renderer/features/playback/usePlayerHistoryProgress';

function progressSnapshot(overrides: Partial<PlayerHistoryProgressSnapshot> = {}): PlayerHistoryProgressSnapshot {
  return {
    rawUrl: 'episode-1',
    playbackUrl: 'https://media.invalid/episode-1.m3u8',
    name: 'Show - Episode 1',
    flag: 'source-line',
    sourceName: 'Source A',
    sourceKey: 'source-a',
    profileId: 'profile-a',
    vodId: 'vod-a',
    episodeName: 'Episode 1',
    ...overrides,
  };
}

function historyPort(): PlayerHistoryProgressPort {
  return {
    getPlaybackPosition: vi.fn((url) => url.includes('episode-2') ? 42 : 12),
    recordHistory: vi.fn(),
    persist: vi.fn(),
  };
}

describe('usePlayerHistoryProgress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('periodically checkpoints the latest episode and profile after a source switch', () => {
    const port = historyPort();
    const first = progressSnapshot();
    const second = progressSnapshot({
      rawUrl: 'episode-2',
      playbackUrl: 'https://media.invalid/episode-2.m3u8',
      name: 'Other Show - Episode 2',
      sourceName: 'Source B',
      sourceKey: 'source-b',
      profileId: 'profile-b',
      vodId: 'vod-b',
      episodeName: 'Episode 2',
    });

    const { rerender, unmount } = renderHook(
      ({ snapshot }: { snapshot: PlayerHistoryProgressSnapshot }) => usePlayerHistoryProgress(snapshot, port),
      { initialProps: { snapshot: first } },
    );

    act(() => vi.advanceTimersByTime(5000));
    rerender({ snapshot: second });
    act(() => vi.advanceTimersByTime(5000));

    expect(port.getPlaybackPosition).toHaveBeenNthCalledWith(1, first.playbackUrl, {
      profileId: first.profileId,
      key: first.sourceKey,
    });
    expect(port.getPlaybackPosition).toHaveBeenLastCalledWith(second.playbackUrl, {
      profileId: second.profileId,
      key: second.sourceKey,
    });
    expect(port.recordHistory).toHaveBeenLastCalledWith(expect.objectContaining({
      url: second.rawUrl,
      profileId: second.profileId,
      sourceKey: second.sourceKey,
      vodId: second.vodId,
      remarks: second.episodeName,
      time: 42,
    }));
    expect(port.persist).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('writes one final checkpoint for the current session when unmounted', () => {
    const port = historyPort();
    const snapshot = progressSnapshot();
    const { unmount } = renderHook(() => usePlayerHistoryProgress(snapshot, port));

    expect(port.recordHistory).not.toHaveBeenCalled();
    unmount();

    expect(port.recordHistory).toHaveBeenCalledOnce();
    expect(port.recordHistory).toHaveBeenCalledWith(expect.objectContaining({
      url: snapshot.rawUrl,
      profileId: snapshot.profileId,
      sourceKey: snapshot.sourceKey,
      time: 12,
    }));
    expect(port.persist).toHaveBeenCalledOnce();
  });
});
