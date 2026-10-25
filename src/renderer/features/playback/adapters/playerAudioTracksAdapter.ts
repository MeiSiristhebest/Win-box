import type HlsInstance from 'hls.js';
import type { RefObject } from 'react';
import type { MpvAudioTrack } from '../../../../shared/player';
import { client } from '../../../api/client';
import type { PlayerAudioTracksPort } from '../application/playerAudioTracks';

export function createPlayerAudioTracksAdapter(hlsRef: RefObject<HlsInstance | null>): PlayerAudioTracksPort {
  return {
    selectEngineTrack(trackId) {
      void client.engineCmd({ type: 'aid', value: trackId }).catch(() => undefined);
    },
    selectMpvTrack(trackId) {
      void client.mpvCmd({ type: 'aid', value: trackId }).catch(() => undefined);
    },
    selectHlsTrack(trackId) {
      const hls = hlsRef.current;
      if (hls) hls.audioTrack = trackId;
    },
    readHlsTracks() {
      const hls = hlsRef.current;
      if (!hls) return null;
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
