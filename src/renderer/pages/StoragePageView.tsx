import type { DavEntry, DavServer } from '../../shared/webdav';
import VideoPlayer from '../components/VideoPlayer';

interface StoragePageViewProps {
  servers: DavServer[];
  serverId: string;
  currentServer?: DavServer;
  path: string;
  entries: DavEntry[];
  busy: boolean;
  error: string;
  message: string;
  playUrl: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  onManage(): void;
  onSelectServer(id: string): void;
  onRefresh(): void;
  onBrowse(path: string): void;
  onGoToParent(): void;
  onOpenEntry(entry: DavEntry): void;
}

export function StoragePageView(props: StoragePageViewProps) {
  const { servers, serverId, currentServer, path, entries, busy, error, message, playUrl, breadcrumbs } = props;
  return (
    <div className="content storage-content">
      <header className="page-heading">
        <div><h1>存储</h1><p>浏览和播放 WebDAV 连接中的视频文件。</p></div>
        <button onClick={props.onManage}>管理连接</button>
      </header>
      {servers.length > 0 && <div className="storage-toolbar">
        <label>连接<select aria-label="存储连接" value={serverId} onChange={(event) => props.onSelectServer(event.target.value)}>
          {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
        </select></label>
        <button onClick={props.onRefresh} disabled={busy || !serverId}>刷新</button>
        <output className="muted">{busy ? '正在读取目录…' : entries.length + ' 项'}</output>
      </div>}
      {error && <div className="err" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {!servers.length ? (
        <div className="empty"><h2>连接你的媒体存储</h2><p>支持 OpenList、Nextcloud 等 WebDAV 服务。</p><button className="primary" onClick={props.onManage}>添加存储</button></div>
      ) : <>
        <nav className="dav-crumb" aria-label="文件路径">
          <button type="button" className="dav-crumb-item ui-action" aria-current={path === '/' ? 'page' : undefined} onClick={() => props.onBrowse('/')}>{currentServer?.name || '根目录'}</button>
          {breadcrumbs.map((crumb) => <span key={crumb.path}><span className="muted" aria-hidden="true"> / </span><button type="button" className="dav-crumb-item ui-action" aria-current={crumb.path === path ? 'page' : undefined} onClick={() => props.onBrowse(crumb.path)}>{crumb.name}</button></span>)}
        </nav>
        {message && <output className="status" style={{ display: 'block', marginBottom: 10 }}>{message}</output>}
        {playUrl && <div className="dav-player"><VideoPlayer url={playUrl} /></div>}
        <div className="dav-list">
          {path !== '/' && <button type="button" className="dav-row ui-action" aria-label="返回上级目录" disabled={busy} onClick={props.onGoToParent}>
            <span className="dav-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 9 5-5 5 5M10 4v12" /></svg></span><span className="dav-name">返回上级</span>
          </button>}
          {entries.map((entry) => <button type="button" key={entry.path} className="dav-row ui-action" disabled={busy} aria-label={(entry.isDir ? '打开文件夹 ' : '打开文件 ') + entry.name} onClick={() => props.onOpenEntry(entry)} title={entry.path}>
            <span className="dav-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">{entry.isDir ? <path d="M2 5h6l2 2h8v9H2V5Z" /> : <><rect x="4" y="2" width="12" height="16" rx="2" /><path d="m8 7 5 3-5 3V7Z" /></>}</svg></span>
            <span className="dav-name">{entry.name}</span><span className="dav-size muted">{entry.isDir ? '' : formatSize(entry.size)}</span><span className="dav-time muted">{formatDate(entry.mtime)}</span>
          </button>)}
          {!entries.length && !busy && !error && <div className="empty">这个目录是空的</div>}
        </div>
      </>}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
