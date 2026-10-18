import { useCallback, useEffect, useState } from 'react';
import { client } from '../../api/client';
import type { PlayerEngineView } from '../../../shared/plugin';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../../../shared/player';
import { useAppDialog } from '../../components/AppDialog';

export function PlayerEngineSettings({ active }: { active: boolean }) {
  const dialog = useAppDialog();
  const [items, setItems] = useState<PlayerEngineView[]>([]);
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_PLAYER_SETTINGS);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [engines, values] = await Promise.all([client.engineList(), client.playerPrefsGet()]);
    setItems(engines.filter(item => item.pluginId !== 'builtin'));
    setSettings(values);
  }, []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([client.engineList(), client.playerPrefsGet()]).then(([engines, values]) => {
      if (!alive) return;
      setItems(engines.filter(item => item.pluginId !== 'builtin')); setSettings(values);
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [active]);
  async function toggle(item: PlayerEngineView, enabled: boolean) {
    if (enabled && !settings.engineEnabled[item.id] && !(await dialog.confirm('启用插件播放内核「' + item.label + '」后，应用会运行该内核提供的本机程序' + (item.path ? '（' + item.path + '）' : '') + '。继续吗？', { title: '启用插件播放内核', confirmLabel: '启用' }))) return;
    setBusy(true); setError('');
    try {
      const result = await client.engineSetEnabled({ id: item.id, enabled });
      if (!result.ok) throw new Error(result.reason || '保存失败');
      await load(); window.dispatchEvent(new Event('winbox:engines-changed'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  async function savePath(item: PlayerEngineView) {
    setBusy(true); setError('');
    try {
      await client.playerPrefsSet({ enginePaths: { ...settings.enginePaths, [item.id]: (drafts[item.id] ?? settings.enginePaths[item.id] ?? '').trim() } });
      await load(); window.dispatchEvent(new Event('winbox:engines-changed'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }
  if (!active || !items.length) return null;
  return <section className="card" id="cfg-plugin-engines"><h3>插件播放内核</h3><p className="muted">启用后可在播放器的内核列表中选用。</p>{items.map(item => <div key={item.id}><label className="row"><input type="checkbox" checked={settings.engineEnabled[item.id] === true} disabled={busy} onChange={event => { void toggle(item, event.target.checked); }} /><span>{item.label}</span></label><p className="muted">{item.pluginName} · {item.ready ? '就绪' : item.note || '未就绪'}</p>{item.source === 'local-path' && <div className="row"><input aria-label={item.label + '程序路径'} placeholder="本机程序路径" value={drafts[item.id] ?? settings.enginePaths[item.id] ?? ''} onChange={event => setDrafts(value => ({ ...value, [item.id]: event.target.value }))} /><button type="button" disabled={busy} onClick={() => { void savePath(item); }}>保存路径</button></div>}</div>)}{error && <p className="err" role="alert">{error}</p>}</section>;
}
