import type { PlayerVolumeModel } from './presentation/PlayerControlModels';
import type { CSSProperties, FocusEvent } from 'react';

type PlayerVolumeControlProps = PlayerVolumeModel;
function handleBlur(event: FocusEvent<HTMLDivElement>, onFocusChange: (focused: boolean) => void) {
  const next = event.relatedTarget as Node | null;
  if (!next || !event.currentTarget.contains(next)) onFocusChange(false);
}

export function PlayerVolumeControl({
  volume,
  open,
  hidden,
  inputRef,
  onFocusChange,
  onPointerEnter,
  onPointerLeave,
  onChange,
  onPointerStart,
  onPointerEnd,
  onToggleMute,
}: PlayerVolumeControlProps) {
  return (
    <div
      className={`vp-vol${open ? ' open' : ''}`}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => handleBlur(event, onFocusChange)}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className={`vp-vpanel${open ? ' open' : ''}`} style={{ visibility: hidden ? 'hidden' : undefined }}>
        <div className="vp-vpct">{Math.round(volume * 100)}%</div>
        <div className="vp-vtrack-wrap">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            ref={inputRef}
            className="vp-vtrack"
            style={{ '--volume': `${volume * 100}%` } as CSSProperties}
            tabIndex={open ? 0 : -1}
            aria-label="音量"
            aria-orientation="vertical"
            onChange={(event) => onChange(Number(event.currentTarget.value) / 100)}
            onPointerDown={onPointerStart}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          />
        </div>
      </div>
      <button
        className="vp-ctl"
        title={volume > 0 ? '静音' : '取消静音'}
        aria-label={volume > 0 ? '静音' : '取消静音'}
        onClick={onToggleMute}
      >
        {volume === 0 ? (
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        ) : volume < 0.5 ? (
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 9.5a3.5 3.5 0 010 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="M16 8.5a4.5 4.5 0 010 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        )}
      </button>
    </div>
  );
}
