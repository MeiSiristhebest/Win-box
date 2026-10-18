import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import { loadSkinRegistry } from '../../lib/theme';
import { useAppDialog } from '../../components/AppDialog';
import { PERMISSION_LABELS, type PluginView, type SettingsPanelView, type UiCommandView } from '../../../shared/plugin';
import { commandsFor, runPluginCommand } from '../../lib/pluginCommands';
import { PluginSettingsPanels } from './PluginSettingsPanels';

const permissionLabels: Readonly<Record<string, string>> = PERMISSION_LABELS;

export function PluginSettingsSection({ active }: { active: boolean }) {
  const dialog = useAppDialog();
  const [pluginItems, setPluginItems] = useState<PluginView[]>([]);
  const [pluginMsg, setPluginMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [panels, setPanels] = useState<SettingsPanelView[]>([]);
  const [commands, setCommands] = useState<UiCommandView[]>([]);
  const loadRequest = useRef(0);
  const loadPlugins = useCallback(async () => {
    const request = ++loadRequest.current;
    const [items, settings, actions] = await Promise.allSettled([
      Promise.resolve().then(() => client.pluginList()),
      Promise.resolve().then(() => client.pluginSettings()),
      Promise.resolve().then(() => client.pluginCommands()),
    ] as const);
    if (request !== loadRequest.current) return;
    if (items.status === 'fulfilled') setPluginItems(items.value);
    else setPluginMsg({ text: String(items.reason), kind: 'err' });
    if (settings.status === 'fulfilled') setPanels(settings.value);
    if (actions.status === 'fulfilled') setCommands(commandsFor(actions.value, 'config'));
  }, []);
  useEffect(() => {
    if (!active) return;
    void Promise.resolve().then(loadPlugins);
    return () => { loadRequest.current += 1; };
  }, [active, loadPlugins]);

  const applyPluginResult = (result: { items?: PluginView[]; reason?: string }, text: string) => {
    if (result.items) { setPluginItems(result.items); void loadSkinRegistry(); }
    setPluginMsg(result.reason ? { text: result.reason, kind: 'err' } : { text, kind: 'ok' });
    void loadPlugins();
    window.dispatchEvent(new Event('winbox:plugins-changed'));
  };
  const installPlugin = async () => {
    setPluginBusy(true);
    try {
      const inspection = await client.pluginInspect();
      if (inspection.canceled) return;
      if (!inspection.ok || !inspection.path) throw new Error(inspection.reason || inspection.reasonCode || '插件包无效');
      if (inspection.kind === 'code') {
        const permissions = (inspection.permissions ?? []).map(permission => permission + '：' + (inspection.permissionNotes?.[permission] || permissionLabels[permission] || '')).join('\n');
        if (!(await dialog.confirm('插件：' + inspection.name + '\n' + permissions + '\n代码将在独立沙箱中运行。是否安装？', { title: '确认插件权限', confirmLabel: '确认安装' }))) return;
      }
      const result = await client.pluginInstall({ path: inspection.path });
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
  const saveSetting = async (id: string, panelId: string, key: string, value: unknown): Promise<boolean> => {
    try {
      const result = await client.pluginSettingSet({ id, panelId, key, value });
      if (result.panels) setPanels(result.panels);
      if (!result.ok) setPluginMsg({ text: result.reason || '保存失败', kind: 'err' });
      return result.ok;
    } catch (cause) { setPluginMsg({ text: String(cause), kind: 'err' }); return false; }
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
      {commands.length > 0 && <section className="card"><h3>插件命令</h3><div className="row">{commands.map(command => <button key={command.id} type="button" disabled={pluginBusy} title={command.title || command.label} onClick={() => { void runPluginCommand(command, message => dialog.confirm(message, { title: command.label })).then(result => setPluginMsg({ text: result.message, kind: result.ok ? 'ok' : 'err' })); }}>{command.label}</button>)}</div></section>}
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
              <PluginSettingsPanels pluginId={p.id} panels={panels} busy={pluginBusy} onSave={saveSetting} />
              {p.kind === 'code' && <span className={p.sandbox?.error ? 'err' : 'muted'}>{p.sandbox?.running ? '沙箱运行中' : p.sandbox?.error || '沙箱未运行'}</span>}
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
