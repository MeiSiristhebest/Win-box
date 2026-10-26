import type { DataDirInfo } from '../../../shared/types';

type CacheMaintenanceViewProps = {
  active: boolean;
  busy: boolean;
  dataDir: DataDirInfo | null;
  feedback: { text: string; kind: 'ok' | 'err' } | null;
  onClearCache(): void;
};

export function CacheMaintenanceView({ active, busy, dataDir, feedback, onClearCache }: CacheMaintenanceViewProps) {
  if (!active) return null;

  return (
    <div className="card" id="cfg-cache" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontWeight: 600 }}>清理缓存</span>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="primary" disabled={busy} onClick={onClearCache}>
          {busy ? '清理中…' : '立即清理'}
        </button>
      </div>
      {feedback && <div className="muted" style={{ fontSize: 12, marginTop: 4, color: feedback.kind === 'ok' ? 'var(--text-success)' : 'var(--text-warn)' }} aria-live="polite">{feedback.text}</div>}
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
