// src/renderer/pages/StoragePage.tsx — WebDAV 存储（只读）：浏览自建 OpenList/AList/Nextcloud 等并播放。
// ★ 2026-09-29：播放走 `/play?dav=<id>`（主进程中继注入 Authorization，凭据绝不进 URL）；
//   mp4/webm 等内联播，mkv/HEVC 等交给本机外部播放器接力（复用磁力的播放器设置）。
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { client } from '../api/client';
import type { DavEntry, DavServer } from '../../shared/webdav';
import { davParentPath, isDavInlinePlayable, wrapDavPlayUrl } from '../../shared/webdav';
import VideoPlayer from '../components/VideoPlayer';

function fmtSize(n: number): string {
  if (!n || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function fmtTime(s: string): string {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StoragePage() {
  const navigate = useNavigate();
  const openStorageSettings = () => {
    try { localStorage.setItem('winbox-cfg-tab', 'storage'); } catch { /* Storage may be disabled. */ }
    navigate('/config');
  };
  const [servers, setServers] = useState<DavServer[]>([]);
  const [serverId, setServerId] = useState('');
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [playUrl, setPlayUrl] = useState('');
  const browseRequest = useRef(0);

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    try {
      const list = await client.davList();
      setServers(list);
      if (list.length) {
        setServerId(list[0].id);
        await browse(list[0].id, '/');
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function browse(id: string, p: string) {
    if (!id) return;
    const request = ++browseRequest.current;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await client.davBrowse({ id, path: p });
      if (request !== browseRequest.current) return;
      setEntries(r.entries);
      setPath(r.path);
    } catch (e) {
      if (request !== browseRequest.current) return;
      setErr((e as Error).message);
      setEntries([]);
    } finally {
      if (request === browseRequest.current) setBusy(false);
    }
  }

  function pickServer(id: string) {
    setServerId(id);
    setEntries([]);
    setPath('/');
    setPlayUrl('');
    setMsg('');
    void browse(id, '/');
  }

  async function open(entry: DavEntry) {
    setMsg('');
    if (entry.isDir) {
      setPlayUrl('');
      void browse(serverId, entry.path);
      return;
    }
    const relay = wrapDavPlayUrl(entry.url, serverId);
    if (isDavInlinePlayable(entry.name)) {
      setPlayUrl(relay);
      return;
    }
    // mkv / HEVC 等 Chromium `<video>` 播不了 → 本机外部播放器接力
    setPlayUrl('');
    try {
      const r = await client.davOpenExternal(relay);
      setMsg(r.ok ? `已用「${r.player}」打开播放` : (r.error || '无法用外部播放器打开'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  // 面包屑：根 / a / b
  const segs = path.split('/').filter(Boolean);
  const crumbs = segs.map((name, i) => ({ name, path: '/' + segs.slice(0, i + 1).join('/') }));

  const cur = servers.find((s) => s.id === serverId);

  return (
    <div className="content storage-content">
      <header className="page-heading"><div><h1>存储</h1><p>浏览和播放 WebDAV 连接中的视频文件。</p></div><button onClick={openStorageSettings}>管理连接</button></header>
      {servers.length > 0 && <div className="storage-toolbar">
        <label>连接<select aria-label="存储连接" value={serverId} onChange={event => pickServer(event.target.value)}>
          {servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}
        </select></label>
        <button onClick={() => void browse(serverId, path)} disabled={busy || !serverId}>刷新</button>
        <output className="muted">{busy ? '正在读取目录…' : entries.length + ' 项'}</output>
      </div>}
      {err && <div className="err" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      {!servers.length ? <div className="empty"><h2>连接你的媒体存储</h2><p>支持 OpenList、Nextcloud 等 WebDAV 服务。</p><button className="primary" onClick={openStorageSettings}>添加存储</button></div> : <>
        <nav className="dav-crumb" aria-label="文件路径">
          <button type="button" className="dav-crumb-item ui-action" aria-current={path === '/' ? 'page' : undefined} onClick={() => void browse(serverId, '/')}>{cur?.name || '根目录'}</button>
          {crumbs.map(crumb => <span key={crumb.path}><span className="muted" aria-hidden="true"> / </span><button type="button" className="dav-crumb-item ui-action" aria-current={crumb.path === path ? 'page' : undefined} onClick={() => void browse(serverId, crumb.path)}>{crumb.name}</button></span>)}
        </nav>
        {msg && <output className="status" style={{ display: 'block', marginBottom: 10 }}>{msg}</output>}
        {playUrl && <div className="dav-player"><VideoPlayer url={playUrl} /></div>}
        <div className="dav-list">
          {path !== '/' && <button type="button" className="dav-row ui-action" aria-label="返回上级目录" disabled={busy} onClick={() => void browse(serverId, davParentPath(path))}>
            <span className="dav-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 9 5-5 5 5M10 4v12" /></svg></span><span className="dav-name">返回上级</span>
          </button>}
          {entries.map(entry => <button type="button" key={entry.path} className="dav-row ui-action" disabled={busy} aria-label={(entry.isDir ? '打开文件夹 ' : '打开文件 ') + entry.name} onClick={() => void open(entry)} title={entry.path}>
            <span className="dav-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">{entry.isDir ? <path d="M2 5h6l2 2h8v9H2V5Z" /> : <><rect x="4" y="2" width="12" height="16" rx="2" /><path d="m8 7 5 3-5 3V7Z" /></>}</svg></span>
            <span className="dav-name">{entry.name}</span><span className="dav-size muted">{entry.isDir ? '' : fmtSize(entry.size)}</span><span className="dav-time muted">{fmtTime(entry.mtime)}</span>
          </button>)}
          {!entries.length && !busy && !err && <div className="empty">这个目录是空的</div>}
        </div>
      </>}
    </div>
  );
}
