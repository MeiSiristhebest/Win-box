import type {
  SubtitleCandidate,
  SubtitleFetchResult,
  SubtitleProviderView,
  SubtitleSearchReport,
  SubtitleSettings,
} from '../../shared/subtitle';
import { createSubtitleSearchContext } from '../../engine/subtitle/searchContext';
import type { SubtitleProvider } from './provider';
import { fetchSubtitle, providerSettingsView, searchSubtitles, SUBTITLE_PROVIDERS } from './index';

export interface SubtitleSettingsPort {
  get(): SubtitleSettings;
  set(settings: SubtitleSettings): void;
  update(patch: Partial<SubtitleSettings>): SubtitleSettings;
}

export interface SubtitleServiceOptions {
  settings: SubtitleSettingsPort;
  plugins: { list(): Promise<SubtitleProvider[]> };
  logger: { w(message: string): void };
  builtInProviders?: readonly SubtitleProvider[];
}

/** Coordinates subtitle settings and provider calls; persistence and plugin discovery stay behind ports. */
export class SubtitleService {
  private readonly builtInProviders: readonly SubtitleProvider[];

  constructor(private readonly options: SubtitleServiceOptions) {
    this.builtInProviders = options.builtInProviders ?? SUBTITLE_PROVIDERS;
  }

  getSettings(): SubtitleSettings {
    return this.options.settings.get();
  }

  setSettings(settings: SubtitleSettings): void {
    this.options.settings.set(settings);
  }

  updateSettings(patch: Partial<SubtitleSettings>): SubtitleSettings {
    return this.options.settings.update(patch);
  }

  async providerView(): Promise<SubtitleProviderView[]> {
    return providerSettingsView(this.getSettings(), await this.providers());
  }

  async search(resourceName: string): Promise<SubtitleSearchReport> {
    const context = createSubtitleSearchContext(resourceName, this.getSettings());
    if (!context.keywords.length) throw new Error('无法从该资源名提取剧名');
    const report = await searchSubtitles(context, await this.providers());
    for (const provider of report.providers) {
      this.options.logger.w(
        `字幕源 ${provider.id}：${provider.ok ? `命中 ${provider.count}` : provider.skipped ? '跳过' : '失败'}${provider.reason ? ' — ' + provider.reason : ''}`,
      );
    }
    return report;
  }

  async fetch(candidate: SubtitleCandidate): Promise<SubtitleFetchResult> {
    if (!candidate || !candidate.file) return { text: '', fileName: '', reason: '字幕候选缺少下载标识' };
    const context = createSubtitleSearchContext(candidate.subname || '', this.getSettings());
    return fetchSubtitle(candidate, context, await this.providers());
  }

  private async providers(): Promise<SubtitleProvider[]> {
    let plugins: SubtitleProvider[] = [];
    try {
      plugins = (await this.options.plugins.list()) ?? [];
    } catch (error) {
      this.options.logger.w(`插件字幕源加载失败（已忽略）：${error instanceof Error ? error.message : String(error)}`);
    }

    const seen = new Set(this.builtInProviders.map((provider) => provider.id));
    const result = [...this.builtInProviders];
    for (const provider of plugins) {
      if (!provider || !provider.id || seen.has(provider.id)) continue;
      seen.add(provider.id);
      result.push(provider);
    }
    return result;
  }
}
