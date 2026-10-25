import { parseToJsonArray, toLiveGroups } from '../../engine/live/TxtSubscribe';
import { buildEpgMap, parseXmltv, pickCurrentNext, type ParsedXmltv } from '../../engine/live/epg';
import type { SiteConfig } from '../../shared/types';
import type { EpgChannelRef, LiveBean, LiveEpgEntry, LiveEpgResult, LiveGroup, Logger } from '../../shared/types';
import { builtinLiveTemplates, type LiveTemplate } from '../plugin/pluginLiveTemplate';
import type { LiveTemplateView } from '../../shared/plugin';

export interface LiveLoadResult {
  groups: LiveGroup[];
  liveName: string;
}

/** The live playback use case talks to the app through these narrow ports. */
export interface LivePlaybackPorts {
  config(): SiteConfig | null;
  loadSpiderContent(live: LiveBean, config: SiteConfig): Promise<string>;
  fetchLiveText(url: string): Promise<string>;
  loadEpgText(url: string): Promise<string>;
  pluginTemplates?(): Promise<LiveTemplate[]>;
  logger: Pick<Logger, 'i' | 'w'>;
  now?(): number;
}

/**
 * Coordinates live source loading, EPG matching, and export rendering.
 * Network, spider, cache, clock, and plugin access are supplied by adapters.
 */
export class LivePlaybackService {
  constructor(private readonly ports: LivePlaybackPorts) {}

  get lives(): LiveBean[] {
    return this.ports.config()?.lives ?? [];
  }

  async load(index: number): Promise<LiveLoadResult> {
    const config = this.ports.config();
    if (!config || !config.lives.length) throw new Error('无直播配置');
    const live = config.lives[Math.min(index, config.lives.length - 1)];
    const raw = live.type === '3'
      ? await this.ports.loadSpiderContent(live, config)
      : await this.ports.fetchLiveText(live.url);
    return { groups: toLiveGroups(parseToJsonArray(raw)), liveName: live.name };
  }

  async templates(): Promise<LiveTemplateView[]> {
    return (await this.templateImplementations()).map((template) => ({
      id: template.id,
      pluginId: template.pluginId,
      label: template.label,
      format: template.format,
      ext: template.ext,
    }));
  }

  async renderExport(templateId: string, groups: LiveGroup[]): Promise<LiveTemplateView & { content: string }> {
    const list = await this.templateImplementations();
    const wanted = String(templateId || '').trim();
    const template = list.find((item) => item.id === wanted) ?? list[0];
    return {
      id: template.id,
      pluginId: template.pluginId,
      label: template.label,
      format: template.format,
      ext: template.ext,
      content: template.render(Array.isArray(groups) ? groups : [], { liveName: '' }),
    };
  }

  async loadEpg(index: number, refs: EpgChannelRef[]): Promise<LiveEpgResult> {
    const lives = this.ports.config()?.lives ?? [];
    const live = lives[Math.min(Math.max(index, 0), Math.max(lives.length - 1, 0))];
    const channels = Array.isArray(refs) ? refs : [];
    const urls = collectEpgUrls(live?.epg, channels);
    if (!urls.length || !channels.length) return { byKey: {} };

    const documents: ParsedXmltv[] = [];
    for (const url of urls) {
      try {
        documents.push(parseXmltv(await this.ports.loadEpgText(url)));
      } catch (error) {
        this.ports.logger.w(`EPG 跳过（${url}）：${(error as Error).message}`);
      }
    }
    if (!documents.length) return { byKey: {} };

    const programs = buildEpgMap(documents, channels, live?.timeZone || '');
    const now = (this.ports.now ?? Date.now)();
    const byKey: Record<string, LiveEpgEntry> = {};
    for (const [key, entries] of Object.entries(programs)) byKey[key] = pickCurrentNext(entries, now);
    this.ports.logger.i(`EPG：${urls.length} 个地址 / ${Object.keys(byKey).length} 个键命中（线路「${live?.name || index}」）`);
    return { byKey };
  }

  private async templateImplementations(): Promise<LiveTemplate[]> {
    const output = builtinLiveTemplates();
    const seen = new Set(output.map((template) => template.id));
    let plugins: LiveTemplate[] = [];
    try {
      plugins = (await this.ports.pluginTemplates?.()) ?? [];
    } catch (error) {
      this.ports.logger.w(`插件直播输出模板加载失败（已忽略）：${(error as Error).message}`);
      return output;
    }
    for (const template of plugins) {
      if (seen.has(template.id)) continue;
      seen.add(template.id);
      output.push(template);
    }
    return output;
  }
}

/** Collect valid XMLTV URLs in priority order, preserving first-seen order. */
export function collectEpgUrls(liveEpg: string | undefined, refs: EpgChannelRef[]): string[] {
  const output: string[] = [];
  const add = (raw: string): void => {
    const value = (raw || '').trim();
    if (!value || value.includes('{') || !/^https?:\/\//i.test(value)) return;
    const lower = value.toLowerCase();
    if (!lower.includes('xml') && !lower.includes('gz')) return;
    if (!output.includes(value)) output.push(value);
  };
  for (const url of (liveEpg || '').split(',')) add(url);
  for (const channel of refs) add(channel.epg || '');
  return output;
}
