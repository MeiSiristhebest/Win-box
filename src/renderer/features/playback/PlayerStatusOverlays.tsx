import type { MouseEventHandler } from 'react';
import type { Kernel } from '../../lib/kernel';
import { DriveBindingDialog } from '../driveBinding/DriveBindingDialog';
import { driveProviderLabel } from '../../../shared/driveProvider';

export interface PlayerStatusOverlaysProps {
  loading: boolean;
  buffering: boolean;
  loadingSpeed?: string;
  error: string;
  mpvError: string;
  paused: boolean;
  mini: boolean;
  episodePanelOpen: boolean;
  driveProvider: string | null;
  bindModalOpen: boolean;
  resourceName?: string;
  allowMpv: boolean;
  mpvAvailable: boolean;
  kernel: Kernel;
  endAll: boolean;
  formatBadges: readonly string[];
  kernelNotice?: string;
  onPlay(): void;
  onPlayMouseDown: MouseEventHandler<HTMLButtonElement>;
  onGoToBind(): void;
  onOpenBindModal(): void;
  onDismissBindNotice(): void;
  onCloseBindModal(): void;
  onBindSaved(): void;
  onSwitchKernel(kernel: Kernel): void;
  onRetry(): void;
}

/** Declarative playback status and recovery surfaces, isolated from player orchestration. */
export function PlayerStatusOverlays(props: PlayerStatusOverlaysProps) {
  const {
    loading, buffering, loadingSpeed, error, mpvError, paused, mini, episodePanelOpen,
    driveProvider, bindModalOpen, resourceName, allowMpv, mpvAvailable, kernel,
    endAll, formatBadges, kernelNotice, onPlay, onPlayMouseDown, onGoToBind,
    onOpenBindModal, onDismissBindNotice, onCloseBindModal, onBindSaved,
    onSwitchKernel, onRetry,
  } = props;

  return (
    <>
      {(loading || buffering) && !error && !mpvError && (
        <div className="vp-loading">
          <span className="vp-spin" />
          <span className="vp-load-text">
            缓存中
            {loadingSpeed ? <span className="vp-load-speed"> {loadingSpeed}</span> : null}
          </span>
        </div>
      )}
      {!loading && !error && !mpvError && paused && !mini && !episodePanelOpen && (
        <button type="button" className="vp-big" onClick={onPlay} onMouseDown={onPlayMouseDown} title="播放" aria-label="播放">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
        </button>
      )}
      {driveProvider && (
        <div className="vp-drive-bind" onDoubleClick={(event) => event.stopPropagation()}>
          <div>
            此片源来自<b>「{driveProviderLabel(driveProvider)}」网盘</b>的专用链接，
            需要先绑定对应网盘凭据（Cookie）才能取流播放：
            到<b>点播页 → 正在用的那个源</b>（如立播/玩偶/我的云盘等）点源主页的<b>「网盘绑定」</b>按钮写入
            （夸克/UC 请粘贴含 <code>__pus</code> 与 <code>__puus</code> 的完整 Cookie，或用其中的「扫码登录」自动抓取）。
          </div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            <button className="primary" onClick={onGoToBind}>去点播页绑定</button>
            <button onClick={onOpenBindModal}>打开绑定窗口</button>
            <button onClick={onDismissBindNotice}>知道了</button>
          </div>
        </div>
      )}
      {bindModalOpen && driveProvider && (
        <DriveBindingDialog
          siteName={resourceName || '当前播放源'}
          initialProvider={driveProvider}
          onClose={onCloseBindModal}
          onSaved={onBindSaved}
        />
      )}
      {error && (
        <div className="vp-err" onDoubleClick={(event) => event.stopPropagation()}>
          <div>{error}</div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            {allowMpv && mpvAvailable && kernel === 'html5' && (
              <button className="primary" onClick={() => onSwitchKernel('mpv')}>用 MPV 内核重试</button>
            )}
            <button className={allowMpv && mpvAvailable && kernel === 'html5' ? '' : 'primary'} onClick={onRetry}>刷新重试</button>
          </div>
        </div>
      )}
      {mpvError && kernel === 'mpv' && (
        <div className="vp-err" onDoubleClick={(event) => event.stopPropagation()}>
          <div>{mpvError}</div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            <button className="primary" onClick={() => onSwitchKernel('html5')}>切回内置内核</button>
          </div>
        </div>
      )}
      {endAll && <div className="vp-next"><span>已播完全部剧集</span></div>}
      {kernel === 'mpv' && formatBadges.length > 0 && (
        <div className="vp-fmtbadges">{formatBadges.map((badge) => <span key={badge} className="vp-fmtbadge">{badge}</span>)}</div>
      )}
      {kernelNotice && <output className="vp-kernel-notice">{kernelNotice}</output>}
    </>
  );
}
