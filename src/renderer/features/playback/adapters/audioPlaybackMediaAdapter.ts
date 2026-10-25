import type { AudioMediaElement, AudioPlaybackMediaPort } from '../application/audioPlayerPorts';

/** Browser adapter for the small media capability consumed by the audio playback session. */
export const audioPlaybackMediaAdapter: AudioPlaybackMediaPort = {
  load: (element: AudioMediaElement) => element.load(),
  play: (element: AudioMediaElement) => element.play(),
  pause: (element: AudioMediaElement) => element.pause(),
  isPaused: (element: AudioMediaElement) => element.paused,
  currentTime: (element: AudioMediaElement) => element.currentTime,
  duration: (element: AudioMediaElement) => element.duration,
  setCurrentTime: (element: AudioMediaElement, seconds: number) => { element.currentTime = seconds; },
  setVolume: (element: AudioMediaElement, volume: number) => { element.volume = volume; },
};
