import { useEffect, useState } from 'react';
import type { KeymapView } from '../../../shared/plugin';
import type { PluginKeymapListPort } from './application/settingsSectionPorts';

export function PluginKeymapList({ active, port }: { active: boolean; port: PluginKeymapListPort }) {
  const [items, setItems] = useState<KeymapView[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.resolve().then(() => port.listKeymaps()).then(value => { if (alive) setItems(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [active, port]);
  if (!active || !items.length) return null;
  return <section className="card" id="cfg-plugin-keymap"><h3>插件快捷键</h3>{items.map(item => <div key={item.id} className="row"><kbd>{item.key}</kbd><span>{item.label}</span><span className="muted">{item.scope.map(scope => scope === 'player' ? '播放器' : '主窗口').join(' / ')} · {item.pluginName}</span></div>)}</section>;
}
