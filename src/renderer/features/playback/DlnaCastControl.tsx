import type { DlnaCastControlModel } from './presentation/PlayerControlModels';

type DlnaCastControlProps = DlnaCastControlModel;
export function DlnaCastControl({ open, busy, devices, message, onToggle, onRefresh, onCast }: DlnaCastControlProps) {
  return (
    <div className={'vp-cast' + (open ? ' open' : '')}>
      <div className={'vp-cpanel' + (open ? ' open' : '')}>
        <div className="vp-cpct">{busy ? '处理中…' : '投屏到'}</div>
        {devices.map((device) => (
          <button key={device.udn} className="vp-citem" disabled={busy} onClick={() => void onCast(device)} title={device.location}>
            {device.name}
          </button>
        ))}
        {message && <div className="vp-cmsg">{message}</div>}
        <button className="vp-citem vp-crefresh" disabled={busy} onClick={() => void onRefresh()}>重新搜索</button>
      </div>
      <button className="vp-ctl" title="投屏（DLNA）" aria-label="投屏（DLNA）" aria-expanded={open} onClick={onToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11A2.5 2.5 0 0 1 18.5 20h-5" />
          <path d="M3 14.6a5.9 5.9 0 0 1 5.9 5.9" />
          <path d="M3 10.6a9.9 9.9 0 0 1 9.9 9.9" />
          <circle cx="3.6" cy="20.4" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
