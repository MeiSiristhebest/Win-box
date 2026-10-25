import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { PlayerKeyboardShortcutEvent, PlayerKeyboardShortcutsPorts } from './application/playerKeyboardShortcuts';
interface PlayerKeyboardShortcutsOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  isMpv: () => boolean;
  isPaused: () => boolean;
  play: () => void;
  pause: () => void;
  getTime: () => number;
  getDuration: () => number;
  seek: (seconds: number) => void;
  getVolume: () => number;
  setVolume: (volume: number) => void;
  showVolume: () => void;
  revealControls: () => void;
  exitMpvFullscreen: () => void;
  shouldExitFullscreen?: () => boolean;
  setBoost?: (on: boolean) => void;
  onStepSubtitleOffset?: (delta: -0.5 | 0.5) => void;
  onToggleDanmaku?: () => void;
}


export function usePlayerKeyboardShortcuts(
  options: PlayerKeyboardShortcutsOptions,
  ports: PlayerKeyboardShortcutsPorts,
): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    let holdTimer: unknown = null;
    let boostTimer: unknown = null;
    const clear = () => {
      if (holdTimer !== null) ports.scheduler.cancelInterval(holdTimer);
      if (boostTimer !== null) ports.scheduler.cancelTimeout(boostTimer);
      holdTimer = null; boostTimer = null; latest.current.setBoost?.(false);
    };
    const onKeyDown = (event: PlayerKeyboardShortcutEvent) => {
      const current = latest.current;
      if (ports.modalGuard.hasBlockingModal()) { clear(); return; }
      if (event.targetIsEditable) return;
      if ((!current.videoRef.current && !current.isMpv()) || event.repeat) return;
      if (event.key === 'Escape' && (current.shouldExitFullscreen?.() ?? current.isMpv())) { current.exitMpvFullscreen(); return; }
      if (event.key === ' ') {
        event.preventDefault(); if (current.isPaused()) current.play(); else current.pause();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); clear();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const seek = (seconds: number) => {
          const value = latest.current, duration = value.getDuration();
          value.seek(Math.max(0, Math.min(value.getTime() + seconds, duration > 0 ? duration : Infinity)));
        };
        seek(direction * 5);
        if (direction > 0 && current.setBoost) boostTimer = ports.scheduler.scheduleTimeout(() => { boostTimer = null; latest.current.setBoost?.(true); }, 500);
        else holdTimer = ports.scheduler.scheduleInterval(() => seek(direction * 2), 40);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        current.setVolume(Math.max(0, Math.min(1, current.getVolume() + (event.key === 'ArrowUp' ? 0.05 : -0.05))));
        current.showVolume(); current.revealControls();
      } else if (event.key === '[' || event.key === '【') {
        event.preventDefault();
        current.onStepSubtitleOffset?.(-0.5);
        current.revealControls();
      } else if (event.key === ']' || event.key === '】') {
        event.preventDefault();
        current.onStepSubtitleOffset?.(0.5);
        current.revealControls();
      } else if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        current.onToggleDanmaku?.();
        current.revealControls();
      }
    };
    const onKeyUp = (event: PlayerKeyboardShortcutEvent) => {
      if (ports.modalGuard.hasBlockingModal() || event.key === 'ArrowLeft' || event.key === 'ArrowRight') clear();
    };
    const unsubscribe = ports.events.subscribe({ onKeyDown, onKeyUp, onWindowBlur: clear });
    return () => { unsubscribe(); clear(); };
  }, [ports]);
}
