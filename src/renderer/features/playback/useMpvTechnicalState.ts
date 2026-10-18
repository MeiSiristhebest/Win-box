import { useCallback, useEffect, useRef, useState } from 'react';
import { mpvDisplayStandard, mpvFormatBadges, type MpvKernelState } from '../../../shared/player';
import type { Kernel } from '../../lib/kernel';

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
        // ★ 阶段3b：技术详情浮层明细（直接从内核状态取；缺值留空/0，浮层按「有值才显示」渲染）
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

export function useMpvTechnicalState(url: string, kernel: Kernel) {
  const key = kernel + '\u0000' + url;
  const signature = useRef('');
  const [view, setView] = useState<{ key: string; state: MpvKernelState; tech: MpvTechnicalState } | null>(null);
  const [expiredBadges, setExpiredBadges] = useState('');
  const onState = useCallback((state: MpvKernelState) => {
    const tech = technicalState(state);
    const rounded = { ...tech, vKbps: Math.round(tech.vKbps / 50), aKbps: Math.round(tech.aKbps / 5), fps: Math.round(tech.fps), cacheSec: Math.round(tech.cacheSec ?? -1), speedKbps: Math.round(tech.speedKbps / 50) };
    const next = JSON.stringify([key, state.subtitles, state.sid, state.loaded, state.error, rounded]);
    if (signature.current === next) return;
    signature.current = next;
    setView({ key, state, tech });
  }, [key]);
  const current = view?.key === key ? view : null;
  const badgeSignature = current?.state.loaded && !current.state.error ? mpvFormatBadges(current.state.video, current.tech.aCodec, current.tech.channels).join('\u0000') : '';
  const badgeScope = key + '\u0000' + badgeSignature;
  useEffect(() => {
    if (!badgeSignature) return;
    const timer = setTimeout(() => setExpiredBadges(badgeScope), 4000);
    return () => clearTimeout(timer);
  }, [badgeScope, badgeSignature]);

  return { onState, tech: current?.tech ?? null, subtitles: current?.state.subtitles ?? [], sid: current?.state.sid ?? null, badges: badgeSignature && expiredBadges !== badgeScope ? badgeSignature.split('\u0000') : [] };
}
