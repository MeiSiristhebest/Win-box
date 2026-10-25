import { mpvDisplayStandard, type MpvKernelState } from '../../../../shared/player';

/** Maps raw MPV session data to the stable display shape used by playback controls. */
export function technicalState(st: MpvKernelState) {
  const tech = {
    hwdec: st.hwdec || '',
    w: st.video?.w || st.videoW,
    h: st.video?.h || st.videoH,
    standard: mpvDisplayStandard(st.video),
    vCodec: st.vCodec || '',
    aCodec: st.aCodec || '',
    channels: st.audio?.channels || '',
    vKbps: st.vBitrateKbps,
    aKbps: st.aBitrateKbps,
    fps: st.fps,
    dropped: st.dropped,
    cacheSec: st.cacheDuration,
    speedKbps: st.cacheKbps,
    pixelformat: st.video?.pixelformat || '',
    primaries: st.video?.primaries || '',
    gamma: st.video?.gamma || '',
    light: st.video?.light || '',
    sigPeak: st.video?.sigPeak || 0,
    samplerate: st.audio?.samplerate || 0,
    channelCount: st.audio?.channelCount || 0,
    spdif: st.spdif || '',
  };
  return tech;
}

export type MpvTechnicalState = ReturnType<typeof technicalState>;
