import { useCallback, useState } from 'react';
import { driveProviderLabel } from '../../../shared/driveProvider';
import type { DriveWebLoginPort } from './application/driveBindingPorts';

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useDriveWebLogin(port: DriveWebLoginPort) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const login = useCallback(async (provider: string, onBound: (provider: string) => void) => {
    setMessage('');
    setBusy(true);
    try {
      await port.login(provider);
      onBound(provider);
      setMessage(`✓ 已通过网页扫码保存「${driveProviderLabel(provider)}」绑定`);
      return true;
    } catch (cause) {
      setMessage(`登录失败：${describeFailure(cause)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [port]);

  return { model: { busy, message }, actions: { login } };
}
