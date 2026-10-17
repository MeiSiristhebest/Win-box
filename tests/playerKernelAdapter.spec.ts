import { describe, expect, it, vi } from 'vitest';
import { createPlayerKernelAdapter } from '../src/renderer/features/playback/playerKernelAdapter';
import type { MpvCommand, MpvKernelState } from '../src/shared/player';
import type { Kernel } from '../src/renderer/lib/kernel';

function createVideo() {
  return {
    currentTime: 12,
    duration: 30,
    paused: true,
    volume: 0.4,
    playbackRate: 1,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  };
}

function createAdapter(kernel: () => Kernel, video: ReturnType<typeof createVideo> | null) {
  const state: Pick<MpvKernelState, 'time' | 'duration' | 'paused'> = {
    time: 8,
    duration: 120,
    paused: false,
  };
  const sendMpvCommand = vi.fn(async (_command: MpvCommand) => undefined);
  const setCurrentTime = vi.fn();
  const setVolume = vi.fn();
  const setRate = vi.fn();
  const volumeRef = { current: 0.4 };

  return {
    adapter: createPlayerKernelAdapter({
      getKernel: kernel,
      getVideo: () => video,
      getMpvState: () => state,
      sendMpvCommand,
      setCurrentTime,
      setVolume,
      setRate,
      volumeRef,
    }),
    state,
    sendMpvCommand,
    setCurrentTime,
    setVolume,
    setRate,
    volumeRef,
  };
}

describe('player kernel adapter', () => {
  it('reads and controls the HTML video element', () => {
    const video = createVideo();
    const context = createAdapter(() => 'html5', video);

    expect(context.adapter.isMpv()).toBe(false);
    expect(context.adapter.getTime()).toBe(12);
    expect(context.adapter.getDuration()).toBe(30);
    expect(context.adapter.isPaused()).toBe(true);

    context.adapter.play();
    context.adapter.pause();
    context.adapter.seek(-2);
    context.adapter.setVolume(1.5);
    context.adapter.setRate(1.5);

    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
    expect(video.volume).toBe(1);
    expect(video.playbackRate).toBe(1.5);
    expect(context.setCurrentTime).toHaveBeenCalledWith(0);
    expect(context.setVolume).toHaveBeenCalledWith(1);
    expect(context.setRate).toHaveBeenCalledWith(1.5);
    expect(context.volumeRef.current).toBe(1);
    expect(context.sendMpvCommand).not.toHaveBeenCalled();
  });

  it('reads and controls the mpv session', () => {
    const context = createAdapter(() => 'mpv', null);

    expect(context.adapter.isMpv()).toBe(true);
    expect(context.adapter.getTime()).toBe(8);
    expect(context.adapter.getDuration()).toBe(120);
    expect(context.adapter.isPaused()).toBe(false);

    context.adapter.play();
    context.adapter.pause();
    context.adapter.seek(15);
    context.adapter.setVolume(-1);
    context.adapter.setRate(2);

    expect(context.sendMpvCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: 'play' },
      { type: 'pause' },
      { type: 'seek', value: 15 },
      { type: 'volume', value: 0 },
      { type: 'rate', value: 2 },
    ]);
    expect(context.setCurrentTime).toHaveBeenCalledWith(15);
    expect(context.setVolume).toHaveBeenCalledWith(0);
    expect(context.setRate).toHaveBeenCalledWith(2);
    expect(context.volumeRef.current).toBe(0);
  });

  it('keeps the HTML5 no-element state compatible with the previous adapter', () => {
    const context = createAdapter(() => 'html5', null);
    expect(context.adapter.isPaused()).toBe(false);
  });

  it('uses current kernel and media state after the adapter is created', () => {
    let kernel: Kernel = 'html5';
    const video = createVideo();
    const context = createAdapter(() => kernel, video);

    expect(context.adapter.getTime()).toBe(12);
    kernel = 'mpv';
    context.state.time = 42;
    expect(context.adapter.getTime()).toBe(42);
  });
});
