import type { AuditItem, SourceBean } from '../../../shared/types';
import type { AuditFilter, SourceHealthAuditNotice } from './sourceHealthAuditTypes';

interface SourceHealthAuditSectionProps {
  audit: AuditItem[] | null;
  auditBusy: boolean;
  filter: AuditFilter;
  sources: SourceBean[];
  onRunAudit: () => void;
  onDeleteFailedSources: () => void;
  onFilterChange: (filter: AuditFilter) => void;
  error?: string;
  notice?: SourceHealthAuditNotice | null;
}

const HEALTH_LABEL: Record<string, string> = {
  'ok-content': '有效·主页有内容',
  'ok-classes': '有效·仅分类(点分类可见)',
  'needs-ext': '需补 ext',
  empty: '空(源站无数据)',
  error: '请求失败（需复核）',
};

const HEALTH_COLOR: Record<string, string> = {
  'ok-content': 'var(--text-success)',
  'ok-classes': 'var(--text-warn)',
  'needs-ext': 'var(--accent)',
  empty: 'var(--text-dim)',
  error: 'var(--text-danger)',
};

export function SourceHealthAuditSection({
  audit,
  auditBusy,
  filter,
  sources,
  onRunAudit,
  onDeleteFailedSources,
  onFilterChange,
  error,
  notice,
}: SourceHealthAuditSectionProps) {
  return (
    <div className="card" id="cfg-audit" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontWeight: 600 }}>线路首页检查（反映本次请求结果，不等于永久失效）</span>
        <button className="primary" disabled={auditBusy || !sources.length} onClick={onRunAudit}>
          {auditBusy ? '体检中…（逐源加载首页，jar 源较慢）' : '一键体检全部源'}
        </button>
        {audit && (
          <button
            style={{ color: 'var(--text-danger)' }}
            disabled={!audit.some((item) => item.health === 'error')}
            onClick={onDeleteFailedSources}
            title="只从当前档案移除本次请求失败的线路；网络、登录或运行环境问题也可能造成失败"
          >
            移除本次请求失败线路（{audit.filter((item) => item.health === 'error').length}）
          </button>
        )}
        {audit && (
          <span className="status">
            {audit.filter((item) => item.health === 'ok-content' || item.health === 'ok-classes').length} 有效 ·
            {audit.filter((item) => item.needsExt).length} 需补 ext ·
            {audit.filter((item) => item.health === 'error' || item.health === 'empty').length} 请求失败/空
          </span>
        )}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {notice && <div role={notice.kind === 'err' ? 'alert' : 'status'} style={{ marginBottom: 8, color: notice.kind === 'ok' ? 'var(--text-success)' : 'var(--text-danger)' }}>{notice.text}</div>}
      {audit && (
        <div style={{ fontSize: 12 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <button type="button" className={`tag ${filter === 'all' ? 'active' : ''}`} aria-pressed={filter === 'all'} onClick={() => onFilterChange('all')}>全部 {audit.length}</button>
            <button type="button" className={`tag ${filter === 'usable' ? 'active' : ''}`} aria-pressed={filter === 'usable'} onClick={() => onFilterChange('usable')}>有效</button>
            <button type="button" className={`tag ${filter === 'needs-ext' ? 'active' : ''}`} aria-pressed={filter === 'needs-ext'} onClick={() => onFilterChange('needs-ext')}>需补 ext</button>
            <button type="button" className={`tag ${filter === 'bad' ? 'active' : ''}`} aria-pressed={filter === 'bad'} onClick={() => onFilterChange('bad')}>失效/空</button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-dim)', textAlign: 'left' }}>
                <th style={{ borderBottom: '1px solid var(--border-soft)' }}>源</th>
                <th style={{ borderBottom: '1px solid var(--border-soft)' }}>形态</th>
                <th style={{ borderBottom: '1px solid var(--border-soft)' }}>体检结果</th>
                <th style={{ borderBottom: '1px solid var(--border-soft)' }}>建议 / 错误</th>
                <th style={{ borderBottom: '1px solid var(--border-soft)' }}>耗时</th>
              </tr>
            </thead>
            <tbody>
              {audit
                .filter((item) => (filter === 'usable' ? item.usable : filter === 'needs-ext' ? item.needsExt : filter === 'bad' ? !item.usable && !item.needsExt : true))
                .map((item) => (
                  <tr key={item.key}>
                    <td style={{ borderBottom: '1px solid var(--border-soft)' }}>
                      <div>{item.name}</div>
                      <div className="muted">{item.key}</div>
                    </td>
                    <td style={{ borderBottom: '1px solid var(--border-soft)' }}>type{item.type}·{item.kind}{item.homeFallback ? '·首页回退' : ''}</td>
                    <td style={{ borderBottom: '1px solid var(--border-soft)', color: HEALTH_COLOR[item.health] }}>
                      {HEALTH_LABEL[item.health]}{item.items > 0 ? `（${item.items} 条）` : ''}
                    </td>
                    <td style={{ borderBottom: '1px solid var(--border-soft)', color: 'var(--text-dim)', maxWidth: 380 }}>
                      {item.advice}
                      {item.error && <div style={{ color: 'var(--text-danger)' }}>{item.error}</div>}
                    </td>
                    <td style={{ borderBottom: '1px solid var(--border-soft)' }}>{item.ms}ms</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            有效标准：主页真实拉到内容条目或分类。
          </div>
        </div>
      )}
    </div>
  );
}
