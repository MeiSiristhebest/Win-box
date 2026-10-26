import { useCallback, useRef } from 'react';
import {
  PLAYER_PANEL_NAMES,
  transitionPlayerPanelVisibility,
  type PlayerPanelName,
  type PlayerPanelVisibility,
  type PlayerPanelVisibilityEvent,
} from './application/playerPanelVisibility';

export type PlayerSettingsPanel = 'subtitle' | 'danmaku' | 'fit' | 'audio' | 'superResolution';
export type PlayerPanelVisibilitySetters = Record<PlayerPanelName, (open: boolean) => void>;

export interface PlayerPanelHoverCancellers {
  subtitle: () => void;
  danmaku: () => void;
  volume: () => void;
}

interface PlayerPanelCoordinatorOptions {
  visibility: PlayerPanelVisibility;
  setVisibility: PlayerPanelVisibilitySetters;
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
  const { visibility, setVisibility, setVolumeHovered, clearVolumeFlash, revealControls } = options;
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

  const applyVisibilityEvent = useCallback((event: PlayerPanelVisibilityEvent) => {
    const next = transitionPlayerPanelVisibility(visibility, event);
    for (const panel of PLAYER_PANEL_NAMES) setVisibility[panel](next[panel]);
  }, [visibility, setVisibility]);

  const prepareForExclusivePanel = useCallback(() => {
    cancelPanelHover();
    setVolumeHovered(false);
    clearVolumeFlash();
  }, [cancelPanelHover, setVolumeHovered, clearVolumeFlash]);

  const openPanel = useCallback((panel: PlayerSettingsPanel) => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'open', panel });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

  const toggleSkipPanel = useCallback(() => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'toggle', panel: 'skip' });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

  const toggleEpisodesPanel = useCallback(() => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'toggle', panel: 'episodes' });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

  const openKernelPanel = useCallback(() => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'close-all' });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

  const onVolumeHoverChange = useCallback((open: boolean) => {
    if (open) {
      cancelSubtitleDanmakuHover();
      applyVisibilityEvent({ type: 'close-all' });
    }
    setVolumeHovered(open);
  }, [cancelSubtitleDanmakuHover, applyVisibilityEvent, setVolumeHovered]);

  const flashVolume = useCallback((flash: () => void) => {
    cancelSubtitleDanmakuHover();
    applyVisibilityEvent({ type: 'close-all' });
    flash();
  }, [cancelSubtitleDanmakuHover, applyVisibilityEvent]);

  const toggleStats = useCallback(() => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'toggle', panel: 'stats' });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

  const toggleKeys = useCallback(() => {
    prepareForExclusivePanel();
    applyVisibilityEvent({ type: 'toggle', panel: 'keys' });
    revealControls();
  }, [prepareForExclusivePanel, applyVisibilityEvent, revealControls]);

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
