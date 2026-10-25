import { useEffect, useState } from 'react';
import type { DataDirInfo } from '../../../shared/types';
import type { CacheMaintenancePort } from './application/settingsSectionPorts';

export function CacheMaintenanceSection({ active, port }: { active: boolean; port: CacheMaintenancePort }) {
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null);

  useEffect(() => {
    if (!active) return;
    port.loadDataDirectory().then(setDataDir).catch(() => undefined);
  }, [active, port]);

  async function clearCache() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await port.clearCache();
      const megabytes = (result.freedBytes / 1024 / 1024).toFixed(1);
      setMessage({
        text: `已清理 ${result.cleared.length} 类缓存，释放约 ${megabytes} MB${result.failed.length ? `（${result.failed.length} 项暂被占用跳过）` : ''}`,
        kind: 'ok',
      });
    } catch (error) {
      setMessage({ text: `清理失败：${(error as Error).message}`, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  return (
    <div className="card" id="cfg-cache" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontWeight: 600 }}>清理缓存</span>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="primary" disabled={busy} onClick={() => void clearCache()}>
          {busy ? '清理中…' : '立即清理'}
        </button>
      </div>
      {message && <div className="muted" style={{ fontSize: 12, marginTop: 4, color: message.kind === 'ok' ? 'var(--text-success)' : 'var(--text-warn)' }} aria-live="polite">{message.text}</div>}
      {dataDir && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }} title={`计划目录：${dataDir.planned}`}>
          数据目录：{dataDir.path}
          {dataDir.mode === 'activated' && dataDir.migration?.cleanedLegacy ? '（已迁移，旧目录已清理）' : ''}
          {dataDir.mode === 'activated' && !dataDir.migration?.cleanedLegacy ? '（安装目录/data）' : ''}
          {dataDir.mode === 'fallback' ? `（${dataDir.reason || '沿用系统默认位置'}）` : ''}
          {dataDir.mode === 'dev' ? '（开发态：系统默认位置）' : ''}
        </div>
      )}
    </div>
  );
}
