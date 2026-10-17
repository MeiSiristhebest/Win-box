import { PLAYER_FITS, type PlayerFit } from '../../lib/playerPrefs';

interface PlayerRateControlProps {
  rate: number;
  onRateChange: (rate: number) => void;
}

interface PlayerFitControlProps {
  fit: PlayerFit;
  open: boolean;
  onFitSelect: (fit: PlayerFit) => void;
  onFitOpen: () => void;
  onFitPointerEnter: () => void;
  onFitPointerLeave: () => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function PlayerRateControl({ rate, onRateChange }: PlayerRateControlProps) {
  return (
    <select className="vp-rate" value={rate} title="倍速" onChange={(event) => onRateChange(Number(event.currentTarget.value))}>
      {PLAYBACK_RATES.map((option) => <option key={option} value={option}>{option}x</option>)}
    </select>
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

  return (
    <div className="vp-vol" onPointerEnter={onFitPointerEnter} onPointerLeave={onFitPointerLeave}>
        <button className="vp-ctl" title={`画面比例：${fitLabel}（悬停选择）`} onClick={onFitOpen}>
          <svg width="15" height="15" viewBox="0 0 24 24">
            <rect x="2.6" y="5" width="18.8" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8.4 5v14M15.6 5v14" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 2" />
          </svg>
          {fit !== 'contain' && <span className="vp-subdot" />}
        </button>
        <div className={`vp-fithost${open ? ' open' : ''}`}>
          <div className="vp-subpanel vp-fitpanel">
            <div className="vsp-row" style={{ marginBottom: 6 }}>
              <span className="muted" style={{ fontSize: 11 }}>画面比例（会记住选择；强制比例为拉伸显示）</span>
            </div>
            <div className="vsp-fits">
              {PLAYER_FITS.map((option) => (
                <button
                  key={option.value}
                  className={`vsp-btn${fit === option.value ? ' active' : ''}`}
                  onClick={() => onFitSelect(option.value)}
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
