import { useCallback, useEffect, useState } from 'react';
import { client } from '../../api/client';
import { useAppDialog } from '../../components/AppDialog';
import type { PluginView } from '../../../shared/plugin';

export function PluginSettingsSection({ active }: { active: boolean }) {
  const dialog = useAppDialog();
  const [pluginItems, setPluginItems] = useState<PluginView[]>([]);
  const [pluginMsg, setPluginMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const loadPlugins = useCallback(async () => {
    try { setPluginItems(await client.pluginList()); }
    catch (error) { setPluginMsg({ text: String(error), kind: 'err' }); }
  }, []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.resolve().then(() => client.pluginList()).then(items => {
      if (alive) setPluginItems(items);
    }).catch(error => { if (alive) setPluginMsg({ text: String(error), kind: 'err' }); });
    return () => { alive = false; };
  }, [active]);

  const applyPluginResult = (result: { items?: PluginView[]; reason?: string }, text: string) => {
    if (result.items) setPluginItems(result.items);
    setPluginMsg(result.reason ? { text: result.reason, kind: 'err' } : { text, kind: 'ok' });
  };
  const installPlugin = async () => {
    setPluginBusy(true);
    try {
      const result = await client.pluginInstall();
      if (!result.canceled) applyPluginResult(result, '安装成功');
    } catch (error) { setPluginMsg({ text: String(error), kind: 'err' }); }
    finally { setPluginBusy(false); }
  };
  const uninstallPlugin = async (id: string, name: string) => {
    if (!(await dialog.confirm('卸载插件「' + name + '」？插件目录会被删除；随包插件在下次启动时重新安装。', { title: '卸载插件', confirmLabel: '卸载', tone: 'danger' }))) return;
    setPluginBusy(true);
    try { applyPluginResult(await client.pluginUninstall(id), '已卸载'); }
    catch (error) { setPluginMsg({ text: String(error), kind: 'err' }); }
    finally { setPluginBusy(false); }
  };
  const togglePluginEnabled = async (id: string, enabled: boolean) => {
    setPluginBusy(true);
    try { applyPluginResult(await client.pluginSetEnabled({ id, enabled }), enabled ? '已启用' : '已停用'); }
    catch (error) { setPluginMsg({ text: String(error), kind: 'err' }); }
    finally { setPluginBusy(false); }
  };
  if (!active) return null;
  return (<>

      <div className="card" id="cfg-plugins" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>插件 / 组件</span>
          <span className="muted" style={{ fontSize: 11 }}>
            插件是独立打包的 <b>.winbox</b>（zip）单元：官方插件随软件附带，装第三方插件请选
            <b>本地 .winbox 文件</b>安装。停用会保留磁盘内容、只是不生效；卸载会删掉插件目录
            （随包官方插件下次启动会重新就位）。
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" disabled={pluginBusy} onClick={() => void installPlugin()}>安装插件…</button>
            <button disabled={pluginBusy} onClick={() => void loadPlugins()}>刷新</button>
            <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
              共 {pluginItems.length} 个
            </span>
          </div>
          {pluginMsg && (
            <span className={pluginMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0, wordBreak: 'break-all' }}>
              {pluginMsg.text}
            </span>
          )}
        </div>
      </div>
      {pluginItems.length === 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            还没有插件。安装官方超分插件后，播放器（MPV 内核）里会出现「超分」档位按钮。
          </span>
        </div>
      ) : (
        pluginItems.map((p) => (
          <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>{p.id} · v{p.version}</span>
                <span className="tag" title="插件来源">{p.source === 'builtin' ? '随包官方' : '用户安装'}</span>
                <span className="tag" title="能力分级">{p.level}</span>
                {p.modes.length > 0 && (
                  <span className="tag" title="贡献的档位">档位 {p.modes.map((m) => m.label).join('/')}</span>
                )}
                <span className={!p.ready ? 'err' : 'status'} style={{ margin: 0, fontSize: 11 }}>
                  {p.ready ? (p.enabled ? '已启用' : '已停用') : '未就位（载荷缺失）'}
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {/* 启停：与第三方统一（停用保留磁盘、不参与宿主装配） */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={pluginBusy}
                    onChange={(e) => void togglePluginEnabled(p.id, e.target.checked)}
                  />
                  <span>启用</span>
                </label>
                <button
                  className=""
                  style={{ marginLeft: 'auto' }}
                  disabled={pluginBusy}
                  onClick={() => void uninstallPlugin(p.id, p.name)}
                >
                  卸载
                </button>
              </div>
            </div>
          </div>
        ))
      )}

  </>);
}
