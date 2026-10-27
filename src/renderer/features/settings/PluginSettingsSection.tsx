import { useAppDialog } from '../../components/AppDialog';
import type { PluginSettingsDependencies } from './application/settingsSectionPorts';
import { PluginSettingsPanels } from './PluginSettingsPanels';
import { usePluginSettingsPresenter } from './usePluginSettingsPresenter';

export function PluginSettingsSection({ active, dependencies }: { active: boolean; dependencies: PluginSettingsDependencies }) {
  const dialog = useAppDialog();
  const presenter = usePluginSettingsPresenter(dependencies, dialog.confirm, active);
  if (!active) return null;
  return (<>

      <div className="card" id="cfg-plugins" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>插件 / 组件</span>
          <span className="muted" style={{ fontSize: 12 }}>
            插件是独立打包的 <b>.winbox</b>（zip）单元：官方插件随软件附带，装第三方插件请选
            <b>本地 .winbox 文件</b>安装。停用会保留磁盘内容、只是不生效；卸载会删掉插件目录
            （随包官方插件下次启动会重新就位）。
          </span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" disabled={presenter.pluginBusy} onClick={() => void presenter.installPlugin()}>安装插件…</button>
            <button disabled={presenter.pluginBusy || presenter.pluginsStatus === 'loading'} onClick={() => void presenter.loadPlugins()}>刷新</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {presenter.pluginsStatus === 'loading' ? '正在加载插件…' : `共 ${presenter.pluginItems.length} 个`}
            </span>
          </div>
          {presenter.pluginMessage && (
            <span className={presenter.pluginMessage.kind === 'err' ? 'err' : 'status'} style={{ margin: 0, wordBreak: 'break-all', ...(presenter.pluginMessage.kind === 'warn' ? { color: 'var(--text-warn)' } : {}) }} role={presenter.pluginMessage.kind === 'err' ? 'alert' : 'status'}>
              {presenter.pluginMessage.text}
            </span>
          )}
        </div>
      </div>
      {presenter.loadErrors.map((error) => <div key={error} role="alert" className="err">{error}</div>)}
      {presenter.commands.length > 0 && <section className="card"><h3>插件命令</h3><div className="row">{presenter.commands.map(command => <button key={command.id} type="button" disabled={presenter.pluginBusy} title={command.title || command.label} onClick={() => { void presenter.executeCommand(command); }}>{command.label}</button>)}</div></section>}
      {presenter.pluginsStatus === 'failed' && presenter.pluginItems.length === 0 ? (
        <div className="card" role="alert" style={{ padding: 12 }}>
          <span className="err">无法确认当前安装了哪些插件。请检查后重试。</span>
          <button type="button" disabled={presenter.pluginBusy} onClick={() => void presenter.loadPlugins()}>重试</button>
        </div>
      ) : presenter.pluginItems.length === 0 ? (
        <div className="card" style={{ padding: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>{presenter.pluginsStatus === 'loading' ? '正在读取插件列表…' : '还没有插件。安装官方超分插件后，播放器（MPV 内核）里会出现「超分」档位按钮。'}</span>
        </div>
      ) : (
        presenter.pluginItems.map((p) => (
          <div key={p.id} className="card" style={{ padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>{p.id} · v{p.version}</span>
                <span className="tag" title="插件来源">{p.source === 'builtin' ? '随包官方' : '用户安装'}</span>
                <span className="tag" title="能力分级">{p.level}</span>
                {p.modes.length > 0 && (
                  <span className="tag" title="贡献的档位">档位 {p.modes.map((m) => m.label).join('/')}</span>
                )}
                <span className={!p.ready ? 'err' : 'status'} style={{ margin: 0, fontSize: 12 }}>
                  {p.ready ? (p.enabled ? '已启用' : '已停用') : '未就位（载荷缺失）'}
                </span>
              </div>
              {presenter.panelsStatus === 'failed' ? <div role="alert" className="err">插件设置面板加载失败，无法显示或保存该插件设置。</div>
                : <PluginSettingsPanels pluginId={p.id} panels={presenter.panels} busy={presenter.pluginBusy} onSave={presenter.saveSetting} />}
              {p.kind === 'code' && <span className={p.sandbox?.error ? 'err' : 'muted'}>{p.sandbox?.running ? '沙箱运行中' : p.sandbox?.error || '沙箱未运行'}</span>}
              <div className="row" style={{ gap: 8 }}>
                {/* 启停：与第三方统一（停用保留磁盘、不参与宿主装配） */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={presenter.pluginBusy}
                    onChange={(e) => void presenter.togglePluginEnabled(p.id, e.target.checked)}
                  />
                  <span>启用</span>
                </label>
                <button
                  className=""
                  style={{ marginLeft: 'auto' }}
                  disabled={presenter.pluginBusy}
                  onClick={() => void presenter.uninstallPlugin(p.id, p.name)}
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
