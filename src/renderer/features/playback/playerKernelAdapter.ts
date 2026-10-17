import type { MpvCommand, MpvKernelState } from '../../../shared/player';
import type { Kernel } from '../../lib/kernel';

interface HtmlVideoPort {
  currentTime: number;
  duration: number;
  paused: boolean;
  volume: number;
  playbackRate: number;
  play(): Promise<unknown>;
  pause(): void;
}

export interface PlayerKernelAdapterOptions {
  getKernel: () => Kernel;
  getVideo: () => HtmlVideoPort | null;
  getMpvState: () => Pick<MpvKernelState, 'time' | 'duration' | 'paused'>;
  sendMpvCommand: (command: MpvCommand) => Promise<unknown>;
  setCurrentTime: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  volumeRef: { current: number };
}

export function createPlayerKernelAdapter(options: PlayerKernelAdapterOptions) {
  const isMpv = () => options.getKernel() === 'mpv';

  return {
    isMpv,
    getTime: () => (isMpv() ? options.getMpvState().time ?? 0 : options.getVideo()?.currentTime ?? 0),
    getDuration: () => {
      if (isMpv()) return options.getMpvState().duration ?? 0;

      const duration = options.getVideo()?.duration;
      return duration != null && Number.isFinite(duration) ? duration : 0;
    },
    isPaused: () => (isMpv() ? options.getMpvState().paused : !!options.getVideo()?.paused),
    play: () => {
      if (isMpv()) void options.sendMpvCommand({ type: 'play' }).catch(() => undefined);
      else void options.getVideo()?.play().catch(() => undefined);
    },
    pause: () => {
      if (isMpv()) {
        void options.sendMpvCommand({ type: 'pause' }).catch(() => undefined);
        return;
      }

      try {
        options.getVideo()?.pause();
      } catch {
        /* ignore */
      }
    },
    seek: (seconds: number) => {
      const target = Math.max(0, seconds);
      if (isMpv()) void options.sendMpvCommand({ type: 'seek', value: target }).catch(() => undefined);
      else {
        const video = options.getVideo();
        if (video) {
          try {
            video.currentTime = target;
          } catch {
            /* ignore */
          }
        }
      }
      options.setCurrentTime(target);
    },
    setVolume: (volume: number) => {
      const target = Math.max(0, Math.min(1, volume));
      if (isMpv()) void options.sendMpvCommand({ type: 'volume', value: target }).catch(() => undefined);
      else {
        const video = options.getVideo();
        if (video) video.volume = target;
      }
      options.setVolume(target);
      options.volumeRef.current = target;
    },
    setTemporaryRate: (rate: number) => {
      if (isMpv()) void options.sendMpvCommand({ type: 'rate', value: rate }).catch(() => undefined);
      else { const video = options.getVideo(); if (video) video.playbackRate = rate; }
    },
    setRate: (rate: number) => {
      if (isMpv()) void options.sendMpvCommand({ type: 'rate', value: rate }).catch(() => undefined);
      else {
        const video = options.getVideo();
        if (video) video.playbackRate = rate;
      }
      options.setRate(rate);
    },
  };
}
