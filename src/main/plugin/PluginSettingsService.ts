import {
  settingsEffectiveValue,
  settingsValueError,
  validateSettingsPanelContribute,
  type SettingsPanelContribute,
  type SettingsPanelView,
  type SettingsValue,
} from '../../shared/plugin';
import { settingsPanelFromContribute } from './pluginSettingsPanel';
import type { PluginEntry } from './PluginRegistry';
import type { PluginSettingsAccess } from './pluginHostApi';

export interface PluginSettingsPersistencePort {
  getObject<T>(key: string, fallback: T): T;
  setObjectStrict<T>(key: string, value: T): void;
}

export interface PluginSettingsServicePorts {
  entries(): readonly PluginEntry[];
  enabled(pluginId: string): boolean;
  ready(entry: PluginEntry): boolean;
  persistence: PluginSettingsPersistencePort;
}

/** Owns contribution validation and persistence for plugin settings panels. */
export class PluginSettingsService {
  constructor(private readonly ports: PluginSettingsServicePorts) {}

  panels(): SettingsPanelView[] {
    const out: SettingsPanelView[] = [];
    const seen = new Set<string>();
    for (const entry of this.ports.entries()) {
      if (!this.ports.enabled(entry.id) || !this.ports.ready(entry)) continue;
      const stored = this.ports.persistence.getObject<Record<string, Record<string, unknown>>>(entry.id, {});
      for (const raw of entry.manifest.contributes ?? []) {
        if (raw?.type !== 'settings.panel') continue;
        const contribution = raw as unknown as SettingsPanelContribute;
        if (!validateSettingsPanelContribute(contribution).ok || seen.has(contribution.id)) continue;
        seen.add(contribution.id);
        out.push(settingsPanelFromContribute(
          contribution,
          { id: entry.id, name: entry.manifest.name },
          stored[contribution.id],
        ));
      }
    }
    return out;
  }

  set(input: { id?: unknown; panelId?: unknown; key?: unknown; value?: unknown }): {
    ok: boolean;
    reason?: string;
    panels?: SettingsPanelView[];
  } {
    const pluginId = String(input?.id ?? '');
    const panelId = String(input?.panelId ?? '');
    const key = String(input?.key ?? '');
    if (!pluginId || !panelId || !key) return { ok: false, reason: '参数不完整' };
    const entry = this.ports.entries().find((item) => item.id === pluginId);
    if (!entry || !this.ports.enabled(entry.id) || !this.ports.ready(entry)) {
      return { ok: false, reason: '插件不存在或未启用' };
    }
    const panel = (entry.manifest.contributes ?? []).find(
      (item) => item?.type === 'settings.panel' && (item as { id?: unknown }).id === panelId,
    ) as unknown as SettingsPanelContribute | undefined;
    if (!panel || !validateSettingsPanelContribute(panel).ok) return { ok: false, reason: '设置面板不存在' };
    const field = panel.fields.find((item) => item.key === key);
    if (!field) return { ok: false, reason: '未知设置项：' + key };
    const error = settingsValueError(field, input.value);
    if (error) return { ok: false, reason: field.label + '：' + error };

    const all = this.ports.persistence.getObject<Record<string, Record<string, unknown>>>(entry.id, {});
    const bucket = { ...all[panelId], [key]: input.value as SettingsValue };
    try {
      this.ports.persistence.setObjectStrict(entry.id, { ...all, [panelId]: bucket });
    } catch (error) {
      return { ok: false, reason: persistenceFailure(error) };
    }
    return { ok: true, panels: this.panels() };
  }

  access(): PluginSettingsAccess {
    const findField = (pluginId: string, key: string): {
      panelId: string;
      field: SettingsPanelContribute['fields'][number];
    } | undefined => {
      const entry = this.ports.entries().find((item) => item.id === pluginId);
      if (!entry) return undefined;
      for (const raw of entry.manifest.contributes ?? []) {
        if (raw?.type !== 'settings.panel') continue;
        const panel = raw as unknown as SettingsPanelContribute;
        if (!validateSettingsPanelContribute(panel).ok) continue;
        const field = panel.fields.find((item) => item.key === key);
        if (field) return { panelId: panel.id, field };
      }
      return undefined;
    };

    return {
      get: (pluginId, key) => {
        const found = findField(pluginId, key);
        if (!found) return undefined;
        const stored = this.ports.persistence.getObject<Record<string, Record<string, unknown>>>(pluginId, {});
        return settingsEffectiveValue(found.field, stored[found.panelId]?.[key]);
      },
      set: (pluginId, key, value) => {
        const entry = this.ports.entries().find((item) => item.id === pluginId);
        if (!entry) throw new Error('插件不存在');
        const found = findField(pluginId, key);
        if (!found) throw new Error('未知设置项：' + key);
        const error = settingsValueError(found.field, value);
        if (error) throw new Error(found.field.label + '：' + error);
        const all = this.ports.persistence.getObject<Record<string, Record<string, unknown>>>(pluginId, {});
        const bucket = { ...all[found.panelId], [key]: value as SettingsValue };
        try {
          this.ports.persistence.setObjectStrict(pluginId, { ...all, [found.panelId]: bucket });
        } catch (error) {
          throw new Error(persistenceFailure(error));
        }
      },
    };
  }
}

function persistenceFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `保存插件设置失败：${detail}`;
}

