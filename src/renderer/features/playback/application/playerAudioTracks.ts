import type { MpvAudioTrack } from '../../../../shared/player';

export interface AdaptiveAudioTrackSnapshot {
  tracks: MpvAudioTrack[];
  selectedTrackId: number | null;
}

/** Narrow capability exposed by the active adaptive-stream session. */
export interface AdaptiveAudioTrackController {
  select(trackId: number): void;
  read(): AdaptiveAudioTrackSnapshot;
}

/** External capabilities used by the audio-track workflow. */
export interface PlayerAudioTracksPort {
  selectEngineTrack(trackId: number): void;
  selectMpvTrack(trackId: number): void;
  selectAdaptiveTrack(trackId: number): void;
  readAdaptiveTracks(): AdaptiveAudioTrackSnapshot | null;
}
