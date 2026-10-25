import {
  danmakuSourceContributeOf,
  discoverSourceContributeOf,
  metaProviderContributeOf,
  shaderModes,
  shadersForMode,
  subtitleProviderContributeOf,
  themeContributeOf,
  validateDanmakuSourceContribute,
  validateDiscoverSourceContribute,
  validateKeymapContribute,
  validateLiveTemplateContribute,
  validateMetaProviderContribute,
  validatePlayerEngineContribute,
  validateSubtitleProviderContribute,
  validateThemeContribute,
  validateUiCommandContribute,
  validateUiSlotContribute,
  type KeymapContribute,
  type KeymapView,
  type LiveTemplateContribute,
  type PlayerEngineContribute,
  type PlayerEngineView,
  type SrState,
  type ThemeSkinView,
  type UiCommandContribute,
  type UiCommandView,
  type UiSlotContribute,
  type UiSlotView,
} from '../../shared/plugin';
import { playerEngineFromContribute } from './pluginPlayerEngine';
import type { EngineLaunchSpec } from '../player/PlayerEngineController';
import { subtitleProviderFromContribute } from './pluginSubtitleProvider';
import { metaProviderFromContribute, type MetaProvider } from './pluginMetaProvider';
import { discoverSourceFromContribute, type DiscoverSource } from './pluginDiscoverSource';
import { danmakuSourceFromContribute, type DanmakuSource } from './pluginDanmakuSource';
import { liveTemplateFromContribute, type LiveTemplate } from './pluginLiveTemplate';
import { uiCommandFromContribute } from './pluginUiCommand';
import { keymapFromContribute } from './pluginKeymap';
import { uiSlotFromContribute } from './pluginUiSlot';
import type { SubtitleProvider } from '../subtitle/provider';
import { srModeUsable } from '../../shared/player';
import type { PluginEntry } from './PluginRegistry';

export interface PluginContributionCatalogPorts {
  entries(): readonly PluginEntry[];
  enabled(pluginId: string): boolean;
  ready(entry: PluginEntry): boolean;
  enginePaths(): Record<string, string>;
  shaderPath(entry: PluginEntry, filename: string): string;
  fileExists(path: string): boolean;
}

/** Discovers, validates and adapts declarative plugin contributions for host features. */
export class PluginContributionCatalog {
  constructor(private readonly ports: PluginContributionCatalogPorts) {}

  async srState(wanted: unknown): Promise<SrState> {
    const modes = this.modesFrom(await this.srPlugins());
    return {
      available: modes.length > 0,
      modes,
      mode: srModeUsable(wanted, modes.map((m) => m.id)),
    };
  }

  async srShaders(mode: unknown): Promise<string[]> {
    const entries = await this.srPlugins();
    const modes = this.modesFrom(entries);
    const eff = srModeUsable(mode, modes.map((m) => m.id));
    if (eff === 'off') return [];
    const e = entries.find((entry) => this.modesOf(entry).some((m) => m.id === eff));
    if (!e) return [];
    return shadersForMode(e.manifest.contributes, 'mpv.shaders', eff)
      .map((n) => this.ports.shaderPath(e, n))
      .filter((p) => this.ports.fileExists(p));
  }

  async srModes(): Promise<Array<{ id: string; label: string }>> {
    return this.modesFrom(await this.srPlugins());
  }

