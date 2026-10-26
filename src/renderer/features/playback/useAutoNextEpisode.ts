import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  EMPTY_AUTO_NEXT_EPISODE_STATE,
  transitionAutoNextEpisode,
  type AutoNextEpisodeEffect,
  type AutoNextEpisodeEvent,
} from './application/autoNextEpisodeState';

interface UseAutoNextEpisodeOptions {
  canNext: boolean;
  immediate?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  isPaused: () => boolean;
  pause: () => void;
}

export function useAutoNextEpisode({ canNext, onPrev, onNext, isPaused, pause, immediate = false }: UseAutoNextEpisodeOptions) {
  const [state, setState] = useState(EMPTY_AUTO_NEXT_EPISODE_STATE);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canNextRef = useRef(canNext);
  const onPrevRef = useRef(onPrev);
  const onNextRef = useRef(onNext);
  useLayoutEffect(() => {
    canNextRef.current = canNext;
    onPrevRef.current = onPrev;
    onNextRef.current = onNext;
  }, [canNext, onPrev, onNext]);

  const dispatch = useCallback((event: AutoNextEpisodeEvent): AutoNextEpisodeEffect[] => {
    const transition = transitionAutoNextEpisode(stateRef.current, event);
    stateRef.current = transition.state;
    setState(transition.state);
    return transition.effects;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const runEffects = useCallback((effects: AutoNextEpisodeEffect[]) => {
    if (effects.includes('clear-timer')) clearTimer();
    if (effects.includes('schedule-countdown')) {
      timerRef.current = setInterval(() => {
        const tickEffects = dispatch({ type: 'countdown-tick' });
        if (tickEffects.includes('clear-timer')) clearTimer();
        if (tickEffects.includes('advance')) onNextRef.current?.();
      }, 1000);
    }
    if (effects.includes('advance')) onNextRef.current?.();
    if (effects.includes('pause')) pause();
  }, [clearTimer, dispatch, pause]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const clear = useCallback(() => {
    runEffects(dispatch({ type: 'clear' }));
  }, [dispatch, runEffects]);

  const startCountdown = useCallback(() => {
    runEffects(dispatch({ type: 'start-countdown' }));
  }, [dispatch, runEffects]);

  const canAdvance = useCallback(() => canNextRef.current && !!onNextRef.current, []);
  const advance = useCallback(() => {
    const next = onNextRef.current;
    if (!next) return false;
    clear();
    next();
    return true;
  }, [clear]);

  const handlePlaybackEnd = useCallback(() => {
    runEffects(dispatch({ type: 'playback-ended', canAdvance: canAdvance(), immediate }));
  }, [canAdvance, dispatch, immediate, runEffects]);

  const cancelCountdown = useCallback(() => {
    runEffects(dispatch({ type: 'cancel-countdown', isPaused: isPaused() }));
  }, [dispatch, isPaused, runEffects]);

  const handlePrev = useCallback(() => {
    clear();
    onPrevRef.current?.();
  }, [clear]);

  const handleNext = useCallback(() => {
    clear();
    onNextRef.current?.();
  }, [clear]);

  return {
    nextCount: state.nextCount,
    endAll: state.endAll,
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
