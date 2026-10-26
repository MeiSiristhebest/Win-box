import type { RefObject } from 'react';
import { client } from '../../../api/client';
import type { AdaptiveAudioTrackController, PlayerAudioTracksPort } from '../application/playerAudioTracks';

export function createPlayerAudioTracksAdapter(adaptiveTracksRef: RefObject<AdaptiveAudioTrackController | null>): PlayerAudioTracksPort {
  return {
    selectEngineTrack(trackId) {
      void client.engineCmd({ type: 'aid', value: trackId }).catch(() => undefined);
    },
    selectMpvTrack(trackId) {
      void client.mpvCmd({ type: 'aid', value: trackId }).catch(() => undefined);
    },
    selectAdaptiveTrack(trackId) {
      adaptiveTracksRef.current?.select(trackId);
    },
    readAdaptiveTracks() {
      return adaptiveTracksRef.current?.read() ?? null;
    },
  };
}
