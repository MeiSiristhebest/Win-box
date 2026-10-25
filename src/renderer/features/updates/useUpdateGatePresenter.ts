import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateCheckResult, UpdateProgress } from '../../../shared/update';
import { presentUpdateGate, type UpdateGatePort } from './application/updateGate';

export function useUpdateGatePresenter(skip: boolean, port: UpdateGatePort) {
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const started = useRef(false);
  const downloading = useRef(false);

  useEffect(() => {
    if (skip) return;
    return port.subscribeToProgress((next) => {
      if (next.phase === 'error') {
        setError(next.error || '下载失败');
        setBusy(false);
      }
      if (next.phase === 'canceled') {
        setBusy(false);
        setError('');
      }
      setProgress(next);
    });
  }, [port, skip]);

  useEffect(() => {
    if (skip || started.current) return;
    started.current = true;
    void port.checkForUpdate()
      .then((result) => {
        if (result.updateAvailable && result.asset) setInfo(result);
      })
      .catch(() => {
        // Network or release lookup failures must never block the application.
      });
  }, [port, skip]);

  const downloadAndInstall = useCallback(async (): Promise<void> => {
    if (downloading.current) return;
    downloading.current = true;
    setBusy(true);
    setError('');
    setProgress({ phase: 'speedtest', received: 0, total: info?.asset?.size || 0, percent: 0, speed: 0 });
    try {
      const result = await port.downloadUpdate();
      if (!result.ok) {
        if (result.canceled) {
          setBusy(false);
          setProgress(null);
          return;
        }
        setError(result.error || '下载失败');
        setBusy(false);
        return;
      }
      setProgress({ phase: 'launching', received: 0, total: 0, percent: 100, speed: 0, message: '正在启动安装程序…' });
      await port.installUpdate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    } finally {
      downloading.current = false;
    }
  }, [info?.asset?.size, port]);

  const cancelDownload = useCallback((): void => {
    void port.cancelDownload().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [port]);

  const viewModel = presentUpdateGate({ info, progress, error, busy, dismissed, skip });

  return {
    info,
    progress,
    error,
    busy,
    ...viewModel,
    dismiss: () => setDismissed(true),
    downloadAndInstall,
    cancelDownload,
    openBackupDownload: port.openBackupDownload,
  };
}
