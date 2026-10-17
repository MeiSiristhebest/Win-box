import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface UseAutoNextEpisodeOptions {
  canNext: boolean;
  immediate?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  isPaused: () => boolean;
  pause: () => void;
}

export function useAutoNextEpisode({ canNext, onPrev, onNext, isPaused, pause, immediate = false }: UseAutoNextEpisodeOptions) {
  const [nextCount, setNextCount] = useState<number | null>(null);
  const [endAll, setEndAll] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canNextRef = useRef(canNext);
  const onNextRef = useRef(onNext);
  useLayoutEffect(() => {
    canNextRef.current = canNext;
    onNextRef.current = onNext;
  }, [canNext, onNext]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const clear = useCallback(() => {
    clearTimer();
    setNextCount(null);
    setEndAll(false);
  }, [clearTimer]);

  const startCountdown = useCallback(() => {
    clear();
    let remaining = 5;
    setNextCount(remaining);
    timerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clear();
        onNextRef.current?.();
      } else {
        setNextCount(remaining);
      }
    }, 1000);
  }, [clear]);

  const canAdvance = useCallback(() => canNextRef.current && !!onNextRef.current, []);
  const advance = useCallback(() => {
    const next = onNextRef.current;
    if (!next) return false;
    clear();
    next();
    return true;
  }, [clear]);

  const handlePlaybackEnd = useCallback(() => {
    if (canAdvance()) { if (immediate) advance(); else startCountdown(); }
    else setEndAll(true);
  }, [canAdvance, startCountdown, immediate, advance]);

  const cancelCountdown = useCallback(() => {
    clear();
    if (!isPaused()) pause();
  }, [clear, isPaused, pause]);

  const handlePrev = useCallback(() => {
    clear();
    onPrev?.();
  }, [clear, onPrev]);

  const handleNext = useCallback(() => {
    clear();
    onNext?.();
  }, [clear, onNext]);

  return {
    nextCount,
    endAll,
    clear,
    startCountdown,
    handlePlaybackEnd,
    cancelCountdown,
    handlePrev,
    handleNext,
    canAdvance,
    advance,
  };
}
