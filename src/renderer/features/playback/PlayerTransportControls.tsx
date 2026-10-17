interface PlayerTransportControlsProps {
  mini: boolean;
  paused: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}

export function PlayerTransportControls({ mini, paused, canPrev, canNext, onPrev, onNext, onToggle }: PlayerTransportControlsProps) {
  const navIconSize = mini ? 16 : 15;
  const playIconSize = mini ? 18 : 15;

  return (
    <>
      {(canPrev !== undefined || canNext !== undefined) && (
        <button className="vp-ctl vp-nav" onClick={onPrev} disabled={!canPrev} title={canPrev ? '上一集' : '已是第一集'} aria-label={canPrev ? '上一集' : '已是第一集'}>
          <svg width={navIconSize} height={navIconSize} viewBox="0 0 24 24"><path d="M6 5v14M19 5.5v13l-11-6.5z" fill="currentColor" /></svg>
        </button>
      )}
      <button className="vp-ctl" onClick={onToggle} title={paused ? '播放' : '暂停'}>
        {paused ? (
          <svg width={playIconSize} height={playIconSize} viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
        ) : (
          <svg width={playIconSize} height={playIconSize} viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor" /></svg>
        )}
      </button>
      {(canPrev !== undefined || canNext !== undefined) && (
        <button className="vp-ctl vp-nav" onClick={onNext} disabled={!canNext} title={canNext ? '下一集' : '已是最后一集'} aria-label={canNext ? '下一集' : '已是最后一集'}>
          <svg width={navIconSize} height={navIconSize} viewBox="0 0 24 24"><path d="M18 5v14M5 5.5v13l11-6.5z" fill="currentColor" /></svg>
        </button>
      )}
    </>
  );
}
