import { useState } from 'react';
import { client } from '../../api/client';
import { parseCastTarget, type DlnaDevice } from '../../../shared/dlna';

interface DlnaCastControlProps {
  url: string;
  resourceName?: string;
  getCurrentTime: () => number;
}

export function DlnaCastControl({ url, resourceName, getCurrentTime }: DlnaCastControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<DlnaDevice[]>([]);
  const [message, setMessage] = useState('');

  async function searchDevices() {
    setBusy(true);
    setMessage('正在搜索局域网设备…');
    setDevices([]);
    try {
      const found = await client.dlnaDiscover();
      setDevices(found);
      setMessage(found.length ? '' : '没有发现可投屏设备（电视需支持 DLNA/UPnP，且与本机在同一局域网）');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    void searchDevices();
  }

  async function castTo(device: DlnaDevice) {
    setBusy(true);
    setMessage('');
    try {
      const positionMs = Math.round(getCurrentTime() * 1000);
      const target = parseCastTarget(url, resourceName || 'Win-Box 投屏', positionMs);
      if (target.localRelay) setMessage('⚠ 该地址是本机中继（BT / 蜘蛛代理），电视端可能拉不到流，仍尝试投送…');
      const result = await client.dlnaCast({ device, target });
      setMessage(result.ok ? '已投到「' + (result.device || device.name) + '」' : (result.error || '投屏失败'));
      if (result.ok) window.setTimeout(() => setOpen(false), 1200);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={'vp-cast' + (open ? ' open' : '')}>
      <div className={'vp-cpanel' + (open ? ' open' : '')}>
        <div className="vp-cpct">{busy ? '搜索中…' : '投屏到'}</div>
        {devices.map((device) => (
          <button key={device.udn} className="vp-citem" disabled={busy} onClick={() => void castTo(device)} title={device.location}>
            {device.name}
          </button>
        ))}
        {message && <div className="vp-cmsg">{message}</div>}
        <button className="vp-citem vp-crefresh" disabled={busy} onClick={() => void searchDevices()}>重新搜索</button>
      </div>
      <button className="vp-ctl" title="投屏（DLNA）" aria-label="投屏（DLNA）" onClick={toggle}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11A2.5 2.5 0 0 1 18.5 20h-5" />
          <path d="M3 14.6a5.9 5.9 0 0 1 5.9 5.9" />
          <path d="M3 10.6a9.9 9.9 0 0 1 9.9 9.9" />
          <circle cx="3.6" cy="20.4" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
