import { useEffect, useState } from 'react';

export function PlayerInfoOverlay({ open, title, currentTime, duration, resolution, formatTime }: {
  open: boolean; title?: string; currentTime: number; duration: number; resolution: string; formatTime(seconds: number): string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, [open]);
  if (!open) return null;
  return (
    <div className="vp-info">
      {title?.trim() && <div className="vp-info-name" title={title.trim()}>{title.trim()}</div>}
      <div className="vp-info-row">{formatTime(currentTime)}/{formatTime(duration)}</div>
      {resolution && <div className="vp-info-row">{resolution}</div>}
      <div className="vp-info-row">{now.getHours()}点{String(now.getMinutes()).padStart(2, '0')}分</div>
    </div>
  );
}
