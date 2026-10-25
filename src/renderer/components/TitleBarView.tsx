import type { CSSProperties } from 'react';

export interface TitleBarViewProps {
  title?: string;
  appIcon: string;
  maximized: boolean;
  showMini?: boolean;
  mini?: boolean;
  onMiniToggle?: () => void;
  showPin?: boolean;
  pinTop?: boolean;
  onPinToggle?: () => void;
  variant?: 'win' | 'mac';
  onMinimize(): void;
  onMaximizeToggle(): void;
  onClose(): void;
}

/** Passive custom title bar. Window operations and app icon loading are supplied by the caller. */
export default function TitleBarView({
  title = 'Win-Box',
  appIcon,
  maximized,
  showMini = false,
  mini = false,
  onMiniToggle,
  showPin = false,
  pinTop = false,
  onPinToggle,
  variant = 'win',
  onMinimize,
  onMaximizeToggle,
  onClose,
}: TitleBarViewProps) {
  const playerWindowIconStyle: CSSProperties | undefined = showMini
    ? { width: 32, height: 32, minWidth: 32, minHeight: 32, flex: '0 0 32px', display: 'block' }
    : undefined;

  if (variant === 'mac') {
    return (
      <div className="titlebar ap-titlebar" onDoubleClick={onMaximizeToggle} style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
        <div className="ap-lights" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <button className="ap-light ap-light-close" title="关闭" aria-label="关闭" onClick={onClose}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.6 1.6l4.8 4.8M6.4 1.6L1.6 6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className="ap-light ap-light-min" title="最小化" aria-label="最小化" onClick={onMinimize}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true"><path d="M1.2 4h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button className="ap-light ap-light-zoom" title={maximized ? '还原' : '最大化'} aria-label="最大化" onClick={onMaximizeToggle}>
            <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
              <path d="M1.5 3V1.5H3M6.5 5v1.5H5M1.5 5v1.5H3M6.5 3V1.5H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`titlebar${showMini ? ' player-titlebar' : ''}`} onDoubleClick={onMaximizeToggle} style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
      <div className="tb-title" title={title}>
        {appIcon ? <img className="tb-ico" src={appIcon} alt="" draggable={false} /> : <span className="tb-dot" />}
        <span className="tb-text">{title}</span>
      </div>
      <div className="tb-controls" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        {showPin && (
          <button
            className={`tb-btn tb-pin${pinTop ? ' tb-pin-on' : ''}`}
            title={pinTop ? '置顶：开（点击取消）' : '置顶：关（点击把窗口固定在最上层）'}
            aria-label={pinTop ? '取消置顶' : '窗口置顶'}
            aria-pressed={pinTop}
            onClick={onPinToggle}
          >
            {pinTop ? (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M9.6 3h4.8l.7 6.1 3.1 3.1V14H5.8v-1.8l3.1-3.1L9.6 3Z" />
                <path d="M12 14v6.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.6 3h4.8l.7 6.1 3.1 3.1V14H5.8v-1.8l3.1-3.1L9.6 3Z" />
                <path d="M12 14v6.6" />
              </svg>
            )}
          </button>
        )}
        <button className="tb-btn" aria-label="最小化" title="最小化" onClick={onMinimize}>
          <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {showMini && (
          <button className="tb-btn" aria-label={mini ? '恢复原窗口' : '小窗口'} title={mini ? '恢复原窗口' : '小窗口'} onClick={onMiniToggle}>
            {mini ? (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M6.5 9.5V6.5h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 6.5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2.5" y="4" width="10" height="9.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <rect x="7" y="7.5" width="6.5" height="5.5" rx=".8" fill="currentColor" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
        )}
        {!mini && (
          <button className="tb-btn" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} onClick={onMaximizeToggle}>
            {maximized ? (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true">
                <rect x="3" y="6.5" width="9" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M6.5 3.5h6a0 0 0 0 1 0 0v6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="2" />
              </svg>
            ) : (
              <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            )}
          </button>
        )}
        <button className="tb-btn tb-close" aria-label="关闭" title="关闭" onClick={onClose}>
          <svg width="20" height="20" style={playerWindowIconStyle} viewBox="0 0 16 16" aria-hidden="true"><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}
