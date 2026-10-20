import { useCallback, useEffect, useState } from 'react';
import { client } from '../../api/client';
import { useAppDialog } from '../../components/AppDialog';
import type { DavServer } from '../../../shared/webdav';

const EMPTY_SERVER: DavServer = { id: '', name: '', url: '', username: '', password: '' };

export function StorageSettingsSection({ active }: { active: boolean }) {
  const dialog = useAppDialog();
  const [servers, setServers] = useState<DavServer[]>([]);
  const [draft, setDraft] = useState<DavServer>(EMPTY_SERVER);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadServers = useCallback(() => client.davList(), []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void loadServers()
      .then((next) => {
        if (current) setServers(next);
      })
      .catch((error) => {
        if (current) setMessage({ text: (error as Error).message, kind: 'err' });
      });
    return () => {
      current = false;
    };
  }, [active, loadServers]);

  async function saveServer() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await client.davSet(draft);
      setServers(await loadServers());
      setDraft({ ...EMPTY_SERVER });
      setMessage({ text: `已保存「${saved.name}」`, kind: 'ok' });
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function removeServer(server: DavServer) {
    if (!(await dialog.confirm(`确定删除存储「${server.name}」？`, { title: '删除存储', confirmLabel: '删除', tone: 'danger' }))) return;
    setBusy(true);
    setMessage(null);
    try {
      await client.davRemove(server.id);
      if (draft.id === server.id) setDraft({ ...EMPTY_SERVER });
      setServers(await loadServers());
      setMessage({ text: `已删除「${server.name}」`, kind: 'ok' });
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function testServer() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.davTest(draft);
      setMessage({ text: `连接成功：${result.path} 下 ${result.entries.length} 项`, kind: 'ok' });
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="import-heading"><h3>{draft.id ? '编辑存储' : '添加存储'}</h3><p>连接 WebDAV 服务，在「存储」页浏览和播放视频。</p></div>
          <div className="settings-form-grid">
            <label>名称<input aria-label="存储名称" disabled={busy} placeholder="例如：家庭媒体库" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>WebDAV 地址<input aria-label="存储地址" disabled={busy} placeholder="https://host:5244/dav" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} /></label>
            <label>用户名<input aria-label="存储用户名" disabled={busy} value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} /></label>
            <label>密码<input aria-label="存储密码" disabled={busy} type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} /></label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary" disabled={busy || !draft.url.trim()} onClick={() => void saveServer()}>{draft.id ? '保存修改' : '添加存储'}</button>
            <button disabled={busy || !draft.url} onClick={() => void testServer()}>测试连接</button>
            {draft.id && <button disabled={busy} onClick={() => setDraft({ ...EMPTY_SERVER })}>取消编辑</button>}
          </div>
          {message && <span className={message.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }} aria-live="polite">{message.text}</span>}
        </div>
      </div>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <h3 className="settings-list-heading">已保存连接</h3>
        {servers.length ? (
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scroll region needs focus for keyboard scrolling.
          <section className="table-scroll" aria-label="已保存存储" tabIndex={0}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>名称</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>地址</th>
                <th style={{ textAlign: 'left', padding: '4px 6px' }}>用户名</th>
                <th style={{ textAlign: 'right', padding: '4px 6px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.id}>
                  <td style={{ padding: '4px 6px' }}>{server.name}</td>
                  <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{server.url}</td>
                  <td style={{ padding: '4px 6px' }}>{server.username || '—'}</td>
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                    <button onClick={() => { setDraft({ ...server }); setMessage(null); }}>编辑</button>{' '}
                    <button onClick={() => void removeServer(server)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </section>
        ) : (
          <div className="empty">还没有添加存储</div>
        )}
      </div>
    </>
  );
}
