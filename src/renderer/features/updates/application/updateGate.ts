import type { UpdateCheckResult, UpdateProgress } from '../../../../shared/update';

export interface UpdateGatePort {
  checkForUpdate(): Promise<UpdateCheckResult>;
  downloadUpdate(): Promise<{ ok: boolean; error?: string; canceled?: boolean }>;
  cancelDownload(): Promise<boolean>;
  installUpdate(): Promise<{ ok: boolean; path: string }>;
  subscribeToProgress(listener: (progress: UpdateProgress) => void): () => void;
  openBackupDownload(): void;
}

export interface UpdateGateState {
  info: UpdateCheckResult | null;
  progress: UpdateProgress | null;
  error: string;
  busy: boolean;
  dismissed: boolean;
  skip: boolean;
}

export interface UpdateGateViewModel {
  visible: boolean;
  total: number;
  received: number;
  percent: number;
  launching: boolean;
  speedtest: boolean;
  statusText: string;
  publishedAt: string;
  notes: string;
}

/** Pure presentation mapping so update-state decisions can be verified without React or IPC. */
export function presentUpdateGate(state: UpdateGateState): UpdateGateViewModel {
  const { info, progress, error, skip } = state;
  const launching = progress?.phase === 'launching';
  const speedtest = progress?.phase === 'speedtest';
  const verifying = progress?.phase === 'verifying';
  const percent = progress?.phase === 'done' || launching ? 100 : progress?.percent || 0;
  const date = info?.publishedAt ? new Date(info.publishedAt) : null;

  return {
    visible: Boolean(info && !state.dismissed && !skip),
    total: progress?.total || info?.asset?.size || 0,
    received: progress?.received || 0,
    percent,
    launching,
    speedtest,
    statusText: error
      ? '下载失败'
      : launching
        ? '安装程序已启动，即将退出本程序…'
        : verifying
          ? '正在校验安装包…'
          : speedtest
            ? progress?.message || '正在测速选择最快的下载线路…'
            : `正在下载 ${info?.asset?.name || ''}`,
    publishedAt: date && Number.isFinite(date.getTime())
      ? date.toLocaleDateString('zh-CN')
      : '',
    notes: info?.releaseNotes?.trim() || '本次版本暂无详细更新说明。',
  };
}
