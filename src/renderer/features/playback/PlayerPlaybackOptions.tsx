import type { FitControlModel, PlaybackRateControlModel } from './presentation/PlayerControlModels';
import { useCallback, useState, type KeyboardEvent } from 'react';
import { PLAYER_FITS } from './application/playerPreferences';
import { usePlaybackPopupKeyboard } from './usePlaybackPopupKeyboard';

type PlayerRateControlProps = PlaybackRateControlModel;
type PlayerFitControlProps = FitControlModel;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function PlayerRateControl({ rate, onRateChange }: PlayerRateControlProps) {
  const [open, setOpen] = useState(false);
  const openMenu = useCallback(() => setOpen(true), []);
  const closeMenu = useCallback(() => setOpen(false), []);
  const { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur } = usePlaybackPopupKeyboard(open, openMenu, closeMenu);

  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  };

  return (
    <div className={`vp-rate-host${open ? ' open' : ''}`} onPointerEnter={(event) => { if (event.pointerType === 'mouse') openMenu(); }} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="vp-ctl vp-rate"
        title={`播放速度：${rate}x`}
        aria-label={`播放速度：${rate}倍`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts="ArrowDown"
        onKeyDown={onKeyDown}
        onClick={openMenu}
      >
        <span>{rate}x</span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div id={panelId} className="vp-rate-menu" role="menu" tabIndex={-1} aria-label="播放速度" aria-hidden={!open} onKeyDown={moveSelection}>
        {PLAYBACK_RATES.map((option) => {
          const selected = rate === option;
          return (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              tabIndex={open && selected ? 0 : -1}
              className={`vp-rate-option${selected ? ' selected' : ''}`}
              onClick={() => { onRateChange(option); closeMenu(); triggerRef.current?.focus(); }}
            >
              <span>{option}x</span>
              {selected && <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PlayerFitControl({
  fit,
  open,
  onFitSelect,
  onFitOpen,
  onFitPointerEnter,
  onFitPointerLeave,
}: PlayerFitControlProps) {
  const fitLabel = PLAYER_FITS.find((option) => option.value === fit)?.label ?? '适应';
  const { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur } = usePlaybackPopupKeyboard(open, onFitOpen, onFitPointerLeave);

  return (
    <div className="vp-vol" onPointerEnter={onFitPointerEnter} onPointerLeave={onPointerLeave} onBlur={onBlur}>
        <button ref={triggerRef} className="vp-ctl" title={`画面比例：${fitLabel}（悬停选择）`} aria-label={`画面比例：${fitLabel}`} aria-expanded={open} aria-controls={panelId} aria-keyshortcuts="ArrowDown" onKeyDown={onKeyDown} onClick={onFitOpen}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <rect x="2.6" y="5" width="18.8" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8.4 5v14M15.6 5v14" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 2" />
          </svg>
          {fit !== 'contain' && <span className="vp-subdot" />}
        </button>
        <div className={`vp-fithost${open ? ' open' : ''}`}>
          <div id={panelId} className="vp-subpanel vp-fitpanel">
            <div className="vsp-row" style={{ marginBottom: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>画面比例（会记住选择；强制比例为拉伸显示）</span>
            </div>
            <div className="vsp-fits">
              {PLAYER_FITS.map((option) => (
                <button
                  key={option.value}
                  className={`vsp-btn${fit === option.value ? ' active' : ''}`}
                  onClick={() => { onFitSelect(option.value); onFitPointerLeave(); triggerRef.current?.focus(); }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
    </div>
  );
}
