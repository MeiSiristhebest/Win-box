// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMemo, useRef, useState } from 'react';
import { usePlayerPanelSession } from '../src/renderer/features/playback/usePlayerPanelSession';

function usePanelSessionHarness() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [superResolutionOpen, setSuperResolutionOpen] = useState(false);
  const [volumeHovered, setVolumeHovered] = useState(false);
  const [volumeFocused, setVolumeFocused] = useState(false);
  const clearVolumeFlash = useMemo(() => vi.fn(), []);
  const revealControls = useMemo(() => vi.fn(), []);

  const session = usePlayerPanelSession({
    isPaused: () => true,
    containerRef,
    revealControls,
    subtitle: { open: subtitleOpen, setOpen: setSubtitleOpen },
    skip: { open: skipOpen, setOpen: setSkipOpen },
    audio: { open: audioOpen, setOpen: setAudioOpen },
    superResolution: { open: superResolutionOpen, setOpen: setSuperResolutionOpen },
    volume: {
      isOpen: anotherPanelOpen => volumeHovered || (anotherPanelOpen && volumeFocused),
      setHovered: setVolumeHovered,
      clearFlash: clearVolumeFlash,
    },
  });

  return {
    session,
    state: { subtitleOpen, skipOpen, audioOpen, superResolutionOpen, volumeHovered },
    clearVolumeFlash,
    revealControls,
    setVolumeFocused,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlayerPanelSession', () => {
  it('keeps panel visibility state and exclusive transitions in one session boundary', () => {
    const { result } = renderHook(() => usePanelSessionHarness());

    act(() => result.current.session.coordinator.openPanel('subtitle'));
    expect(result.current.state.subtitleOpen).toBe(true);
    expect(result.current.session.controls.visible).toBe(true);

    act(() => result.current.session.coordinator.openPanel('audio'));
    expect(result.current.state).toMatchObject({ subtitleOpen: false, audioOpen: true });
    expect(result.current.clearVolumeFlash).toHaveBeenCalledTimes(2);
    expect(result.current.revealControls).toHaveBeenCalledTimes(2);
  });

  it('toggles the current skip-panel state from the latest committed render', () => {
    const { result } = renderHook(() => usePanelSessionHarness());

    act(() => result.current.session.coordinator.toggleSkipPanel());
    expect(result.current.state.skipOpen).toBe(true);
    act(() => result.current.session.coordinator.toggleSkipPanel());
    expect(result.current.state.skipOpen).toBe(false);
  });
});
