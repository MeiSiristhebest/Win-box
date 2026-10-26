// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAutoNextEpisode } from '../src/renderer/features/playback/useAutoNextEpisode';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useAutoNextEpisode', () => {
  it('advances immediately when configured and keeps the next action live', () => {
    const onNext = vi.fn();
    const latestNext = vi.fn();
    const { result, rerender } = renderHook(({ immediate, next }: { immediate: boolean; next: () => void }) => useAutoNextEpisode({
      canNext: true,
      immediate,
      onNext: next,
      isPaused: () => false,
      pause: vi.fn(),
    }), { initialProps: { immediate: true, next: onNext } });

    act(() => result.current.handlePlaybackEnd());
    expect(onNext).toHaveBeenCalledOnce();

    rerender({ immediate: true, next: latestNext });
    act(() => result.current.handleNext());
    expect(onNext).toHaveBeenCalledOnce();
    expect(latestNext).toHaveBeenCalledOnce();
  });

  it('counts down to the next episode and manual previous navigation cancels the pending advance', () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const { result } = renderHook(() => useAutoNextEpisode({
      canNext: true,
      onPrev,
      onNext,
      isPaused: () => false,
      pause: vi.fn(),
    }));

    act(() => result.current.handlePlaybackEnd());
    expect(result.current.nextCount).toBe(5);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.nextCount).toBe(3);
    act(() => result.current.handlePrev());
    expect(onPrev).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(5000));
    expect(onNext).not.toHaveBeenCalled();
    expect(result.current.nextCount).toBeNull();
  });

  it('cancels the countdown and pauses only if playback is not already paused', () => {
    vi.useFakeTimers();
    const onNext = vi.fn();
    const pause = vi.fn();
    const { result } = renderHook(() => useAutoNextEpisode({
      canNext: true,
      onNext,
      isPaused: () => false,
      pause,
    }));

    act(() => result.current.startCountdown());
    act(() => result.current.cancelCountdown());
    expect(result.current.nextCount).toBeNull();
    expect(pause).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(5000));
    expect(onNext).not.toHaveBeenCalled();
  });

  it('shows the terminal state when a resource has no following episode', () => {
    const { result } = renderHook(() => useAutoNextEpisode({
      canNext: false,
      isPaused: () => true,
      pause: vi.fn(),
    }));

    act(() => result.current.handlePlaybackEnd());
    expect(result.current).toMatchObject({ nextCount: null, endAll: true });
  });
});
