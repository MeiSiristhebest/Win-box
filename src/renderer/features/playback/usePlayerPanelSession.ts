import { useLayoutEffect, useState, type RefObject } from 'react';
import { useHoverDelay } from '../../lib/useHoverDelay';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import { usePlayerControlsVisibility } from './usePlayerControlsVisibility';
import { usePlayerPanelCoordinator } from './usePlayerPanelCoordinator';

export interface PlayerPanelPort {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export interface PlayerVolumePanelPort {
  isOpen: (anotherPanelOpen: boolean) => boolean;
  setHovered: (hovered: boolean) => void;
  clearFlash: () => void;
}

export interface PlayerPanelSessionOptions {
  isPaused: () => boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  revealControls: () => void;
  subtitle: PlayerPanelPort;
  skip: PlayerPanelPort;
  audio: PlayerPanelPort;
  superResolution: PlayerPanelPort;
  volume: PlayerVolumePanelPort;
}

/**
 * Owns transient player-panel state and interactions as one UI session.
 * Feature controllers retain ownership of their data; this session coordinates
 * exclusivity, hover intent, floating-panel placement, and control visibility.
 */
export function usePlayerPanelSession(options: PlayerPanelSessionOptions) {
  const { isPaused, containerRef, revealControls, subtitle, skip, audio, superResolution, volume } = options;
  const [danmakuOpen, setDanmakuOpen] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);

  const coordinator = usePlayerPanelCoordinator({
    setSubtitleOpen: subtitle.setOpen,
    setDanmakuOpen,
    setFitOpen,
    setAudioOpen: audio.setOpen,
    setSuperResolutionOpen: superResolution.setOpen,
    skipOpen: skip.open,
    setSkipOpen: skip.setOpen,
    episodesOpen,
    setEpisodesOpen,
    statsOpen,
    setStatsOpen,
    keysOpen,
    setKeysOpen,
    setVolumeHovered: volume.setHovered,
    clearVolumeFlash: volume.clearFlash,
    revealControls,
  });
  const { registerHoverCancellers } = coordinator;

  const volumeOpen = volume.isOpen(subtitle.open || danmakuOpen);
  const controls = usePlayerControlsVisibility({
    isPaused,
    panelOpen: subtitle.open || danmakuOpen || fitOpen || skip.open || volumeOpen || audio.open || superResolution.open || episodesOpen || statsOpen || keysOpen,
  });
  const subtitleHover = useHoverDelay(open => open ? coordinator.openPanel('subtitle') : subtitle.setOpen(false));
  const danmakuHover = useHoverDelay(open => open ? coordinator.openPanel('danmaku') : setDanmakuOpen(false));
  const volumeHover = useHoverDelay(coordinator.onVolumeHoverChange);
  const subtitlePanelHost = usePlayerPanelPosition(subtitle.open, containerRef);
  const danmakuPanelHost = usePlayerPanelPosition(danmakuOpen, containerRef);

  useLayoutEffect(() => {
    registerHoverCancellers({
      subtitle: subtitleHover.cancel,
      danmaku: danmakuHover.cancel,
      volume: volumeHover.cancel,
    });
  }, [registerHoverCancellers, subtitleHover.cancel, danmakuHover.cancel, volumeHover.cancel]);

  return {
    danmakuOpen,
    setDanmakuOpen,
    fitOpen,
    setFitOpen,
    episodesOpen,
    setEpisodesOpen,
    statsOpen,
    setStatsOpen,
    keysOpen,
    setKeysOpen,
    volumeOpen,
    controls,
    coordinator,
    hover: { subtitle: subtitleHover, danmaku: danmakuHover, volume: volumeHover },
    panelHosts: { subtitle: subtitlePanelHost, danmaku: danmakuPanelHost },
  };
}
