import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UsePlayerControlsVisibilityOptions {
  isPaused: () => boolean;
  panelOpen: boolean;
  hideDelayMs?: number;
}

export function usePlayerControlsVisibility({
  isPaused,
  panelOpen,
  hideDelayMs = 2800,
}: UsePlayerControlsVisibilityOptions) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(isPaused);
  const panelOpenRef = useRef(panelOpen);

  useLayoutEffect(() => {
    isPausedRef.current = isPaused;
    panelOpenRef.current = panelOpen;
  }, [isPaused, panelOpen]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimer();
    if (panelOpenRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!isPausedRef.current()) setVisible(false);
    }, hideDelayMs);
  }, [clearTimer, hideDelayMs]);

  const reveal = useCallback(() => {
    setVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const hideIfNoPanel = useCallback(() => {
    if (!panelOpenRef.current) setVisible(false);
  }, []);

  useEffect(() => {
    if (panelOpen) clearTimer();
    else scheduleHide();
    return clearTimer;
  }, [panelOpen, clearTimer, scheduleHide]);

  return { visible: visible || panelOpen, reveal, hideIfNoPanel };
}
