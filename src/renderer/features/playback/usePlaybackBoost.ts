import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { isNativeModalOpen } from '../../lib/modalScope';

export function usePlaybackBoost(rate: number, applyRate: (rate: number) => void, mini: boolean, url: string) {
  const options = useRef({ rate, applyRate });
  useLayoutEffect(() => { options.current = { rate, applyRate }; }, [rate, applyRate]);
  const active = useRef(false);
  const ateClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState(0);
  const setBoost = useCallback((on: boolean) => {
    if (active.current === on) return;
    active.current = on;
    options.current.applyRate(on ? 1.5 : options.current.rate);
    setTip(on ? 1.5 : 0);
  }, []);
  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBoost(false);
  }, [setBoost]);
  useEffect(() => {
    window.addEventListener('mouseup', release, true);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('mouseup', release, true); window.removeEventListener('blur', release); release(); };
  }, [url, release]);
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || mini || isNativeModalOpen()) return;
    release();
    timer.current = setTimeout(() => { timer.current = null; ateClick.current = true; setBoost(true); }, 450);
  };
  const consumeClick = () => { const consumed = ateClick.current; ateClick.current = false; return consumed; };
  return { tip, setBoost, onMouseDown, consumeClick, release };
}
