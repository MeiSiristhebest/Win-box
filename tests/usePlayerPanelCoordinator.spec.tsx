// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { usePlayerPanelCoordinator } from '../src/renderer/features/playback/usePlayerPanelCoordinator';

type PanelState = {
  subtitle: boolean;
  danmaku: boolean;
  fit: boolean;
  audio: boolean;
  superResolution: boolean;
  skip: boolean;
  episodes: boolean;
  stats: boolean;
  keys: boolean;
  volumeHovered: boolean;
};

const defaults: PanelState = {
  subtitle: false,
  danmaku: false,
  fit: false,
  audio: false,
  superResolution: false,
  skip: false,
  episodes: false,
  stats: false,
  keys: false,
  volumeHovered: false,
};

function useCoordinatorHarness(overrides: Partial<PanelState> = {}) {
  const [subtitle, setSubtitle] = useState(overrides.subtitle ?? defaults.subtitle);
  const [danmaku, setDanmaku] = useState(overrides.danmaku ?? defaults.danmaku);
  const [fit, setFit] = useState(overrides.fit ?? defaults.fit);
  const [audio, setAudio] = useState(overrides.audio ?? defaults.audio);
  const [superResolution, setSuperResolution] = useState(overrides.superResolution ?? defaults.superResolution);
  const [skip, setSkip] = useState(overrides.skip ?? defaults.skip);
  const [episodes, setEpisodes] = useState(overrides.episodes ?? defaults.episodes);
  const [stats, setStats] = useState(overrides.stats ?? defaults.stats);
  const [keys, setKeys] = useState(overrides.keys ?? defaults.keys);
  const [volumeHovered, setVolumeHovered] = useState(overrides.volumeHovered ?? defaults.volumeHovered);
  const clearVolumeFlash = useMemo(() => vi.fn(), []);
  const revealControls = useMemo(() => vi.fn(), []);
  const coordinator = usePlayerPanelCoordinator({
    setSubtitleOpen: setSubtitle,
    setDanmakuOpen: setDanmaku,
    setFitOpen: setFit,
    setAudioOpen: setAudio,
    setSuperResolutionOpen: setSuperResolution,
    skipOpen: skip,
    setSkipOpen: setSkip,
    episodesOpen: episodes,
    setEpisodesOpen: setEpisodes,
    statsOpen: stats,
    setStatsOpen: setStats,
    keysOpen: keys,
    setKeysOpen: setKeys,
    setVolumeHovered,
    clearVolumeFlash,
    revealControls,
  });
  return {
    state: { subtitle, danmaku, fit, audio, superResolution, skip, episodes, stats, keys, volumeHovered },
    coordinator,
    clearVolumeFlash,
    revealControls,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlayerPanelCoordinator', () => {
  it('opens exactly one settings panel and closes episode and skip panels', () => {
    const { result } = renderHook(() => useCoordinatorHarness({
      danmaku: true,
      fit: true,
      audio: true,
      superResolution: true,
      skip: true,
      episodes: true,
      stats: true,
      keys: true,
      volumeHovered: true,
    }));
    const cancelSubtitle = vi.fn();
    const cancelDanmaku = vi.fn();
    const cancelVolume = vi.fn();

    act(() => result.current.coordinator.registerHoverCancellers({
      subtitle: cancelSubtitle,
      danmaku: cancelDanmaku,
      volume: cancelVolume,
    }));
    act(() => result.current.coordinator.openPanel('subtitle'));

    expect(result.current.state).toMatchObject({
      subtitle: true,
      danmaku: false,
      fit: false,
      audio: false,
      superResolution: false,
      skip: false,
      episodes: false,
      stats: false,
      keys: false,
      volumeHovered: false,
    });
    expect(cancelSubtitle).toHaveBeenCalledOnce();
    expect(cancelDanmaku).toHaveBeenCalledOnce();
    expect(cancelVolume).toHaveBeenCalledOnce();
    expect(result.current.clearVolumeFlash).toHaveBeenCalledOnce();
    expect(result.current.revealControls).toHaveBeenCalledOnce();
  });

  it('toggles skip and episode panels while closing their declared conflicting panels', () => {
    const { result } = renderHook(() => useCoordinatorHarness({ subtitle: true, danmaku: true, fit: true, audio: true, superResolution: true }));

    act(() => result.current.coordinator.toggleSkipPanel());
    expect(result.current.state).toMatchObject({ subtitle: false, danmaku: false, fit: false, audio: false, superResolution: false, skip: true, episodes: false });

    act(() => result.current.coordinator.toggleEpisodesPanel());
    expect(result.current.state).toMatchObject({ subtitle: false, danmaku: false, fit: false, audio: false, superResolution: false, skip: false, episodes: true });
  });

  it('keeps every floating player panel exclusive, including volume, stats, and key panels', () => {
    const { result } = renderHook(() => useCoordinatorHarness({ subtitle: true, danmaku: true, fit: true, skip: true, audio: true, superResolution: true, episodes: true }));

    act(() => result.current.coordinator.onVolumeHoverChange(true));
    expect(result.current.state).toMatchObject({
      subtitle: false,
      danmaku: false,
      fit: false,
      skip: false,
      audio: false,
      superResolution: false,
      episodes: false,
      stats: false,
      keys: false,
      volumeHovered: true,
    });

    act(() => result.current.coordinator.toggleStats());
    expect(result.current.state).toMatchObject({ stats: true, keys: false, volumeHovered: false });
    act(() => result.current.coordinator.toggleKeys());
    expect(result.current.state).toMatchObject({ stats: false, keys: true });
  });
});
