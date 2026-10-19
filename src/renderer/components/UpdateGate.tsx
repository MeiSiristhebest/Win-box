// src/renderer/components/UpdateGate.tsx
// ★ 2026-10-13：启动更新提示 —— 启动时比对本地版本与 GitHub 最新 Release；
//   发现新版本后由用户选择「立即更新」或「暂不更新」，不再强制锁死软件。
//
// 红线：检查失败（网络不通等）**绝不影响软件使用** —— 直接放行。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { client } from '../api/client';
import { formatBytes, type UpdateCheckResult, type UpdateProgress, DISK_UPDATE_URL } from '../../shared/update';
import { isDetailWinHash } from '../../shared/detailWin';
import { isSearchWindow } from '../lib/searchWin';
import { AppModal } from './AppDialog';

/** 独立播放器窗口（`#/player`）不参与启动提示：更新由主窗口统一触发 */
function isPlayerWindow(): boolean {
  try {
    return window.location.hash.startsWith('#/player');
  } catch {
    return false;
  }
}

export default function UpdateGate({ children }: { children: ReactNode }) {
  /**
   * ★ 2026-10-08（用户要求「详情页独立窗口」）：详情窗口同样跳过门禁 —— 它只是主窗口的副本窗口，
   *   提示/下载由主窗口统一负责（否则两个窗口各下一次 Setup）。
   */
  const skip = isPlayerWindow() || isDetailWinHash(window.location.hash) || isSearchWindow();
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const started = useRef(false);
  const downloading = useRef(false);

  // 订阅下载进度（主进程推送）
  useEffect(() => {
    if (skip) return;
    return client.onUpdateProgress((p) => {
      if (p.phase === 'error') {
        setError(p.error || '下载失败');
        setBusy(false);
      }
      if (p.phase === 'canceled') { setBusy(false); setError(''); }
      setProgress(p);
    });
  }, [skip]);

  const downloadAndInstall = async (): Promise<void> => {
    if (downloading.current) return;
    downloading.current = true;
    setBusy(true);
    setError('');
    setProgress({ phase: 'speedtest', received: 0, total: info?.asset?.size || 0, percent: 0, speed: 0 });
    try {
      const dl = await client.updateDownload();
      if (!dl.ok) {
        if (dl.canceled) { setBusy(false); setProgress(null); return; }
        setError(dl.error || '下载失败');
        setBusy(false);
        return;
      }
      setProgress({ phase: 'launching', received: 0, total: 0, percent: 100, speed: 0, message: '正在启动安装程序…' });
      await client.updateInstall();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    } finally {
      downloading.current = false;
    }
  };

  // 启动检查（仅主窗口、仅一次）
  useEffect(() => {
    if (skip || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const r = await client.updateCheck();
        if (!r.updateAvailable || !r.asset) return; // 已是最新 / 检查失败 → 放行
        setInfo(r);
      } catch {
        /* 检查失败：不锁死软件 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip]);

  const visible = !!info && !dismissed && !skip;
  const total = progress?.total || info?.asset?.size || 0;
  const received = progress?.received || 0;
  const percent = progress?.phase === 'done' || progress?.phase === 'launching' ? 100 : progress?.percent || 0;
  const launching = progress?.phase === 'launching';
  /** ★ 2026-09-30：下载前会先给各代理线路测速（挑最快的），此阶段不显示字节进度 */
  const speedtest = progress?.phase === 'speedtest';
  const verifying = progress?.phase === 'verifying';
  const statusText = error
    ? '下载失败'
    : launching
      ? '安装程序已启动，即将退出本程序…'
      : verifying ? '正在校验安装包…' : speedtest
        ? progress?.message || '正在测速选择最快的下载线路…'
        : `正在下载 ${info?.asset?.name || ''}`;

  const date = info?.publishedAt ? new Date(info.publishedAt) : null;
  const publishedAt = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('zh-CN')
    : '';
  const notes = info?.releaseNotes?.trim() || '本次版本暂无详细更新说明。';

  return (
    <>
      {/* 保持页面容器稳定，提示出现/关闭时不重新挂载页面或丢失浏览状态。 */}
      <div className={visible ? 'upd-blur' : undefined} aria-hidden={visible || undefined} inert={visible || undefined}>
        {children}
      </div>
      {visible && info && <AppModal
        open
        className="app-dialog card modal-in upd-card"
        titleId="update-title"
        canClose={!busy}
        onClose={() => setDismissed(true)}
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

          {/* ★ 2026-10-14：`flex: 0`（= `0 1 0%`）会把按钮压到 min-content（中文 1 字宽）并把文字
              折成两行，看起来像竖排按钮；与本仓其它按钮统一改为 `0 0 auto`（按内容取宽、不收缩）。 */}
          <div className="row upd-actions app-dialog-actions">
            {busy && !launching && <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={() => { void client.updateCancel().catch(error => setError(error instanceof Error ? error.message : String(error))); }}>取消下载</button>}
            {!busy && !error && (
              <>
                <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={() => setDismissed(true)}>
                  暂不更新
                </button>
                {/* ★ 2026-10-16（用户要求）：网盘备用下载 —— 点击用**系统浏览器**打开网盘分享页，用户自行下载。
                    走 `window.open` 即可：主窗口的 `setWindowOpenHandler` 已把它交给 `shell.openExternal`
                    （见 main/index.ts），与说明页的 GitHub 链接同款口径，不必新增 IPC。
                    点它**不关弹窗**：用户下载完可能还要回来点「暂不更新」。 */}
                <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={() => window.open(DISK_UPDATE_URL, '_blank', 'noopener,noreferrer')}>
                  网盘更新
                </button>
                <button className="primary" style={{ flex: '0 0 auto' }} onClick={() => void downloadAndInstall()}>
                  立即更新
                </button>
              </>
            )}
            {error && (
              <>
                <button className="app-dialog-action-secondary" style={{ flex: '0 0 auto' }} onClick={() => setDismissed(true)}>
                  暂不更新
                </button>
                <button className="primary" style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => void downloadAndInstall()}>
                  重试
                </button>
              </>
            )}
          </div>
      </AppModal>}
    </>
  );
}
