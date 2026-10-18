import { useEffect, useState } from 'react';
import type { KeymapView } from '../../../shared/plugin';
import { client } from '../../api/client';

export function PluginKeymapList({ active }: { active: boolean }) {
  const [items, setItems] = useState<KeymapView[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.resolve().then(() => client.pluginKeymaps()).then(value => { if (alive) setItems(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [active]);
  if (!active || !items.length) return null;
  return <section className="card" id="cfg-plugin-keymap"><h3>插件快捷键</h3>{items.map(item => <div key={item.id} className="row"><kbd>{item.key}</kbd><span>{item.label}</span><span className="muted">{item.scope.map(scope => scope === 'player' ? '播放器' : '主窗口').join(' / ')} · {item.pluginName}</span></div>)}</section>;
}
