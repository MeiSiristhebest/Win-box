import { useCallback, useRef } from 'react';

export type PlayerSettingsPanel = 'subtitle' | 'danmaku' | 'fit' | 'audio' | 'superResolution';
type ExclusivePlayerPanel = PlayerSettingsPanel | 'skip' | 'episodes' | 'stats' | 'keys';

export interface PlayerPanelHoverCancellers {
  subtitle: () => void;
  danmaku: () => void;
  volume: () => void;
}

interface PlayerPanelCoordinatorOptions {
  setSubtitleOpen: (open: boolean) => void;
  setDanmakuOpen: (open: boolean) => void;
  setFitOpen: (open: boolean) => void;
  setAudioOpen: (open: boolean) => void;
  setSuperResolutionOpen: (open: boolean) => void;
  skipOpen: boolean;
  setSkipOpen: (open: boolean) => void;
  episodesOpen: boolean;
  setEpisodesOpen: (open: boolean) => void;
  statsOpen: boolean;
  setStatsOpen: (open: boolean) => void;
  keysOpen: boolean;
  setKeysOpen: (open: boolean) => void;
  setVolumeHovered: (hovered: boolean) => void;
  clearVolumeFlash: () => void;
  revealControls: () => void;
}

const noCancel = () => undefined;

/**
 * Owns the cross-panel interaction policy for the player.
 * Feature hooks keep ownership of their own data; this boundary coordinates
 * only visibility transitions and transient hover timers.
 */
export function usePlayerPanelCoordinator(options: PlayerPanelCoordinatorOptions) {
  const {
    setSubtitleOpen,
    setDanmakuOpen,
    setFitOpen,
    setAudioOpen,
    setSuperResolutionOpen,
    skipOpen,
    setSkipOpen,
    episodesOpen,
    setEpisodesOpen,
    statsOpen,
    setStatsOpen,
    keysOpen,
    setKeysOpen,
    setVolumeHovered,
    clearVolumeFlash,
    revealControls,
  } = options;
  const hoverCancellers = useRef<PlayerPanelHoverCancellers>({
    subtitle: noCancel,
    danmaku: noCancel,
    volume: noCancel,
  });

  const registerHoverCancellers = useCallback((cancellers: PlayerPanelHoverCancellers) => {
    hoverCancellers.current = cancellers;
  }, []);

  const cancelSubtitleDanmakuHover = useCallback(() => {
    hoverCancellers.current.subtitle();
    hoverCancellers.current.danmaku();
  }, []);

  const cancelPanelHover = useCallback(() => {
    cancelSubtitleDanmakuHover();
    hoverCancellers.current.volume();
  }, [cancelSubtitleDanmakuHover]);

  const closeOtherPanels = useCallback((keep: ExclusivePlayerPanel | null) => {
    if (keep !== 'subtitle') setSubtitleOpen(false);
    if (keep !== 'danmaku') setDanmakuOpen(false);
    if (keep !== 'fit') setFitOpen(false);
    if (keep !== 'audio') setAudioOpen(false);
    if (keep !== 'superResolution') setSuperResolutionOpen(false);
    if (keep !== 'skip') setSkipOpen(false);
    if (keep !== 'episodes') setEpisodesOpen(false);
    if (keep !== 'stats') setStatsOpen(false);
    if (keep !== 'keys') setKeysOpen(false);
  }, [setSubtitleOpen, setDanmakuOpen, setFitOpen, setAudioOpen, setSuperResolutionOpen, setSkipOpen, setEpisodesOpen, setStatsOpen, setKeysOpen]);

  const prepareForExclusivePanel = useCallback(() => {
    cancelPanelHover();
    setVolumeHovered(false);
    clearVolumeFlash();
  }, [cancelPanelHover, setVolumeHovered, clearVolumeFlash]);

  const openPanel = useCallback((panel: PlayerSettingsPanel) => {
    prepareForExclusivePanel();
    closeOtherPanels(panel);
    if (panel === 'subtitle') setSubtitleOpen(true);
    if (panel === 'danmaku') setDanmakuOpen(true);
    if (panel === 'fit') setFitOpen(true);
    if (panel === 'audio') setAudioOpen(true);
    if (panel === 'superResolution') setSuperResolutionOpen(true);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, setSubtitleOpen, setDanmakuOpen, setFitOpen, setAudioOpen, setSuperResolutionOpen, revealControls]);

  const toggleSkipPanel = useCallback(() => {
    prepareForExclusivePanel();
    closeOtherPanels('skip');
    setSkipOpen(!skipOpen);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, skipOpen, setSkipOpen, revealControls]);

  const toggleEpisodesPanel = useCallback(() => {
    prepareForExclusivePanel();
    closeOtherPanels('episodes');
    setEpisodesOpen(!episodesOpen);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, episodesOpen, setEpisodesOpen, revealControls]);

  const openKernelPanel = useCallback(() => {
    prepareForExclusivePanel();
    closeOtherPanels(null);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, revealControls]);

  const onVolumeHoverChange = useCallback((open: boolean) => {
    if (open) {
      cancelSubtitleDanmakuHover();
      closeOtherPanels(null);
    }
    setVolumeHovered(open);
  }, [cancelSubtitleDanmakuHover, closeOtherPanels, setVolumeHovered]);

  const flashVolume = useCallback((flash: () => void) => {
    cancelSubtitleDanmakuHover();
    closeOtherPanels(null);
    flash();
  }, [cancelSubtitleDanmakuHover, closeOtherPanels]);

  const toggleStats = useCallback(() => {
    prepareForExclusivePanel();
    closeOtherPanels('stats');
    setStatsOpen(!statsOpen);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, statsOpen, setStatsOpen, revealControls]);

  const toggleKeys = useCallback(() => {
    prepareForExclusivePanel();
    closeOtherPanels('keys');
    setKeysOpen(!keysOpen);
    revealControls();
  }, [prepareForExclusivePanel, closeOtherPanels, keysOpen, setKeysOpen, revealControls]);

  return {
    openPanel,
    toggleSkipPanel,
    toggleEpisodesPanel,
    openKernelPanel,
    onVolumeHoverChange,
    flashVolume,
    toggleStats,
    toggleKeys,
    cancelSubtitleDanmakuHover,
    registerHoverCancellers,
  };
}
