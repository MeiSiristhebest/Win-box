import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  progressHoverOffset,
  progressTimeAtPointer,
  projectProgressPercentages,
  type ProgressTrackBounds,
} from './application/playerProgressGeometry';
import type { PointerCoordinates, PlayerProgressBarModel } from './presentation/PlayerControlModels';

export interface ProgressPointerSample {
  clientX: number;
  bounds: ProgressTrackBounds;
}

export interface ProgressPointerDownSample extends ProgressPointerSample {
  button: number;
}

export interface ProgressHover {
  x: number;
  time: number;
  label: string;
}

/** Owns progress interaction state; the view adapts DOM events and measurements into samples. */
export function usePlayerProgressBarPresenter(model: PlayerProgressBarModel) {
  const latest = useRef(model);
  useLayoutEffect(() => {
    latest.current = model;
  });
  const seeking = useRef(false);
  const [hover, setHover] = useState<ProgressHover | null>(null);

  const timeAtPointer = useCallback(({ clientX, bounds }: ProgressPointerSample): number | null => (
    progressTimeAtPointer(clientX, bounds, latest.current.duration)
  ), []);

  const seekAtPointer = useCallback((sample: ProgressPointerSample) => {
    const time = timeAtPointer(sample);
    const state = latest.current;
    if (time == null || !state.canSeek()) return;
    state.seekTo(time);
  }, [timeAtPointer]);

  const updateHover = useCallback((sample: ProgressPointerSample) => {
    const time = timeAtPointer(sample);
    const x = progressHoverOffset(sample.clientX, sample.bounds);
    setHover(x == null || time == null ? null : { x, time, label: latest.current.formatTime(time) });
  }, [timeAtPointer]);

  const onPointerDown = useCallback((sample: ProgressPointerDownSample): boolean => {
    if (sample.button !== 0) return false;
    seeking.current = true;
    updateHover(sample);
    seekAtPointer(sample);
    return true;
  }, [seekAtPointer, updateHover]);

  const onPointerMove = useCallback((sample: ProgressPointerSample) => {
    updateHover(sample);
    if (seeking.current) seekAtPointer(sample);
  }, [seekAtPointer, updateHover]);

  const onPointerUp = useCallback((): boolean => {
    const wasSeeking = seeking.current;
    seeking.current = false;
    return wasSeeking;
  }, []);

  const onPointerCancel = useCallback(() => {
    seeking.current = false;
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!seeking.current) setHover(null);
  }, []);

  const onWheel = useCallback((deltaY: number) => {
    const state = latest.current;
    if (!state.duration || !state.canSeek()) return;
    const next = Math.round(state.getCurrentTime()) + (deltaY < 0 ? 1 : -1);
    state.seekTo(Math.min(state.duration, Math.max(0, next)));
  }, []);

  const onContextMenu = useCallback((position: PointerCoordinates, sample: ProgressPointerSample): boolean => {
    const handled = latest.current.onContextMenu(position, timeAtPointer(sample));
    if (handled) setHover(null);
    return handled;
  }, [timeAtPointer]);

  return {
    progress: projectProgressPercentages(model.currentTime, model.buffered, model.duration),
    hover,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onWheel,
    onContextMenu,
  };
}
