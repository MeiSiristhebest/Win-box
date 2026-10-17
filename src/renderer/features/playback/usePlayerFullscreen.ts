import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { Kernel } from '../../lib/kernel';

interface UsePlayerFullscreenOptions {
  allowMpv: boolean;
  nativeWindow?: boolean;
  kernel: Kernel;
  mini: boolean;
  containerRef: { current: HTMLDivElement | null };
  revealControls: () => void;
}

let lastNativeFullscreen = false;

export function usePlayerFullscreen({
  allowMpv,
  nativeWindow,
  kernel,
  mini,
  containerRef,
  revealControls,
}: UsePlayerFullscreenOptions) {
  const nativeFullscreen = nativeWindow ?? (allowMpv && kernel === 'mpv');
  const [full, setFull] = useState(nativeWindow ? lastNativeFullscreen : false);
  const fullRef = useRef(full);
  useLayoutEffect(() => { fullRef.current = full; if (nativeWindow) lastNativeFullscreen = full; }, [full, nativeWindow]);
  const transitionBusyRef = useRef(false);

  useEffect(() => {
    if (!mini) return;
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false)).catch(() => undefined);
    else if (nativeFullscreen && fullRef.current) void client.playerSetFullscreen(false).then(() => setFull(false)).catch(() => undefined);
  }, [mini, nativeFullscreen]);

  useEffect(() => {
    if (!nativeFullscreen) return;
    let active = true;
    const unsubscribe = client.playerOnFullscreen(setFull);
    void client.playerIsFullscreen()
      .then((state) => {
        if (active) setFull(!!state.fullscreen);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [nativeFullscreen]);

  useEffect(() => {
    if (nativeFullscreen) return;
    const syncWindowResize = () => {
      const active = !!document.fullscreenElement;
      setFull(active);
      void client.playerSetResizable(!active).catch(() => undefined);
    };
    document.addEventListener('fullscreenchange', syncWindowResize);
    syncWindowResize();
    return () => {
      document.removeEventListener('fullscreenchange', syncWindowResize);
      void client.playerSetResizable(true).catch(() => undefined);
    };
  }, [nativeFullscreen]);

  useEffect(() => {
    const root = document.documentElement;
    if (full) root.dataset.playerFullscreen = '1';
    else delete root.dataset.playerFullscreen;
    return () => {
      if (!nativeWindow) delete root.dataset.playerFullscreen;
    };
  }, [full, nativeWindow]);

  const exitMpvFullscreen = useCallback(() => {
    void client.playerSetFullscreen(false)
      .then((state) => setFull(!!state.fullscreen))
      .catch(() => undefined);
  }, []);

  const toggleFull = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (nativeFullscreen) {
      if (transitionBusyRef.current) return;
      transitionBusyRef.current = true;
      void client.playerIsFullscreen()
        .then((state) => client.playerSetFullscreen(!state.fullscreen))
        .then((state) => setFull(!!state.fullscreen))
        .catch(() => undefined)
        .finally(() => {
          transitionBusyRef.current = false;
          revealControls();
        });
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  }, [containerRef, nativeFullscreen, revealControls]);

  return { full, fullRef, setFull, toggleFull, exitMpvFullscreen };
}
