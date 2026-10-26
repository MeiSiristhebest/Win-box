import { useEffect, useState } from 'react';
import type { ConfigRuntimeSyncStatus } from '../../../shared/types';
import type { ConfigRuntimeSyncNoticePort } from './application/configRuntimeSyncNoticePort';

/** Makes a durable-save/runtime-projection split visible and recoverable in every window. */
export function ConfigRuntimeSyncNotice({ port }: { port: ConfigRuntimeSyncNoticePort }) {
  const [status, setStatus] = useState<ConfigRuntimeSyncStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');

  useEffect(() => {
    let mounted = true;
    const unsubscribe = port.subscribe((next) => {
      if (mounted) setStatus(next);
    });
    void port.getStatus().then((next) => {
      if (mounted) setStatus(next);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [port]);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    setRetryError('');
    try {
      await port.retry();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRetrying(false);
    }
  };

  if (!status || status.status === 'synchronized') return null;
  const failed = status.status === 'failed';

  return (
    <section className="config-runtime-sync-notice" role="alert" aria-live="assertive">
      <div className="config-runtime-sync-notice__copy">
        <strong>{failed ? '数据已保存，但运行时同步失败' : '数据已保存，但运行时同步尚未完成'}</strong>
        {failed && <span className="config-runtime-sync-notice__detail">{status.error.message}</span>}
        {retryError && <span className="config-runtime-sync-notice__detail">重试失败：{retryError}</span>}
      </div>
      <button type="button" onClick={() => void retry()} disabled={retrying}>
        {retrying ? '正在重试…' : '重试同步'}
      </button>
    </section>
  );
}
