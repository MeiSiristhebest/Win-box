import type { MediaRuntimeManagementPort } from './application/playbackSettingsPorts';
import { useMediaRuntimeManagement } from './useMediaRuntimeManagement';

interface MediaRuntimeDownloadsSectionProps {
  active: boolean;
  port: MediaRuntimeManagementPort;
  afterMpvInstall: () => Promise<void>;
}

export function MediaRuntimeDownloadsSection({ active, port, afterMpvInstall }: MediaRuntimeDownloadsSectionProps) {
  const { status, busy, progress, message, install, cancel } = useMediaRuntimeManagement({ active, port, afterMpvInstall });

  return (
    <section id="cfg-media-runtimes" style={{ marginTop: 20, borderTop: '1px solid var(--line, #30343b)', paddingTop: 16 }}>
      <h4>可选媒体组件下载</h4>
      <p className="muted">由 Win-Box 直接从上游发行渠道下载到当前 Windows 用户的数据目录，不改系统 PATH、不需要管理员权限。下载后会核对 GitHub 公布的 SHA-256；只在校验通过后安装。</p>
      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <strong>MPV：应用内兼容播放</strong>
        <p className="muted" style={{ margin: '6px 0' }}>Windows 通用 x64 构建由 <a href="https://mpv.io/installation/" target="_blank" rel="noreferrer">mpv.io 安装页</a>指向的 <a href="https://github.com/shinchiro/mpv-winbuild-cmake/releases" target="_blank" rel="noreferrer">shinchiro 项目</a>提供。下载体积以发行页为准；只在选择 MPV 内核或自动兼容播放时使用，并保留发行包附带的许可证文件。</p>
        <p className="muted" style={{ margin: '6px 0' }}>{status?.mpv.installed ? `已下载：${status.mpv.version} · ${status.mpv.assetName}` : '当前没有通过本入口下载的 MPV 版本。也可以继续使用随包版本或手动指定路径。'}</p>
        <button type="button" disabled={busy !== null} onClick={() => void install('mpv')}>{busy === 'mpv' ? '正在下载并安装…' : status?.mpv.installed ? '检查并更新 MPV' : '一键下载并安装 MPV'}</button>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 10 }}>
        <strong>FFmpeg：后台兼容组件</strong>
        <p className="muted" style={{ margin: '6px 0' }}>来自 <a href="https://ffmpeg.org/download.html" target="_blank" rel="noreferrer">FFmpeg 官方下载页</a>引用的 <a href="https://github.com/BtbN/FFmpeg-Builds/releases" target="_blank" rel="noreferrer">BtbN Windows 构建</a>。此处选择 GPL shared 版本，因为当前兼容转码使用 libx264；程序会一并保留发行包中的许可证和版权文件。它不是播放器，按需用于媒体探测与不兼容资源转换。</p>
        <p className="muted" style={{ margin: '6px 0' }}>{status?.ffmpeg.installed ? `已下载：${status.ffmpeg.version} · ${status.ffmpeg.assetName}` : '当前没有通过本入口下载的 FFmpeg 版本。'}</p>
        <button type="button" disabled={busy !== null} onClick={() => void install('ffmpeg')}>{busy === 'ffmpeg' ? '正在下载并安装…' : status?.ffmpeg.installed ? '检查并更新 FFmpeg' : '一键下载并安装 FFmpeg'}</button>
      </div>
      {busy !== null && <div style={{ marginTop: 12 }}>
        <output className="muted" aria-live="polite" style={{ display: 'block', margin: '1em 0' }}>{progress?.message || '正在处理'}{progress && progress.total > 0 ? ` · ${Math.min(100, Math.floor(progress.received * 100 / progress.total))}%` : ''}</output>
        {progress?.phase === 'download' && progress.total > 0 && <progress aria-label="媒体组件下载进度" value={progress.received} max={progress.total} style={{ width: '100%' }} />}
        <button type="button" onClick={() => void cancel()}>取消下载</button>
      </div>}
      {message && <output className={message.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</output>}
    </section>
  );
}
