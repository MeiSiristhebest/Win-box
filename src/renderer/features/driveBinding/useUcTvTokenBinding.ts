import { useCallback, useEffect, useRef, useState } from 'react';
import type { UcTvTokenPort } from './application/driveBindingPorts';

const POLL_INTERVAL_MS = 3000;

interface UcTvTokenBindingOptions {
  port: UcTvTokenPort;
  onBound: () => void;
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useUcTvTokenBinding({ port, onBound }: UcTvTokenBindingOptions) {
  const [bound, setBound] = useState(false);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(false);
  const onBoundRef = useRef(onBound);
  useEffect(() => {
    onBoundRef.current = onBound;
  }, [onBound]);

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async function poll(): Promise<void> {
    if (!alive.current) return;
    try {
      const result = await port.pollQr();
      if (!alive.current) return;
      if (result.state === 'ok') {
        setQr('');
        setBound(true);
        setMessage('✓ UC TV Token 已绑定。回到源内重新进一次详情即可生效（蜘蛛已重置）。');
        onBoundRef.current();
        return;
      }
      if (result.state === 'expired' || result.state === 'error') {
        setQr('');
        setMessage(`✗ ${result.hint || (result.state === 'expired' ? '二维码已过期，请重新获取' : '轮询失败')}`);
        return;
      }
      timer.current = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    } catch (cause) {
      if (!alive.current) return;
      setQr('');
      setMessage(`✗ 轮询失败：${describeFailure(cause)}`);
    }
  }, [port]);

  useEffect(() => {
    alive.current = true;
    void port.status().then(result => { if (alive.current) setBound(result.bound); }).catch(() => undefined);
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, [port, stopPolling]);

  const create = useCallback(async () => {
    stopPolling();
    setBusy(true);
    setMessage('请用手机上的「UC 浏览器」扫描二维码并确认授权');
    try {
      const result = await port.createQr();
      if (!alive.current) return false;
      setQr(result.imageDataUrl);
      timer.current = setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      return true;
    } catch (cause) {
      if (alive.current) setMessage(`✗ 取码失败：${describeFailure(cause)}`);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [poll, port, stopPolling]);

  const unbind = useCallback(async () => {
    stopPolling();
    setBusy(true);
    setMessage('');
    try {
      await port.remove();
      if (!alive.current) return true;
      setBound(false);
      setQr('');
      setMessage('已解绑 UC TV Token');
      onBoundRef.current();
      return true;
    } catch (cause) {
      if (alive.current) setMessage(`解绑失败：${describeFailure(cause)}`);
      return false;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [port, stopPolling]);

  return {
    model: { bound, qr, busy, message },
    actions: { create, unbind },
  };
}
