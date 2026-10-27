import type { FitControlModel, PlaybackRateControlModel } from './presentation/PlayerControlModels';
import { PLAYER_FITS } from './application/playerPreferences';
import { PlayerRateControlView } from './PlayerRateControlView';
import { usePlayerRateControlPresenter } from './usePlayerRateControlPresenter';
import { usePlaybackPopupKeyboard } from './usePlaybackPopupKeyboard';

type PlayerFitControlProps = FitControlModel;

export function PlayerRateControl(props: PlaybackRateControlModel) {
  const model = usePlayerRateControlPresenter(props);
  return <PlayerRateControlView {...model} />;
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
                  type="button"
                  className={`vsp-btn${fit === option.value ? ' active' : ''}`}
                  aria-pressed={fit === option.value}
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
