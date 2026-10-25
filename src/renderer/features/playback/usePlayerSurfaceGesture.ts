import { useCallback, useLayoutEffect, useRef } from 'react';
import { createPlayerSurfaceGesture } from './application/playerSurfaceGesture';

interface PlayerSurfaceGestureOptions {
  mini: boolean;
  onTogglePlayback(): void;
  shouldIgnoreClick(): boolean;
}

/** React and browser timer adapter for the framework-independent surface gesture. */
export function usePlayerSurfaceGesture(options: PlayerSurfaceGestureOptions) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });

  const controller = useRef<ReturnType<typeof createPlayerSurfaceGesture> | null>(null);
  useLayoutEffect(() => {
    const gesture = createPlayerSurfaceGesture({
      schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
      cancel: (timer) => window.clearTimeout(timer as number),
      togglePlayback: () => latest.current.onTogglePlayback(),
    });
    controller.current = gesture;
    return () => {
      gesture.dispose();
      if (controller.current === gesture) controller.current = null;
    };
  }, []);

  return useCallback(() => {
    const current = latest.current;
    controller.current?.click({ mini: current.mini, ignored: current.shouldIgnoreClick() });
  }, []);
}
