import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';
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
}


export function usePlayerKeyboardShortcuts(options: PlayerKeyboardShortcutsOptions): void {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    let holdTimer: ReturnType<typeof setInterval> | null = null;
    let boostTimer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (holdTimer) clearInterval(holdTimer);
      if (boostTimer) clearTimeout(boostTimer);
      holdTimer = null; boostTimer = null; latest.current.setBoost?.(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (isNativeModalOpen()) { clear(); return; }
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
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
        if (direction > 0 && current.setBoost) boostTimer = setTimeout(() => { boostTimer = null; latest.current.setBoost?.(true); }, 500);
        else holdTimer = setInterval(() => seek(direction * 2), 40);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        current.setVolume(Math.max(0, Math.min(1, current.getVolume() + (event.key === 'ArrowUp' ? 0.05 : -0.05))));
        current.showVolume(); current.revealControls();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isNativeModalOpen() || event.key === 'ArrowLeft' || event.key === 'ArrowRight') clear();
    };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', clear); clear(); };
  }, []);
}
