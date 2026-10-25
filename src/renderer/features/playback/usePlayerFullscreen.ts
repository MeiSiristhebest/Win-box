import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Kernel } from '../../lib/kernel';
import type { PlayerFullscreenPort } from './application/playerFullscreen';

interface UsePlayerFullscreenOptions {
  allowMpv: boolean;
  nativeWindow?: boolean;
  kernel: Kernel;
  mini: boolean;
  containerRef: { current: HTMLDivElement | null };
  revealControls: () => void;
  port: PlayerFullscreenPort;
}

let lastNativeFullscreen = false;

export function usePlayerFullscreen({
  allowMpv,
  nativeWindow,
  kernel,
  mini,
  containerRef,
  revealControls,
  port,
}: UsePlayerFullscreenOptions) {
  const nativeFullscreen = nativeWindow ?? (allowMpv && kernel === 'mpv');
  const [full, setFull] = useState(nativeWindow ? lastNativeFullscreen : false);
  const fullRef = useRef(full);
  useLayoutEffect(() => { fullRef.current = full; if (nativeWindow) lastNativeFullscreen = full; }, [full, nativeWindow]);
  const transitionBusyRef = useRef(false);

  useEffect(() => {
    if (!mini) return;
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false)).catch(() => undefined);
    else if (nativeFullscreen && fullRef.current) void port.setNativeFullscreen(false).then(setFull).catch(() => undefined);
  }, [mini, nativeFullscreen, port]);

  useEffect(() => {
    if (!nativeFullscreen) return;
    let active = true;
    const unsubscribe = port.subscribeToNativeFullscreen(setFull);
    void port.readNativeFullscreen()
      .then((fullscreen) => {
        if (active) setFull(fullscreen);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [nativeFullscreen, port]);

  useEffect(() => {
    if (nativeFullscreen) return;
    const syncWindowResize = () => {
      const active = !!document.fullscreenElement;
      setFull(active);
      void port.setWindowResizable(!active).catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', syncWindowResize);
    syncWindowResize();
    return () => {
      document.removeEventListener('fullscreenchange', syncWindowResize);
      void port.setWindowResizable(true).catch(() => undefined);
    };
  }, [nativeFullscreen, port]);

  useEffect(() => {
    const root = document.documentElement;
    if (full) root.dataset.playerFullscreen = '1';
    else delete root.dataset.playerFullscreen;
    return () => {
      if (!nativeWindow) delete root.dataset.playerFullscreen;
    };
  }, [full, nativeWindow]);

  const exitMpvFullscreen = useCallback(() => {
    void port.setNativeFullscreen(false)
      .then(setFull)
      .catch(() => undefined);
  }, [port]);

  const toggleFull = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (nativeFullscreen) {
      if (transitionBusyRef.current) return;
      transitionBusyRef.current = true;
      void port.readNativeFullscreen()
        .then((fullscreen) => port.setNativeFullscreen(!fullscreen))
        .then(setFull)
        .catch(() => undefined)
        .finally(() => {
          transitionBusyRef.current = false;
          revealControls();
        });
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  }, [containerRef, nativeFullscreen, port, revealControls]);

  return { full, fullRef, setFull, toggleFull, exitMpvFullscreen };
}
