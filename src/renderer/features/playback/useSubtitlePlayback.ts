import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import type { Kernel } from '../../lib/kernel';
import { useSubtitleSearch } from './useSubtitleSearch';
import { reduceSubtitleAppearance, type SubtitleAppearanceCommand } from './application/subtitleAppearance';
import type { SubtitleSearchDependencies } from './application/subtitleSearchPorts';
import type { SubtitlePlaybackPort } from './application/subtitlePlaybackPort';
import { useHtmlSubtitleTrack } from './useHtmlSubtitleTrack';
import { useNativeSubtitleTrack } from './useNativeSubtitleTrack';
import type { SubtitleCue } from '../../../engine/subtitle/parseSubtitle';

interface UseSubtitlePlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  url: string;
  resourceName?: string;
  allowMpv: boolean;
  kernel: Kernel;
  initialOffset: number;
  searchDependencies: SubtitleSearchDependencies;
  playbackPort: SubtitlePlaybackPort;
}

export function useSubtitlePlayback({
  videoRef,
  url,
  resourceName,
  allowMpv,
  kernel,
  initialOffset,
  searchDependencies,
  playbackPort,
}: UseSubtitlePlaybackOptions) {
  const [enabled, setEnabled] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [appearance, dispatchAppearance] = useReducer(reduceSubtitleAppearance, {
    offset: initialOffset,
    fontSize: 20,
    bottom: 40,
  });
  const { offset, fontSize, bottom } = appearance;
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const settingsChangedRef = useRef(false);

  const markSettingsChanged = useCallback(() => {
    settingsChangedRef.current = true;
    setSettingsDirty(true);
  }, []);

  const onAppearanceCommand = useCallback((command: SubtitleAppearanceCommand) => {
    if (command.type === 'set-font-size' || command.type === 'step-font-size' ||
        command.type === 'set-bottom' || command.type === 'step-bottom') {
      markSettingsChanged();
    }
    dispatchAppearance(command);
  }, [markSettingsChanged]);

  const applyCues = useCallback((nextCues: SubtitleCue[]) => {
    setCues(nextCues);
    dispatchAppearance({ type: 'reset-offset' });
    setEnabled(true);
    setPanelOpen(false);
    markSettingsChanged();
  }, [markSettingsChanged]);

  const search = useSubtitleSearch({ url, resourceName, onApply: applyCues, dependencies: searchDependencies });
  const { query, candidates, tokenHint, search: runSearch } = search;

  useHtmlSubtitleTrack({ videoRef, enabled, cues, offset });
  useNativeSubtitleTrack({
    allowMpv,
    kernel,
    enabled,
    cues,
    offset,
    fontSize,
    bottom,
    activeSubtitle: search.activeSubtitle,
    port: playbackPort,
  });

  useEffect(() => {
    let active = true;
    void playbackPort.loadSettings().then((settings) => {
      if (!active) return;
      setSettingsLoaded(true);
      if (settingsChangedRef.current) return;
      setEnabled(settings.enabled);
      dispatchAppearance({
        type: 'restore-persisted-style',
        fontSize: settings.fontSize || 20,
        bottom: settings.bottom || 40,
      });
    }).catch(() => undefined).finally(() => {
      if (active) setSettingsReady(true);
    });
    return () => { active = false; };
  }, [playbackPort]);

  useEffect(() => {
    setCues([]);
    // Search state and stale-request handling are managed by useSubtitleSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (!settingsReady || (!settingsLoaded && !settingsDirty)) return;
    void playbackPort.saveSettings({ fontSize, bottom, enabled }).catch(() => undefined);
  }, [playbackPort, settingsReady, settingsLoaded, settingsDirty, fontSize, bottom, enabled]);

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
    fontSize,
    bottom,
    onAppearanceCommand,
    panelOpen,
    setPanelOpen,
    toggle,
    ...search,
  };
}
