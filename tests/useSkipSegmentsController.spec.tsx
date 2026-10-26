// @vitest-environment happy-dom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSkipSegmentsController } from '../src/renderer/features/playback/useSkipSegmentsController';
import { skipSegmentsControllerAdapter } from '../src/renderer/features/playback/adapters/skipSegmentsControllerAdapter';
import type { SkipSegmentsControllerPorts } from '../src/renderer/features/playback/application/skipSegmentsControllerPorts';
import type { SkipStore } from '../src/renderer/features/playback/application/skipSegments';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useSkipSegmentsController', () => {
  it('uses replaceable memory, clock and scheduler ports without browser storage', () => {
    const state: { store: SkipStore; scheduled: Map<number, () => void>; cancelled: number[] } = {
      store: {},
      scheduled: new Map(),
      cancelled: [],
    };
    let nextTimerId = 0;
    const ports: SkipSegmentsControllerPorts = {
      memory: {
        read: () => state.store,
        save: (store) => { state.store = store; },
      },
      menuDismissal: { subscribe: () => () => undefined },
      scheduler: {
        schedule(callback) {
          const id = nextTimerId++;
          state.scheduled.set(id, callback);
          return id;
        },
        cancel(timer) {
          state.cancelled.push(timer as number);
          state.scheduled.delete(timer as number);
        },
      },
      clock: { now: () => 500 },
    };
    const { result, unmount } = renderHook(() => useSkipSegmentsController({
      resourceKey: 'source',
      episodeKey: 'episode-1',
      isLive: false,
    }, ports));

    act(() => result.current.commit(45, 20));
    expect(state.store['source|episode-1']).toMatchObject({ intro: 45, outro: 20, at: 500 });
    act(() => result.current.showToast('已保存'));
    expect(result.current.toast).toBe('已保存');
    expect(state.scheduled.size).toBe(1);
    unmount();
    expect(state.cancelled).toEqual([0]);
  });

  it('loads an episode record and inherits the latest resource record for another episode', () => {
    localStorage.setItem('winbox-skip-segments', JSON.stringify({
      'source|episode-1': { intro: 80, outro: 30, at: 100, from: '第1集' },
    }));

    const { result, rerender } = renderHook(
      ({ episodeKey }: { episodeKey: string }) => useSkipSegmentsController({
        resourceKey: 'source',
        episodeKey,
        isLive: false,
      }, skipSegmentsControllerAdapter),
      { initialProps: { episodeKey: 'episode-1' } },
    );

    expect(result.current.segments).toEqual({ intro: 80, outro: 30 });
    expect(result.current.inheritedFrom).toBeNull();

    rerender({ episodeKey: 'episode-2' });
    expect(result.current.segments).toEqual({ intro: 80, outro: 30 });
    expect(result.current.inheritedFrom).toBe('第1集');
    expect(result.current.playbackMarkers.wasIntroSkipHandled()).toBe(false);
    expect(result.current.playbackMarkers.wasOutroSkipHandled()).toBe(false);
  });

  it('persists edits and clears the fired flag only for a changed segment', () => {
    const { result } = renderHook(() => useSkipSegmentsController({
      resourceKey: 'source',
      episodeKey: 'episode-1',
      episodeLabel: '第1集',
      isLive: false,
    }, skipSegmentsControllerAdapter));

    act(() => {
      result.current.playbackMarkers.markIntroSkipHandled();
      result.current.playbackMarkers.markOutroSkipHandled();
      result.current.commit(90, 30);
    });
    expect(result.current.playbackMarkers.getSkipSegments()).toEqual({ intro: 90, outro: 30 });
    expect(result.current.playbackMarkers.wasIntroSkipHandled()).toBe(false);
    expect(result.current.playbackMarkers.wasOutroSkipHandled()).toBe(false);
    expect(skipSegmentsControllerAdapter.memory.read()['source|episode-1']).toMatchObject({ intro: 90, outro: 30, from: '第1集' });

    const staleWindowSnapshot = skipSegmentsControllerAdapter.memory.read();

    act(() => {
      result.current.playbackMarkers.markIntroSkipHandled();
      result.current.playbackMarkers.markOutroSkipHandled();
      result.current.commit(90, 45);
    });
    expect(result.current.playbackMarkers.wasIntroSkipHandled()).toBe(true);
    expect(result.current.playbackMarkers.wasOutroSkipHandled()).toBe(false);

    act(() => result.current.commit(0, 0));
    expect(result.current.segments).toEqual({ intro: 0, outro: 0 });
    expect(skipSegmentsControllerAdapter.memory.read()['source|episode-1']).toMatchObject({ intro: 0, outro: 0, cleared: true });

    skipSegmentsControllerAdapter.memory.save(staleWindowSnapshot);
    expect(skipSegmentsControllerAdapter.memory.read()['source|episode-1']).toMatchObject({ intro: 0, outro: 0, cleared: true });
  });

  it('owns context-menu segment commits and preserves the opposite segment', () => {
    const { result } = renderHook(() => useSkipSegmentsController({
      resourceKey: 'source',
      episodeKey: 'episode-1',
      isLive: false,
    }, skipSegmentsControllerAdapter));

    act(() => result.current.commit(15, 30));
    act(() => result.current.setMenu({ x: 10, y: 20, t: 42 }));
    let capturedIntro: number | undefined;
    act(() => { capturedIntro = result.current.captureIntroFromMenu(); });
    expect(capturedIntro).toBe(42);
    expect(result.current.menu).toBeNull();
    expect(result.current.segments).toEqual({ intro: 42, outro: 30 });

    act(() => result.current.setMenu({ x: 10, y: 20, t: 95 }));
    let capturedOutro: number | undefined;
    act(() => { capturedOutro = result.current.captureOutroFromMenu(125); });
    expect(capturedOutro).toBe(30);
    expect(result.current.menu).toBeNull();
    expect(result.current.segments).toEqual({ intro: 42, outro: 30 });

    act(() => result.current.setMenu({ x: 10, y: 20, t: 100 }));
    act(() => result.current.clearFromMenu());
    expect(result.current.menu).toBeNull();
    expect(result.current.segments).toEqual({ intro: 0, outro: 0 });
  });

  it('keeps the position menu open for a modal Escape and closes it after the modal closes', () => {
    const { result } = renderHook(() => useSkipSegmentsController({ isLive: false }, skipSegmentsControllerAdapter));
    act(() => result.current.setMenu({ x: 10, y: 20, t: 30 }));
    expect(result.current.menu).not.toBeNull();

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(result.current.menu).not.toBeNull();

    dialog.remove();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(result.current.menu).toBeNull();
  });
});
