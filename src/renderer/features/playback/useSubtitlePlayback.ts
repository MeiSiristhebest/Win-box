import { useCallback, useEffect, useRef, useState, type RefObject, type SetStateAction } from 'react';
import { cuesToSrt, shiftCues } from '../../../engine/subtitle/parseSubtitle';
import type { SubtitleSettings } from '../../../shared/subtitle';
import { mpvSubPos } from '../../../shared/player';
import { client } from '../../api/client';
import { isEngineKernel, type Kernel } from '../../lib/kernel';
import { useSubtitleSearch } from './useSubtitleSearch';

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface UseSubtitlePlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  url: string;
  resourceName?: string;
  allowMpv: boolean;
  kernel: Kernel;
  initialOffset: number;
}

export function useSubtitlePlayback({
  videoRef,
  url,
  resourceName,
  allowMpv,
  kernel,
  initialOffset,
}: UseSubtitlePlaybackOptions) {
  const [enabled, setEnabled] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [offset, setOffset] = useState(initialOffset);
  const [fontSize, setFontSize] = useState(20);
  const [bottom, setBottom] = useState(40);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const settingsChangedRef = useRef(false);
  const trackRef = useRef<TextTrack | null>(null);

  const markSettingsChanged = useCallback(() => {
    settingsChangedRef.current = true;
    setSettingsDirty(true);
  }, []);

  const updateFontSize = useCallback((value: SetStateAction<number>) => {
    markSettingsChanged();
    setFontSize(value);
  }, [markSettingsChanged]);

  const updateBottom = useCallback((value: SetStateAction<number>) => {
    markSettingsChanged();
    setBottom(value);
  }, [markSettingsChanged]);

  const applyCues = useCallback((nextCues: SubtitleCue[]) => {
    setCues(nextCues);
    setOffset(0);
    setEnabled(true);
    setPanelOpen(false);
    markSettingsChanged();
  }, [markSettingsChanged]);

  const search = useSubtitleSearch({ url, resourceName, onApply: applyCues });
  const { query, candidates, tokenHint, search: runSearch } = search;

  useEffect(() => {
    let active = true;
    void client.subtitleGet().then((settings: SubtitleSettings) => {
      if (!active) return;
      setSettingsLoaded(true);
      if (settingsChangedRef.current) return;
      setEnabled(settings.enabled);
      setFontSize(settings.fontSize || 20);
      setBottom(settings.bottom || 40);
    }).catch(() => undefined).finally(() => {
      if (active) setSettingsReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setCues([]);
    // Search state and stale-request handling are managed by useSubtitleSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const apply = (track: TextTrack): number => {
      while (track.cues && track.cues.length) track.removeCue(track.cues[0] as VTTCue);
      track.mode = enabled && cues.length ? 'showing' : 'disabled';
      let added = 0;
      if (enabled && cues.length) {
        for (const cue of shiftCues(cues, offset)) {
          try {
            track.addCue(new VTTCue(cue.start, cue.end, cue.text));
            added++;
          } catch {
            // Ignore an invalid cue and keep applying the rest.
          }
        }
      }
      return added;
    };

    let track = trackRef.current;
    const belongsToCurrentVideo = !!track && Array.from(video.textTracks || []).includes(track);
    if (!track || !belongsToCurrentVideo) {
      track = video.addTextTrack('subtitles', '外挂字幕', 'zh');
      trackRef.current = track;
    }

    const added = apply(track);
    if (enabled && cues.length && added === 0) {
      trackRef.current = null;
      track = video.addTextTrack('subtitles', '外挂字幕', 'zh');
      trackRef.current = track;
      apply(track);
    }
  }, [videoRef, enabled, cues, offset]);

  useEffect(() => {
    if (!allowMpv || kernel === 'html5') return;
    const send = isEngineKernel(kernel) ? client.engineCmd : client.mpvCmd;
    if (!enabled || !cues.length) {
      void send({ type: 'sub-clear' }).catch(() => undefined);
      return;
    }

    const srt = cuesToSrt(shiftCues(cues, offset));
    if (!srt.trim()) return;
    void send({ type: 'sub-add', text: srt, fileName: search.activeSubtitle || 'subtitle.srt' }).catch(() => undefined);
    void send({ type: 'sub-font', value: fontSize }).catch(() => undefined);
    void send({ type: 'sub-pos', value: mpvSubPos(bottom, window.innerHeight) }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowMpv, kernel, enabled, cues, offset, fontSize, bottom, search.activeSubtitle]);

  useEffect(() => {
    if (!settingsReady || (!settingsLoaded && !settingsDirty)) return;
    void client.subtitleSet({ fontSize, bottom, enabled }).catch(() => undefined);
  }, [settingsReady, settingsLoaded, settingsDirty, fontSize, bottom, enabled]);

  const toggle = useCallback(() => {
    const next = !enabled;
    markSettingsChanged();
    setEnabled(next);
    if (next && query.trim() && !candidates.length && !tokenHint) {
      void runSearch();
    }
  }, [enabled, query, candidates.length, tokenHint, runSearch, markSettingsChanged]);

  return {
    enabled,
    offset,
    setOffset,
    fontSize,
    setFontSize: updateFontSize,
    bottom,
    setBottom: updateBottom,
    panelOpen,
    setPanelOpen,
    toggle,
    ...search,
  };
}
