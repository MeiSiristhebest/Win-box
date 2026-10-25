import { describe, expect, it } from 'vitest';
import { emptyMpvKernelState } from '../src/shared/player';
import { projectMpvPlaybackEvent } from '../src/renderer/features/playback/application/mpvPlaybackEventModel';

describe('projectMpvPlaybackEvent', () => {
  it('projects playback, cache, resolution and position effects from one engine snapshot', () => {
    const plan = projectMpvPlaybackEvent({
      ...emptyMpvKernelState(),
      time: 32,
      duration: 90,
      paused: false,
      buffering: true,
      live: true,
      loaded: true,
      cacheTime: 40,
      cacheKbps: 512,
      videoW: 1920,
      videoH: 1080,
    }, 'MPV 内核', false);

    expect(plan.presentation).toEqual({
      isLive: true,
      duration: 90,
      paused: false,
      buffering: true,
      loading: false,
      currentTime: 32,
      buffered: 40,
      netSpeed: 512,
    });
    expect(plan.currentTime).toBe(32);
    expect(plan.resolution).toEqual({ width: 1920, height: 1080 });
    expect(plan.size).toEqual({ w: 1920, h: 1080 });
    expect(plan.savePosition).toBe(32);
    expect(plan.skipAt).toEqual({ time: 32, duration: 90 });
  });

  it('does not clear prior buffer or speed indicators when the engine omits those values', () => {
    const plan = projectMpvPlaybackEvent({
      ...emptyMpvKernelState(),
      cacheTime: null,
      cacheKbps: 0,
      time: null,
    }, 'MPV 内核', false);

    expect(plan.presentation).not.toHaveProperty('buffered');
    expect(plan.presentation).not.toHaveProperty('netSpeed');
    expect(plan.savePosition).toBeNull();
    expect(plan.skipAt).toBeNull();
  });

  it('turns an EOF before the first decoded frame into a parse error exactly once', () => {
    const state = { ...emptyMpvKernelState(), eof: true, playbackStarted: false };
    const first = projectMpvPlaybackEvent(state, '插件内核', false);
    const repeated = projectMpvPlaybackEvent(state, '插件内核', first.nextEofHandled);

    expect(first.terminalPresentation?.mpvError).toContain('分片读取失败');
    expect(first.terminalPresentation?.loading).toBe(false);
    expect(first.nextEofHandled).toBe(true);
    expect(first.advanceAfterEnd).toBe(false);
    expect(repeated.terminalPresentation).toBeUndefined();
    expect(repeated.nextEofHandled).toBe(true);
  });

  it('advances once for a normal EOF and gives an exited engine the final status', () => {
    const ended = projectMpvPlaybackEvent({
      ...emptyMpvKernelState(),
      eof: true,
      playbackStarted: true,
    }, '插件内核', false);
    const repeatedEnd = projectMpvPlaybackEvent({
      ...emptyMpvKernelState(),
      eof: true,
      playbackStarted: true,
    }, '插件内核', ended.nextEofHandled);
    const exited = projectMpvPlaybackEvent({
      ...emptyMpvKernelState(),
      exited: true,
      error: 'decode failed',
    }, '插件内核', false);

    expect(ended.advanceAfterEnd).toBe(true);
    expect(repeatedEnd.advanceAfterEnd).toBe(false);
    expect(exited.terminalPresentation?.mpvError).toContain('插件内核进程已退出');
    expect(exited.clearAutoAdvance).toBe(true);
  });
});
