import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

interface PlayerProgressBarProps {
  currentTime: number;
  duration: number;
  buffered: number;
  canSeek: () => boolean;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, time: number | null) => boolean;
}

interface ProgressHover {
  x: number;
  time: number;
}

export function PlayerProgressBar({
  currentTime,
  duration,
  buffered,
  canSeek,
  getCurrentTime,
  seekTo,
  formatTime,
  onContextMenu,
}: PlayerProgressBarProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const seekDragRef = useRef(false);
  const [hover, setHover] = useState<ProgressHover | null>(null);
  const latestRef = useRef({ currentTime, duration, buffered, canSeek, getCurrentTime, seekTo, formatTime, onContextMenu });

  useEffect(() => {
    latestRef.current = { currentTime, duration, buffered, canSeek, getCurrentTime, seekTo, formatTime, onContextMenu };
  });

  const timeAtX = (clientX: number): number | null => {
    const element = progressRef.current;
    const state = latestRef.current;
    if (!element || !state.duration) return null;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(state.duration, Math.max(0, Math.round(ratio * state.duration)));
  };

  const seekAtX = (clientX: number) => {
    const time = timeAtX(clientX);
    const state = latestRef.current;
    if (time == null || !state.canSeek()) return;
    state.seekTo(Math.min(state.duration, Math.max(0, time)));
  };

  const hoverAt = (clientX: number) => {
    const element = progressRef.current;
    const time = timeAtX(clientX);
    if (!element || time == null) {
      setHover(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setHover({ x: Math.min(Math.max(clientX - rect.left, 22), Math.max(rect.width - 22, 22)), time });
  };

  useEffect(() => {
    const element = progressRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = latestRef.current;
      if (!state.duration || !state.canSeek()) return;
      const next = Math.round(state.getCurrentTime()) + (event.deltaY < 0 ? 1 : -1);
      state.seekTo(Math.min(state.duration, Math.max(0, next)));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    seekDragRef.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Ignore unavailable pointer capture. */ }
    hoverAt(event.clientX);
    seekAtX(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    hoverAt(event.clientX);
    if (seekDragRef.current) seekAtX(event.clientX);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    seekDragRef.current = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Ignore unavailable pointer capture. */ }
  };

  return (
    <div
      ref={progressRef}
      className="vp-progress"
      style={{ cursor: 'pointer' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { seekDragRef.current = false; }}
      onPointerLeave={() => { if (!seekDragRef.current) setHover(null); }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (latestRef.current.onContextMenu(event, timeAtX(event.clientX))) setHover(null);
      }}
    >
      <div className="vp-buffer" style={{ width: duration ? `${(buffered / duration) * 100}%` : '0%' }} />
      <div className="vp-played" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
      {hover && (
        <>
          <div className="vp-hline" style={{ left: hover.x }} />
          <div className="vp-htip" style={{ left: hover.x }}>{formatTime(hover.time)}</div>
        </>
      )}
      <div className="vp-thumb" style={{ left: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
    </div>
  );
}
