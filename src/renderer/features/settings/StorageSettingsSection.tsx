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
      const saved = await client.davSet(draft);
      const result = await client.davBrowse({ id: saved.id, path: '/' });
      setServers(await loadServers());
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
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            在「存储」页浏览并播放自建存储里的视频。取流时凭据由本机中继注入，不会出现在播放地址里。
          </span>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none', width: 48 }}>名称</span>
            <input style={{ width: 170 }} placeholder="我的 OpenList" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            <span className="muted" style={{ fontSize: 11, flex: 'none', width: 48 }}>地址</span>
            <input style={{ width: 320, fontFamily: 'monospace' }} placeholder="https://host:5244/dav" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} />
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none', width: 48 }}>用户名</span>
            <input style={{ width: 170 }} value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} />
            <span className="muted" style={{ fontSize: 11, flex: 'none', width: 48 }}>密码</span>
            <input style={{ width: 170 }} type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            <button className="primary" disabled={busy} onClick={() => void saveServer()}>{draft.id ? '保存修改' : '添加'}</button>
            <button disabled={busy || !draft.url} onClick={() => void testServer()}>测试连接</button>
            {draft.id && <button disabled={busy} onClick={() => setDraft({ ...EMPTY_SERVER })}>取消编辑</button>}
          </div>
          {message && <span className={message.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }} aria-live="polite">{message.text}</span>}
        </div>
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 16 }}>
        {servers.length ? (
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
        ) : (
          <div className="empty">还没有添加存储</div>
        )}
      </div>
    </>
  );
}
