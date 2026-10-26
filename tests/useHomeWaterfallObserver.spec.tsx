// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHomeWaterfallObserver } from '../src/renderer/features/home/useHomeWaterfallObserver';
import type { HomeWaterfallObserverPort } from '../src/renderer/features/home/application/homeWaterfallObserverPort';

describe('useHomeWaterfallObserver', () => {
  it('observes an active sentinel, calls the latest page action, and disconnects on refresh and unmount', () => {
    const rootRef = { current: {} as HTMLDivElement };
    const targetRef = { current: {} as HTMLDivElement };
    const stop = vi.fn();
    let onVisible: (() => void) | undefined;
    const observer: HomeWaterfallObserverPort = {
      observe: vi.fn((_root, _target, callback) => {
        onVisible = callback;
        return stop;
      }),
    };
    const firstAction = vi.fn();
    const latestAction = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ refreshKey, action }) => useHomeWaterfallObserver({
        active: true,
        refreshKey,
        rootRef,
        targetRef,
        onVisible: action,
        observer,
      }),
      { initialProps: { refreshKey: 'page-1', action: firstAction } },
    );

    expect(observer.observe).toHaveBeenCalledOnce();
    act(() => onVisible?.());
    expect(firstAction).toHaveBeenCalledOnce();

    rerender({ refreshKey: 'page-2', action: latestAction });
    expect(stop).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledTimes(2);
    act(() => onVisible?.());
    expect(latestAction).toHaveBeenCalledOnce();

    unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('does not create an observer while waterfall loading is inactive', () => {
    const observer: HomeWaterfallObserverPort = { observe: vi.fn(() => () => undefined) };
    renderHook(() => useHomeWaterfallObserver({
      active: false,
      refreshKey: 'page-1',
      rootRef: { current: {} as HTMLDivElement },
      targetRef: { current: {} as HTMLDivElement },
      onVisible: vi.fn(),
      observer,
    }));

    expect(observer.observe).not.toHaveBeenCalled();
  });
});
