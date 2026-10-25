// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioPlayerModel } from '../src/renderer/features/playback/presentation/AudioPlayerModel';
import { AudioPlayerView } from '../src/renderer/features/playback/AudioPlayerView';

function makeModel(duration = 125): { model: AudioPlayerModel; seekTo: ReturnType<typeof vi.fn> } {
  const seekTo = vi.fn();
  return {
    seekTo,
    model: {
      media: { url: 'https://media.example/track.mp3', name: 'Track', mini: false },
      playback: {
        paused: true,
        currentTime: 12,
        duration,
        volume: 0.75,
        loop: false,
        error: '',
        loading: false,
        progressPercent: duration > 0 ? (12 / duration) * 100 : 0,
        currentTimeLabel: '0:12',
        durationLabel: duration > 0 ? '2:05' : '0:00',
      },
      actions: {
        attachAudioElement: vi.fn(),
        togglePlayback: vi.fn(),
        toggleLoop: vi.fn(),
        setVolume: vi.fn(),
        seekTo,
        onLoadedMetadata: vi.fn(),
        onCanPlay: vi.fn(),
        onTimeUpdate: vi.fn(),
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onWaiting: vi.fn(),
        onPlaying: vi.fn(),
        onError: vi.fn(),
        onEnded: vi.fn(),
      },
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AudioPlayerView', () => {
  it('uses native range controls and forwards progress changes as seek actions', () => {
    const { model, seekTo } = makeModel();
    render(<AudioPlayerView model={model} />);

    const progress = screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement;
    const volume = screen.getByRole('slider', { name: '音量' }) as HTMLInputElement;
    expect(progress.type).toBe('range');
    expect(progress.min).toBe('0');
    expect(progress.max).toBe('125');
    expect(progress.step).toBe('5');
    expect(progress.value).toBe('12');
    expect(volume.type).toBe('range');

    fireEvent.change(progress, { target: { value: '35' } });
    expect(seekTo).toHaveBeenCalledWith(35);
  });

  it('keeps the progress control disabled until media metadata provides a duration', () => {
    const { model } = makeModel(0);
    render(<AudioPlayerView model={model} />);

    expect((screen.getByRole('slider', { name: '播放进度' }) as HTMLInputElement).disabled).toBe(true);
  });
});
