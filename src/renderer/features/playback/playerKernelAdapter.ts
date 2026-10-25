import type { MpvCommand, MpvKernelState } from '../../../shared/player';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import type { PlayerKernelCommandPort } from './application/playerKernelCommandPort';

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
  commands: PlayerKernelCommandPort;
  onCommandError: (command: MpvCommand, error: unknown) => void;
  setCurrentTime: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  volumeRef: { current: number };
}

export function createPlayerKernelAdapter(options: PlayerKernelAdapterOptions) {
  const isMpv = () => options.getKernel() === 'mpv';
  const isManaged = () => options.getKernel() !== 'html5';
  const sendCommand = (command: MpvCommand): Promise<unknown> => isEngineKernel(options.getKernel())
    ? options.commands.sendEngineCommand(command)
    : options.commands.sendMpvCommand(command);
  const runManagedCommand = (command: MpvCommand, commit?: () => void): void => {
    void sendCommand(command).then(commit).catch((error: unknown) => options.onCommandError(command, error));
  };
  const reportHtmlError = (command: MpvCommand, error: unknown): void => options.onCommandError(command, error);

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
      const command: MpvCommand = { type: 'play' };
      if (isManaged()) runManagedCommand(command);
      else {
        const video = options.getVideo();
        if (video) {
          try {
            void video.play().catch((error: unknown) => reportHtmlError(command, error));
          } catch (error) {
            reportHtmlError(command, error);
          }
        }
      }
    },
    pause: () => {
      if (isManaged()) {
        runManagedCommand({ type: 'pause' });
        return;
      }

      try {
        options.getVideo()?.pause();
      } catch (error) {
        reportHtmlError({ type: 'pause' }, error);
      }
    },
    seek: (seconds: number) => {
      const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
      const command: MpvCommand = { type: 'seek', value: target };
      if (isManaged()) runManagedCommand(command, () => options.setCurrentTime(target));
      else {
        const video = options.getVideo();
        if (video) {
          try {
            video.currentTime = target;
            options.setCurrentTime(target);
          } catch (error) {
            reportHtmlError(command, error);
          }
        }
      }
    },
    setVolume: (volume: number) => {
      const target = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : options.volumeRef.current));
      const command: MpvCommand = { type: 'volume', value: target };
      const commit = () => { options.setVolume(target); options.volumeRef.current = target; };
      if (isManaged()) runManagedCommand(command, commit);
      else {
        const video = options.getVideo();
        if (!video) return;
        try {
          video.volume = target;
          commit();
        } catch (error) {
          reportHtmlError(command, error);
        }
      }
    },
    setTemporaryRate: (rate: number) => {
      const target = Number.isFinite(rate) && rate > 0 ? rate : 1;
      const command: MpvCommand = { type: 'rate', value: target };
      if (isManaged()) runManagedCommand(command);
      else {
        const video = options.getVideo();
        if (!video) return;
        try { video.playbackRate = target; } catch (error) { reportHtmlError(command, error); }
      }
    },
    setRate: (rate: number) => {
      const target = Number.isFinite(rate) && rate > 0 ? rate : 1;
      const command: MpvCommand = { type: 'rate', value: target };
      const commit = () => options.setRate(target);
      if (isManaged()) runManagedCommand(command, commit);
      else {
        const video = options.getVideo();
        if (!video) return;
        try {
          video.playbackRate = target;
          commit();
        } catch (error) {
          reportHtmlError(command, error);
        }
      }
    },
  };
}
