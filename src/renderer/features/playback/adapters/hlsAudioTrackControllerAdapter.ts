import type HlsInstance from 'hls.js';
import type { MpvAudioTrack } from '../../../../shared/player';
import type { AdaptiveAudioTrackController } from '../application/playerAudioTracks';

/** Adapts hls.js's mutable track API to the narrow playback capability port. */
export function createHlsAudioTrackControllerAdapter(hls: HlsInstance): AdaptiveAudioTrackController {
  return {
    select(trackId) {
      hls.audioTrack = trackId;
    },
    read() {
      const tracks: MpvAudioTrack[] = hls.audioTracks.map((raw, index) => ({
        id: index,
        title: raw.name || undefined,
        lang: raw.lang || undefined,
        channels: raw.attrs?.CHANNELS || undefined,
        selected: hls.audioTrack === index || undefined,
      }));
      return { tracks, selectedTrackId: hls.audioTrack >= 0 ? hls.audioTrack : null };
    },
  };
}
