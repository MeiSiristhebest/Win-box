import type { ReactNode } from 'react';
import { formatBytes } from '../../shared/update';
import type { UpdateCheckResult, UpdateProgress } from '../../shared/update';
import { AppModal } from './AppDialog';

interface UpdateGateViewProps {
  children: ReactNode;
  info: UpdateCheckResult | null;
  progress: UpdateProgress | null;
  error: string;
  busy: boolean;
  visible: boolean;
  total: number;
  received: number;
  percent: number;
  launching: boolean;
  speedtest: boolean;
  statusText: string;
  publishedAt: string;
  notes: string;
  onDismiss(): void;
  onCancel(): void;
  onDownload(): void;
  onOpenBackupDownload(): void;
}

/** Passive update prompt view. Workflow and infrastructure live in the update feature. */
export function UpdateGateView(props: UpdateGateViewProps) {
  const { children, info, progress, error, busy, visible, total, received, percent,
    launching, speedtest, statusText, publishedAt, notes } = props;

  return (
    <>
      <div className={visible ? 'upd-blur' : undefined} aria-hidden={visible || undefined} inert={visible || undefined}>
        {children}
      </div>
      {visible && info && <AppModal
        open
        className="app-dialog card modal-in upd-card"
        titleId="update-title"
        canClose={!busy}
        onClose={props.onDismiss}
      >
        <div className="app-dialog-heading">
          <h3 id="update-title">发现新版本</h3>
        </div>
        <div className="muted upd-vers">
          <b>{info.localVersion}</b> → <b>{info.remoteVersion}</b>
          {publishedAt ? ` · 发布于 ${publishedAt}` : ''}
        </div>
        <div className="muted upd-hint">可暂不更新，继续使用当前版本；下次启动时会再次检查。</div>

        {!busy && !error && (
          <>
            <div className="upd-notes-title">更新说明</div>
            <div className="upd-notes">{notes}</div>
          </>
        )}

        {(busy || error) && (
          <>
            {!error && <div className="upd-bar">
              <div className="upd-fill" style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
            </div>}
            <div className="upd-status">
              <span className="muted">{statusText}</span>
              {!error && <span className="muted">
                {launching || speedtest ? '' : `${formatBytes(received)} / ${formatBytes(total)} · ${percent}%`}
              </span>}
            </div>
            {!error && !launching && !speedtest && !!progress?.speed && (
              <div className="muted upd-speed">{formatBytes(progress.speed)}/s</div>
            )}
          </>
        )}

        {error && (
          <div className="upd-err">
            {error}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              请检查网络或代理设置后重试。
            </div>
          </div>
        )}

        <div className="row upd-actions app-dialog-actions">
          {busy && !launching && <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={props.onCancel}>取消下载</button>}
          {!busy && !error && (
            <>
              <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={props.onDismiss}>
                暂不更新
              </button>
              <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={props.onOpenBackupDownload}>
                网盘更新
              </button>
              <button className="primary" style={{ flex: '0 0 auto' }} onClick={props.onDownload}>
                立即更新
              </button>
            </>
          )}
          {error && (
            <>
              <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={props.onDismiss}>
                暂不更新
              </button>
              <button className="primary" style={{ flex: '0 0 auto' }} disabled={busy} onClick={props.onDownload}>
                重试
              </button>
            </>
          )}
        </div>
      </AppModal>}
    </>
  );
}
