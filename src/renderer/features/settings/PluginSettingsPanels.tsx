import { useState } from 'react';
import type { SettingsPanelView, SettingsFieldView } from '../../../shared/plugin';

export function PluginSettingsPanels({ pluginId, panels, busy, onSave }: { pluginId: string; panels: SettingsPanelView[]; busy: boolean; onSave(id: string, panelId: string, key: string, value: unknown): Promise<boolean> }) {
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const renderSettingField = (pluginId: string, panel: SettingsPanelView, f: SettingsFieldView) => {
    const dk = `${pluginId}|${panel.id}|${f.key}`;
    const clearDraft = (): void => {
      setSettingDrafts((d) => {
        if (!(dk in d)) return d;
        const n = { ...d };
        delete n[dk];
        return n;
      });
    };
    const commit = (value: unknown): void => {
      void onSave(pluginId, panel.id, f.key, value).then(saved => { if (saved) clearDraft(); });
    };
    if (f.type === 'toggle') {
      return <input type="checkbox" checked={f.value === true} disabled={busy} onChange={(e) => commit(e.target.checked)} />;
    }
    if (f.type === 'select') {
      return (
        <select value={String(f.value)} disabled={busy} onChange={(e) => commit(e.target.value)}>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label || o.value}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={f.type === 'number' ? 'number' : 'text'}
        value={settingDrafts[dk] ?? String(f.value)}
        disabled={busy}
        min={f.min}
        max={f.max}
        step={f.step}
        maxLength={f.maxLength}
        placeholder={f.placeholder}
        style={{ width: f.type === 'number' ? 140 : 240 }}
        onChange={(e) => setSettingDrafts((d) => ({ ...d, [dk]: e.target.value }))}
        onBlur={(e) => {
          // ★ 直接读 **DOM 当前值**（不依赖「草稿 state 是否已重渲染」——同步派发 input+blur 时闭包里的草稿会是旧值）
          const v = e.target.value;
          if (v === String(f.value)) { clearDraft(); return; } // 没改就不重复写盘
          commit(f.type === 'number' ? Number(v) : v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
        }}
      />
    );
  };

  return <>{panels.filter(panel => panel.pluginId === pluginId).map(panel => <section key={panel.id} className="plugin-settings-panel"><h3 title={panel.title || undefined}>{panel.label}</h3>{panel.fields.map(field => <label key={field.key} className="row"><span title={field.hint || undefined}>{field.label}</span>{renderSettingField(pluginId, panel, field)}</label>)}</section>)}</>;
}
