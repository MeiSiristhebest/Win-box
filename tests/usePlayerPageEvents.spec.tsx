// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerInitData, PlayerPageEventsPort } from '../src/renderer/features/playback/application/playerPageSession';
import { usePlayerPageEvents } from '../src/renderer/features/playback/usePlayerPageEvents';

function createEventsPort() {
  let initListener: ((data: PlayerInitData) => void) | undefined;
  let episodeSwitchListener: ((index: number) => void) | undefined;
  const unsubscribeInit = vi.fn(() => { initListener = undefined; });
  const unsubscribeEpisodeSwitch = vi.fn(() => { episodeSwitchListener = undefined; });
  const onInit = vi.fn((listener: (data: PlayerInitData) => void) => {
    initListener = listener;
    return unsubscribeInit;
  });
  const onEpisodeSwitch = vi.fn((listener: (index: number) => void) => {
    episodeSwitchListener = listener;
    return unsubscribeEpisodeSwitch;
  });
  const port: PlayerPageEventsPort = {
    onInit,
    onEpisodeSwitch,
    ready: vi.fn(async () => undefined),
  };

  return {
    port,
    onInit,
    onEpisodeSwitch,
    emitInit(data: PlayerInitData) { initListener?.(data); },
    emitEpisodeSwitch(index: number) { episodeSwitchListener?.(index); },
    unsubscribeInit,
    unsubscribeEpisodeSwitch,
  };
}

function initData(initSeq?: number): PlayerInitData {
  return {
    key: 'source-a',
    flag: 'line-a',
    episodes: [{ name: '第01集', url: 'episode-1' }],
    epIndex: 0,
    title: '测试影片',
    lastUrl: '',
    lastName: '',
    initSeq,
  };
}

describe('usePlayerPageEvents', () => {
  it('ignores duplicate and late sequenced init messages', () => {
    const events = createEventsPort();
    const applyInit = vi.fn();
    const selectEpisode = vi.fn();

    renderHook(() => usePlayerPageEvents(events.port, { applyInit, selectEpisode }));
    act(() => {
      events.emitInit(initData(4));
      events.emitInit(initData(3));
      events.emitInit(initData(4));
      events.emitInit(initData(5));
    });

    expect(applyInit.mock.calls.map(([data]) => data.initSeq)).toEqual([4, 5]);
  });

  it('dispatches events to the latest handlers without resubscribing', () => {
    const events = createEventsPort();
    const firstHandlers = { applyInit: vi.fn(), selectEpisode: vi.fn() };
    const latestHandlers = { applyInit: vi.fn(), selectEpisode: vi.fn() };
    const { rerender } = renderHook(
      ({ handlers }) => usePlayerPageEvents(events.port, handlers),
      { initialProps: { handlers: firstHandlers } },
    );

    rerender({ handlers: latestHandlers });
    act(() => {
      events.emitInit(initData(1));
      events.emitEpisodeSwitch(2);
    });

    expect(firstHandlers.applyInit).not.toHaveBeenCalled();
    expect(firstHandlers.selectEpisode).not.toHaveBeenCalled();
    expect(latestHandlers.applyInit).toHaveBeenCalledWith(initData(1));
    expect(latestHandlers.selectEpisode).toHaveBeenCalledWith(2);
    expect(events.onInit).toHaveBeenCalledOnce();
    expect(events.onEpisodeSwitch).toHaveBeenCalledOnce();
  });

  it('unsubscribes both window event listeners when the player session unmounts', () => {
    const events = createEventsPort();
    const { unmount } = renderHook(() => usePlayerPageEvents(events.port, {
      applyInit: vi.fn(),
      selectEpisode: vi.fn(),
    }));

    unmount();

    expect(events.unsubscribeInit).toHaveBeenCalledOnce();
    expect(events.unsubscribeEpisodeSwitch).toHaveBeenCalledOnce();
    act(() => {
      events.emitInit(initData(1));
      events.emitEpisodeSwitch(2);
    });
  });
});
