import type { MpvAudioTrack } from '../../../../shared/player';

/** External capabilities used by the audio-track workflow. */
export interface PlayerAudioTracksPort {
  selectEngineTrack(trackId: number): void;
  selectMpvTrack(trackId: number): void;
  selectHlsTrack(trackId: number): void;
  readHlsTracks(): { tracks: MpvAudioTrack[]; selectedTrackId: number | null } | null;
}
