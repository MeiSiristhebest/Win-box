import type { DavServer } from '../../../shared/webdav';
import type { StorageSettingsViewActions, StorageSettingsViewModel } from './storageSettingsViewModel';

interface StorageSettingsViewProps {
  model: StorageSettingsViewModel;
  actions: StorageSettingsViewActions;
}

function Message({ message }: { message: StorageSettingsViewModel['message'] }) {
  if (!message) return null;
  const className = message.kind === 'err' ? 'err' : 'status';
  const style = message.kind === 'warn' ? { margin: 0, color: 'var(--text-warn)' } : { margin: 0 };
  return <span className={className} style={style} role={message.kind === 'err' ? 'alert' : 'status'}>{message.text}</span>;
}

function ServerTable({ servers, busy, onEdit, onRemove }: {
  servers: DavServer[];
  busy: boolean;
  onEdit(server: DavServer): void;
  onRemove(server: DavServer): void;
}) {
  if (!servers.length) return <div className="empty">还没有添加存储</div>;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The scroll region needs focus for keyboard scrolling.
    <section className="table-scroll" aria-label="已保存存储" tabIndex={0}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>名称</th>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>地址</th>
          <th style={{ textAlign: 'left', padding: '4px 6px' }}>用户名</th>
          <th style={{ textAlign: 'right', padding: '4px 6px' }}>操作</th>
        </tr></thead>
        <tbody>{servers.map((server) => (
          <tr key={server.id}>
            <td style={{ padding: '4px 6px' }}>{server.name}</td>
            <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{server.url}</td>
            <td style={{ padding: '4px 6px' }}>{server.username || '—'}</td>
            <td style={{ padding: '4px 6px', textAlign: 'right' }}>
              <button type="button" disabled={busy} onClick={() => onEdit(server)}>编辑</button>{' '}
              <button type="button" disabled={busy} onClick={() => onRemove(server)}>删除</button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export function StorageSettingsView({ model, actions }: StorageSettingsViewProps) {
  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="import-heading"><h3>{model.draft.id ? '编辑存储' : '添加存储'}</h3><p>连接 WebDAV 服务，在「存储」页浏览和播放视频。</p></div>
          <div className="settings-form-grid">
            <label>名称<input aria-label="存储名称" disabled={model.busy} placeholder="例如：家庭媒体库" value={model.draft.name} onChange={(event) => actions.updateDraft({ name: event.target.value })} /></label>
            <label>WebDAV 地址<input aria-label="存储地址" disabled={model.busy} placeholder="https://host:5244/dav" value={model.draft.url} onChange={(event) => actions.updateDraft({ url: event.target.value })} /></label>
            <label>用户名<input aria-label="存储用户名" disabled={model.busy} value={model.draft.username} onChange={(event) => actions.updateDraft({ username: event.target.value })} /></label>
            <label>密码<input aria-label="存储密码" disabled={model.busy} type="password" value={model.draft.password} onChange={(event) => actions.updateDraft({ password: event.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="primary" disabled={model.busy || !model.draft.url.trim()} onClick={() => void actions.save()}>{model.draft.id ? '保存修改' : '添加存储'}</button>
            <button type="button" disabled={model.busy || !model.draft.url} onClick={() => void actions.test()}>测试连接</button>
            {model.draft.id && <button type="button" disabled={model.busy} onClick={actions.clearDraft}>取消编辑</button>}
            <Message message={model.message} />
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 className="settings-list-heading">已保存连接</h3>
          <button type="button" disabled={model.refreshing || model.busy} onClick={() => void actions.refresh()}>{model.refreshing ? '正在刷新…' : '刷新列表'}</button>
        </div>
        {model.loadState === 'loading' ? <div className="empty">正在读取存储列表…</div>
          : model.loadState === 'error' ? <div className="empty"><span className="err" role="alert">{model.listError ?? '存储列表读取失败'}</span> <button type="button" onClick={() => void actions.refresh()}>重新读取</button></div>
            : <>
              {model.listError && <p className="err" role="alert">{model.listError}</p>}
              <ServerTable servers={model.servers} busy={model.busy} onEdit={actions.edit} onRemove={(server) => void actions.remove(server)} />
            </>}
      </div>
    </>
  );
}
