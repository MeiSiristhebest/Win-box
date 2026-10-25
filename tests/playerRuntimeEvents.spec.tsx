// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BossKeyPlaybackPort } from '../src/renderer/features/playback/application/bossKeyPlaybackSession';
import type { BossKeyPlaybackEventsPort, RelaySpeedEventsPort } from '../src/renderer/features/playback/application/playerRuntimeEventsPorts';
import { useBossKeyPlaybackEvents } from '../src/renderer/features/playback/useBossKeyPlaybackEvents';
import { useRelaySpeedSubscription } from '../src/renderer/features/playback/useRelaySpeedSubscription';

afterEach(cleanup);

describe('player runtime event subscriptions', () => {
  it('keeps the boss-key snapshot across playback state renders and releases both subscriptions', () => {
    let onEnter: (() => void) | undefined;
    let onExit: (() => void) | undefined;
    const unsubscribeEnter = vi.fn();
    const unsubscribeExit = vi.fn();
    const events: BossKeyPlaybackEventsPort = {
      subscribeEnter: (listener) => { onEnter = listener; return unsubscribeEnter; },
      subscribeExit: (listener) => { onExit = listener; return unsubscribeExit; },
    };
    const firstCalls: string[] = [];
    const firstPlayback: BossKeyPlaybackPort = {
      hasPlaybackSurface: () => true,
      isPaused: () => false,
      volume: () => 0.64,
      setActive: (active) => firstCalls.push(`active:${active}`),
      pause: () => firstCalls.push('pause'),
      play: () => firstCalls.push('play'),
      setVolume: (volume) => firstCalls.push(`volume:${volume}`),
      publishPaused: (paused) => firstCalls.push(`paused:${paused}`),
    };
    const { rerender, unmount } = renderHook(
      ({ playback }) => useBossKeyPlaybackEvents(events, playback),
      { initialProps: { playback: firstPlayback } },
    );

    act(() => onEnter?.());
    expect(firstCalls).toEqual(['active:true', 'pause', 'volume:0', 'paused:true']);

    const latestCalls: string[] = [];
    const latestPlayback: BossKeyPlaybackPort = {
      ...firstPlayback,
      isPaused: () => true,
      volume: () => 0,
      setActive: (active) => latestCalls.push(`active:${active}`),
      pause: () => latestCalls.push('pause'),
      play: () => latestCalls.push('play'),
      setVolume: (volume) => latestCalls.push(`volume:${volume}`),
      publishPaused: (paused) => latestCalls.push(`paused:${paused}`),
    };
    rerender({ playback: latestPlayback });
    act(() => onExit?.());

    expect(latestCalls).toEqual(['active:false', 'volume:0.64', 'play', 'paused:false']);
    unmount();
    expect(unsubscribeEnter).toHaveBeenCalledOnce();
    expect(unsubscribeExit).toHaveBeenCalledOnce();
  });

  it('uses the latest speed observer without resubscribing and unsubscribes on unmount', () => {
    let onSpeed: ((speed: number) => void) | undefined;
    const unsubscribe = vi.fn();
    const events: RelaySpeedEventsPort = {
      subscribe: (listener) => { onSpeed = listener; return unsubscribe; },
    };
    const firstObserver = vi.fn();
    const latestObserver = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ observer }) => useRelaySpeedSubscription(events, observer),
      { initialProps: { observer: firstObserver } },
    );

    rerender({ observer: latestObserver });
    act(() => onSpeed?.(512));

    expect(firstObserver).not.toHaveBeenCalled();
    expect(latestObserver).toHaveBeenCalledWith(512);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('releases the enter subscription if exit subscription setup fails', () => {
    const unsubscribeEnter = vi.fn();
    const events: BossKeyPlaybackEventsPort = {
      subscribeEnter: () => unsubscribeEnter,
      subscribeExit: () => { throw new Error('subscription unavailable'); },
    };
    const playback: BossKeyPlaybackPort = {
      hasPlaybackSurface: () => true,
      isPaused: () => false,
      volume: () => 1,
      setActive: () => {},
      pause: () => {},
      play: () => {},
      setVolume: () => {},
      publishPaused: () => {},
    };

    expect(() => renderHook(() => useBossKeyPlaybackEvents(events, playback))).toThrow('subscription unavailable');
    expect(unsubscribeEnter).toHaveBeenCalledOnce();
  });
});
