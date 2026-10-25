import type { SkipSeg } from './skipSegments';

/** Shared playback facts used by media sessions without exposing presenter refs. */
export interface PlaybackSessionStatePort {
  getLivePlaybackKind(): boolean;
  setLivePlaybackKind(isLive: boolean): void;
  getSkipSegments(): SkipSeg;
}

/** Keeps live state private and reads the latest skip configuration on demand. */
export function createPlaybackSessionStatePort(readSkipSegments: () => SkipSeg): PlaybackSessionStatePort {
  let livePlaybackKind = false;

  return {
    getLivePlaybackKind: () => livePlaybackKind,
    setLivePlaybackKind: (isLive) => { livePlaybackKind = isLive; },
    getSkipSegments: () => ({ ...readSkipSegments() }),
  };
}
