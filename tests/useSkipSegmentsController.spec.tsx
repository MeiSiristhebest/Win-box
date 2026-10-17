// @vitest-environment happy-dom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSkipStore, persistSkipStore } from '../src/renderer/lib/skipSegments';
import { useSkipSegmentsController } from '../src/renderer/features/playback/useSkipSegmentsController';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('useSkipSegmentsController', () => {
  it('loads an episode record and inherits the latest resource record for another episode', () => {
    localStorage.setItem('winbox-skip-segments', JSON.stringify({
      'source|episode-1': { intro: 80, outro: 30, at: 100, from: '第1集' },
    }));

    const { result, rerender } = renderHook(
      ({ episodeKey }: { episodeKey: string }) => useSkipSegmentsController({
        resourceKey: 'source',
        episodeKey,
        isLive: false,
      }),
      { initialProps: { episodeKey: 'episode-1' } },
    );

    expect(result.current.segments).toEqual({ intro: 80, outro: 30 });
    expect(result.current.inheritedFrom).toBeNull();

    rerender({ episodeKey: 'episode-2' });
    expect(result.current.segments).toEqual({ intro: 80, outro: 30 });
    expect(result.current.inheritedFrom).toBe('第1集');
    expect(result.current.introFiredRef.current).toBe(false);
    expect(result.current.outroFiredRef.current).toBe(false);
  });

  it('persists edits and clears the fired flag only for a changed segment', () => {
    const { result } = renderHook(() => useSkipSegmentsController({
      resourceKey: 'source',
      episodeKey: 'episode-1',
      episodeLabel: '第1集',
      isLive: false,
    }));

    act(() => {
      result.current.introFiredRef.current = true;
      result.current.outroFiredRef.current = true;
      result.current.commit(90, 30);
    });
    expect(result.current.segmentsRef.current).toEqual({ intro: 90, outro: 30 });
    expect(result.current.introFiredRef.current).toBe(false);
    expect(result.current.outroFiredRef.current).toBe(false);
    expect(loadSkipStore()['source|episode-1']).toMatchObject({ intro: 90, outro: 30, from: '第1集' });

    const staleWindowSnapshot = loadSkipStore();

    act(() => {
      result.current.introFiredRef.current = true;
      result.current.outroFiredRef.current = true;
      result.current.commit(90, 45);
    });
    expect(result.current.introFiredRef.current).toBe(true);
    expect(result.current.outroFiredRef.current).toBe(false);

    act(() => result.current.commit(0, 0));
    expect(result.current.segments).toEqual({ intro: 0, outro: 0 });
    expect(loadSkipStore()['source|episode-1']).toMatchObject({ intro: 0, outro: 0, cleared: true });

    persistSkipStore(staleWindowSnapshot);
    expect(loadSkipStore()['source|episode-1']).toMatchObject({ intro: 0, outro: 0, cleared: true });
  });

  it('keeps the position menu open for a modal Escape and closes it after the modal closes', () => {
    const { result } = renderHook(() => useSkipSegmentsController({ isLive: false }));
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
