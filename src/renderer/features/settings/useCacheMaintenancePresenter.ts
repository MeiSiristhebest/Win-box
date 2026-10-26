import { useCallback, useEffect, useState } from 'react';
import type { DataDirInfo } from '../../../shared/types';
import type { CacheMaintenancePort } from './application/settingsSectionPorts';

type CacheMaintenanceFeedback = { text: string; kind: 'ok' | 'err' };

export function useCacheMaintenancePresenter(active: boolean, port: CacheMaintenancePort) {
  const [busy, setBusy] = useState(false);
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null);
  const [feedback, setFeedback] = useState<CacheMaintenanceFeedback | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void port.loadDataDirectory().then((info) => {
      if (current) setDataDir(info);
    }).catch((cause: unknown) => {
      if (current) setFeedback({
        text: `读取数据目录失败：${cause instanceof Error ? cause.message : String(cause)}`,
        kind: 'err',
      });
    });
    return () => { current = false; };
  }, [active, port]);

  const clearCache = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await port.clearCache();
      const megabytes = (result.freedBytes / 1024 / 1024).toFixed(1);
      setFeedback({
        text: `已清理 ${result.cleared.length} 类缓存，释放约 ${megabytes} MB${result.failed.length ? `（${result.failed.length} 项暂被占用跳过）` : ''}`,
        kind: 'ok',
      });
    } catch (cause: unknown) {
      setFeedback({ text: `清理失败：${cause instanceof Error ? cause.message : String(cause)}`, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }, [busy, port]);

  return { active, busy, dataDir, feedback, clearCache };
}
