import type { SkipSeg } from './skipSegments';

/** Shared playback facts used by media sessions without exposing presenter refs. */
export interface PlaybackSessionStatePort {
  getLivePlaybackKind(): boolean;
  setLivePlaybackKind(isLive: boolean): void;
  getSkipSegments(): SkipSeg;
  wasIntroSkipHandled(): boolean;
  markIntroSkipHandled(): void;
  wasOutroSkipHandled(): boolean;
  markOutroSkipHandled(): void;
}

export interface PlaybackSkipMarkersPort {
  getSkipSegments(): SkipSeg;
  wasIntroSkipHandled(): boolean;
  markIntroSkipHandled(): void;
  wasOutroSkipHandled(): boolean;
  markOutroSkipHandled(): void;
}

/** Keeps shared session facts behind semantic accessors and reads skip configuration on demand. */
export function createPlaybackSessionStatePort(
  readSkipSegments: () => SkipSeg,
  markers?: Omit<PlaybackSkipMarkersPort, 'getSkipSegments'>,
): PlaybackSessionStatePort {
  let livePlaybackKind = false;
  let introSkipHandled = false;
  let outroSkipHandled = false;

  return {
    getLivePlaybackKind: () => livePlaybackKind,
    setLivePlaybackKind: (isLive) => { livePlaybackKind = isLive; },
    getSkipSegments: () => ({ ...readSkipSegments() }),
    wasIntroSkipHandled: markers?.wasIntroSkipHandled ?? (() => introSkipHandled),
    markIntroSkipHandled: markers?.markIntroSkipHandled ?? (() => { introSkipHandled = true; }),
    wasOutroSkipHandled: markers?.wasOutroSkipHandled ?? (() => outroSkipHandled),
    markOutroSkipHandled: markers?.markOutroSkipHandled ?? (() => { outroSkipHandled = true; }),
  };
}
