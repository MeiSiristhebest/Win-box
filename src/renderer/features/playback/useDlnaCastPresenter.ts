import { useCallback, useEffect, useRef, useState } from 'react';
import { castCurrentMedia, discoverDlnaDevices, type DlnaCastingPort } from './application/dlnaCasting';
import type { DlnaDevice } from '../../../shared/dlna';

const AUTO_CLOSE_MS = 1200;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useDlnaCastPresenter(
  url: string,
  resourceName: string | undefined,
  getCurrentTime: () => number,
  port: DlnaCastingPort,
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<readonly DlnaDevice[]>([]);
  const [message, setMessage] = useState('');
  const requestSequence = useRef(0);
  const closeTimer = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => () => {
    requestSequence.current += 1;
    clearCloseTimer();
  }, [clearCloseTimer]);

  const searchDevices = useCallback(async () => {
    clearCloseTimer();
    const request = ++requestSequence.current;
    setBusy(true);
    setMessage('正在搜索局域网设备…');
    setDevices([]);
    try {
      const found = await discoverDlnaDevices(port);
      if (request !== requestSequence.current) return;
      setDevices(found);
      setMessage(found.length ? '' : '没有发现可投屏设备（电视需支持 DLNA/UPnP，且与本机在同一局域网）');
    } catch (cause) {
      if (request === requestSequence.current) setMessage(errorMessage(cause));
    } finally {
      if (request === requestSequence.current) setBusy(false);
    }
  }, [clearCloseTimer, port]);

  const toggle = useCallback(() => {
    if (open) {
      requestSequence.current += 1;
      setBusy(false);
      setOpen(false);
      return;
    }
    setOpen(true);
    void searchDevices();
  }, [open, searchDevices]);

  const castTo = useCallback(async (device: DlnaDevice) => {
    clearCloseTimer();
    const request = ++requestSequence.current;
    setBusy(true);
    setMessage('');
    try {
      const { target, result } = await castCurrentMedia(port, {
        device,
        url,
        title: resourceName,
        positionSeconds: getCurrentTime(),
      });
      if (request !== requestSequence.current) return;
      const relayWarning = target.localRelay
        ? '⚠ 该地址是本机中继（BT / 蜘蛛代理），电视端可能拉不到流。'
        : '';
      const outcome = result.ok
        ? `已投到「${result.device || device.name}」`
        : result.error || '投屏失败';
      setMessage([relayWarning, outcome].filter(Boolean).join(' '));
      if (result.ok) {
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null;
          setOpen(false);
        }, AUTO_CLOSE_MS);
      }
    } catch (cause) {
      if (request === requestSequence.current) setMessage(errorMessage(cause));
    } finally {
      if (request === requestSequence.current) setBusy(false);
    }
  }, [clearCloseTimer, getCurrentTime, port, resourceName, url]);

  return {
    model: { open, busy, devices, message },
    actions: { toggle, searchDevices, castTo },
  };
}