  async themeSkins(): Promise<ThemeSkinView[]> {
    const out: ThemeSkinView[] = [];
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      const c = themeContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateThemeContribute(c).ok) continue; // 安装期已校验，这里兜一道
      out.push({
        id: `plugin:${c.id}`,
        pluginId: e.id,
        label: c.label,
        base: c.base,
        tokens: c.tokens,
        layout: c.layout ?? {},
      });
    }

    return out;
  }

  async subtitleProviders(): Promise<SubtitleProvider[]> {
    const out: SubtitleProvider[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      const c = subtitleProviderContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateSubtitleProviderContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(subtitleProviderFromContribute(c));
    }
    return out;
  }

  async metaProviders(): Promise<MetaProvider[]> {
    const out: MetaProvider[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      const c = metaProviderContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateMetaProviderContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(metaProviderFromContribute(c));
    }
    return out;
  }

  async discoverSources(): Promise<DiscoverSource[]> {
    const out: DiscoverSource[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      const c = discoverSourceContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateDiscoverSourceContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(discoverSourceFromContribute(c));
    }
    return out;
  }

  async danmakuSources(): Promise<DanmakuSource[]> {
    const out: DanmakuSource[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      const c = danmakuSourceContributeOf(e.manifest.contributes);
      if (!c) continue;
      if (!validateDanmakuSourceContribute(c).ok) continue; // 安装期已校验，这里兜一道
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(danmakuSourceFromContribute(c));
    }
    return out;
  }

  async liveTemplates(): Promise<LiveTemplate[]> {
    const out: LiveTemplate[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'live.template') continue;
        const c = raw as unknown as LiveTemplateContribute;
        if (!validateLiveTemplateContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ ...liveTemplateFromContribute(c), pluginId: e.id });
      }
    }
    return out;
  }

  async uiCommands(): Promise<UiCommandView[]> {
    const out: UiCommandView[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'ui.command') continue;
        const c = raw as unknown as UiCommandContribute;
        if (!validateUiCommandContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(uiCommandFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  async keymaps(): Promise<KeymapView[]> {
    const out: KeymapView[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'keymap') continue;
        const c = raw as unknown as KeymapContribute;
        if (!validateKeymapContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(keymapFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  async uiSlots(): Promise<UiSlotView[]> {
    const out: UiSlotView[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'ui.slot') continue;
        const c = raw as unknown as UiSlotContribute;
        if (!validateUiSlotContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(uiSlotFromContribute(c, { id: e.id, name: e.manifest.name }));
      }
    }
    return out;
  }

  async playerEngines(): Promise<PlayerEngineView[]> {
    const paths = this.ports.enginePaths();
    const out: PlayerEngineView[] = [];
    const seen = new Set<string>();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (e.manifest.kind !== 'code') continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'player.engine') continue;
        const c = raw as unknown as PlayerEngineContribute;
        if (!validatePlayerEngineContribute(c).ok) continue; // 安装期已校验，这里兜一道
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(playerEngineFromContribute(
          c,
          { id: e.id, name: e.manifest.name, dir: e.path },
          paths[`engine:${c.id}`] ?? '',
        ));
      }
    }
    return out;
  }

  async playerEngineSpec(id: string): Promise<EngineLaunchSpec | null> {
    const want = String(id || '');
    const paths = this.ports.enginePaths();
    for (const e of this.ports.entries()) {
      if (!this.ports.enabled(e.id)) continue;
      if (e.manifest.kind !== 'code') continue;
      if (!this.ports.ready(e)) continue;
      for (const raw of e.manifest.contributes ?? []) {
        if (raw?.type !== 'player.engine') continue;
        const c = raw as unknown as PlayerEngineContribute;
        if (`engine:${c.id}` !== want) continue;
        if (!validatePlayerEngineContribute(c).ok) return null;
        const view = playerEngineFromContribute(
          c,
          { id: e.id, name: e.manifest.name, dir: e.path },
          paths[`engine:${c.id}`] ?? '',
        );
        if (!view.ready || !view.path) return null;
        return { id: want, exe: view.path, args: [...(c.args ?? [])], protocol: c.protocol };
      }
    }
    return null;
  }

  modesOf(e: PluginEntry): Array<{ id: string; label: string }> {
    return shaderModes(e.manifest.contributes, 'mpv.shaders').map((m) => ({ id: m.id, label: m.label }));
  }

  private async srPlugins(): Promise<PluginEntry[]> {
    return this.ports.entries().filter((e) => this.ports.enabled(e.id)
      && this.ports.ready(e)
      && shaderModes(e.manifest.contributes, 'mpv.shaders').length > 0);
  }

  private modesFrom(entries: PluginEntry[]): Array<{ id: string; label: string }> {
    const seen = new Set<string>();
    const modes: Array<{ id: string; label: string }> = [];
    for (const entry of entries) {
      for (const mode of this.modesOf(entry)) {
        if (seen.has(mode.id)) continue;
        seen.add(mode.id);
        modes.push(mode);
      }
    }
    return modes;
  }
}
