import type { AudioPlayerInput } from '../application/audioPlayer';
import type { AudioMediaElement } from '../application/audioPlayerPorts';

export interface AudioPlayerModel {
  media: AudioPlayerInput;
  playback: {
    paused: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    loop: boolean;
    error: string;
    loading: boolean;
    progressPercent: number;
    currentTimeLabel: string;
    durationLabel: string;
  };
  actions: {
    attachAudioElement(element: AudioMediaElement | null): void;
    togglePlayback(): void;
    toggleLoop(): void;
    setVolume(volume: number): void;
    seekTo(seconds: number): void;
    onLoadedMetadata(): void;
    onCanPlay(): void;
    onTimeUpdate(): void;
    onPlay(): void;
    onPause(): void;
    onWaiting(): void;
    onPlaying(): void;
    onError(): void;
    onEnded(): void;
  };
}
