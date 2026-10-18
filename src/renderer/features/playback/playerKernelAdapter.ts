import type { MpvCommand, MpvKernelState } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';

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
  sendEngineCommand?: (command: MpvCommand) => Promise<unknown>;
  setCurrentTime: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  volumeRef: { current: number };
}

export function createPlayerKernelAdapter(options: PlayerKernelAdapterOptions) {
  const isMpv = () => options.getKernel() === 'mpv';
  const isManaged = () => options.getKernel() !== 'html5';
  const sendCommand = (command: MpvCommand): Promise<unknown> => isEngineKernel(options.getKernel()) ? options.sendEngineCommand?.(command) ?? Promise.resolve() : options.sendMpvCommand(command);

  return {
    isMpv,
    isManaged,
    sendCommand,
    getTime: () => (isManaged() ? options.getMpvState().time ?? 0 : options.getVideo()?.currentTime ?? 0),
    getDuration: () => {
      if (isManaged()) return options.getMpvState().duration ?? 0;

      const duration = options.getVideo()?.duration;
      return duration != null && Number.isFinite(duration) ? duration : 0;
    },
    isPaused: () => (isManaged() ? options.getMpvState().paused : !!options.getVideo()?.paused),
    play: () => {
      if (isManaged()) void sendCommand({ type: 'play' }).catch(() => undefined);
      else void options.getVideo()?.play().catch(() => undefined);
    },
    pause: () => {
      if (isManaged()) {
        void sendCommand({ type: 'pause' }).catch(() => undefined);
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
      if (isManaged()) void sendCommand({ type: 'seek', value: target }).catch(() => undefined);
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
      if (isManaged()) void sendCommand({ type: 'volume', value: target }).catch(() => undefined);
      else {
        const video = options.getVideo();
        if (video) video.volume = target;
      }
      options.setVolume(target);
      options.volumeRef.current = target;
    },
    setTemporaryRate: (rate: number) => {
      if (isManaged()) void sendCommand({ type: 'rate', value: rate }).catch(() => undefined);
      else { const video = options.getVideo(); if (video) video.playbackRate = rate; }
    },
    setRate: (rate: number) => {
      if (isManaged()) void sendCommand({ type: 'rate', value: rate }).catch(() => undefined);
      else {
        const video = options.getVideo();
        if (video) video.playbackRate = rate;
      }
      options.setRate(rate);
    },
  };
}
