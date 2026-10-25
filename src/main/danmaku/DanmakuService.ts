import type { Logger } from '../../shared/types';
import type { DanmakuAnime, DanmakuApiEndpoint, DanmakuCandidate, DanmakuSettings } from '../../shared/danmaku';

export interface DanmakuSourcePort {
  readonly key: string;
  readonly name: string;
  search(keyword: string, season?: number): Promise<DanmakuAnime[]>;
  episodes(animeId: number, animeTitle?: string): Promise<DanmakuCandidate[]>;
  comment(episodeId: number): Promise<string>;
}

export interface DanmakuSettingsPort {
  readonly settings: DanmakuSettings;
  update(patch: Partial<DanmakuSettings>): DanmakuSettings;
}

export interface DanmakuSourceCatalogPort {
  list(): Promise<readonly DanmakuSourcePort[]>;
}

export interface DanmakuApiPort {
  searchAnime(endpoint: string, keyword: string, sourceName: string): Promise<DanmakuAnime[]>;
  episodes(endpoint: string, animeId: number, sourceName: string, animeTitle?: string): Promise<DanmakuCandidate[]>;
  comment(endpoint: string, episodeId: number): Promise<string>;
}

export interface DanmakuHealthPort {
  isCooling(key: string): boolean;
  markOk(key: string): void;
  markFail(key: string): void;
}

export interface DanmakuServiceDependencies {
  settings: DanmakuSettingsPort;
  plugins: DanmakuSourceCatalogPort;
  api: DanmakuApiPort;
  health: DanmakuHealthPort;
  mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]>;
  rank(items: DanmakuAnime[], keyword: string, season?: number): DanmakuAnime[];
  endpointLabel(url: string): string;
  now(): number;
  logger: Pick<Logger, 'i' | 'w'>;
  cacheLimit?: number;
}

const DANMAKU_CACHE_LIMIT = 200;
const SEARCH_CONCURRENCY = 10;
const RESULTS_PER_SOURCE_LIMIT = 15;
const SEARCH_RESULTS_LIMIT = 60;

export function isPluginDanmakuKey(source: string): boolean {
  return source.startsWith('plugin:');
}

/** Coordinates danmaku search, source health, episode lookup, and successful response caching. */
export class DanmakuService {
  private readonly cache = new Map<string, string>();
  private readonly cacheLimit: number;

  constructor(private readonly dependencies: DanmakuServiceDependencies) {
    this.cacheLimit = Math.max(1, dependencies.cacheLimit ?? DANMAKU_CACHE_LIMIT);
  }

  getSettings(): DanmakuSettings {
    return this.dependencies.settings.settings;
  }

  updateSettings(patch: Partial<DanmakuSettings>): DanmakuSettings {
    return this.dependencies.settings.update(patch || {});
  }

  async search(keyword: string, season?: number): Promise<DanmakuAnime[]> {
    const term = (keyword || '').trim();
    if (!term) return [];

    const startedAt = this.dependencies.now();
    const endpoints = this.activeEndpoints();
    const availableEndpoints = endpoints.filter((endpoint) => !this.dependencies.health.isCooling(endpoint.url));
    const plugins = await this.pluginSources();
    const jobs: Array<() => Promise<DanmakuAnime[]>> = [
      ...availableEndpoints.map((endpoint) => async () => {
        try {
          const items = await this.dependencies.api.searchAnime(endpoint.url, term, endpoint.name);
          this.dependencies.health.markOk(endpoint.url);
          return items;
        } catch (error) {
          this.dependencies.health.markFail(endpoint.url);
          this.dependencies.logger.w(`danmaku:接口失败「${endpoint.name}」${errorMessage(error)}`);
          return [];
        }
      }),
      ...plugins.map((plugin) => async () => {
        try {
          const items = await plugin.search(term, season);
          this.dependencies.health.markOk(plugin.key);
          return items;
        } catch (error) {
          this.dependencies.health.markFail(plugin.key);
          this.dependencies.logger.w(`danmaku:插件源失败「${plugin.name}」${errorMessage(error)}`);
          return [];
        }
      }),
    ];

    const batches = await this.dependencies.mapConcurrent(jobs, SEARCH_CONCURRENCY, (job) => job());
    const ranked = this.dependencies.rank(batches.flat(), term, season);
    const countBySource = new Map<string, number>();
    const balanced = ranked.filter((item) => {
      const key = item.source || '';
      const count = countBySource.get(key) || 0;
      if (count >= RESULTS_PER_SOURCE_LIMIT) return false;
      countBySource.set(key, count + 1);
      return true;
    });

    this.dependencies.logger.i(
      `弹幕搜索「${term}」：外部${availableEndpoints.length}源+插件${plugins.length}源（跳过冷却${endpoints.length - availableEndpoints.length}）；命中${Math.min(balanced.length, SEARCH_RESULTS_LIMIT)}部/来自${countBySource.size}个来源；${this.dependencies.now() - startedAt}ms`,
    );
    return balanced.slice(0, SEARCH_RESULTS_LIMIT);
  }

  async episodes(bangumiId: number, animeTitle: string | undefined, source: string): Promise<DanmakuCandidate[]> {
    if (!bangumiId || !source) return [];
    if (isPluginDanmakuKey(source)) {
      const plugin = (await this.pluginSources()).find((item) => item.key === source);
      if (!plugin) return [];
      try {
        const items = await plugin.episodes(Number(bangumiId), animeTitle);
        this.dependencies.health.markOk(source);
        return items;
      } catch (error) {
        this.dependencies.health.markFail(source);
        this.dependencies.logger.w(`danmaku:插件剧集失败「${plugin.name}」${errorMessage(error)}`);
        return [];
      }
    }

    const name = this.endpointName(source);
    try {
      const items = await this.dependencies.api.episodes(source, Number(bangumiId), name, animeTitle);
      this.dependencies.health.markOk(source);
      return items;
    } catch (error) {
      this.dependencies.health.markFail(source);
      this.dependencies.logger.w(`danmaku:剧集失败「${name}」${errorMessage(error)}`);
      return [];
    }
  }

  async fetch(episodeId: number, source: string): Promise<string> {
    if (!episodeId || !source) return '';
    const key = `${source}|${episodeId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    let xml: string;
    try {
      if (isPluginDanmakuKey(source)) {
        const plugin = (await this.pluginSources()).find((item) => item.key === source);
        if (!plugin) return '';
        xml = await plugin.comment(episodeId);
      } else {
        xml = await this.dependencies.api.comment(source, episodeId);
      }
      this.dependencies.health.markOk(source);
    } catch (error) {
      this.dependencies.health.markFail(source);
      const name = isPluginDanmakuKey(source) ? source : this.endpointName(source);
      this.dependencies.logger.w(`danmaku:弹幕失败「${name}」${errorMessage(error)}`);
      return '';
    }

    if (xml) {
      if (this.cache.size >= this.cacheLimit) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, xml);
    }
    return xml;
  }

  private activeEndpoints(): DanmakuApiEndpoint[] {
    return (this.dependencies.settings.settings.endpoints || [])
      .filter((endpoint) => endpoint && endpoint.enabled !== false && endpoint.url);
  }

  private endpointName(url: string): string {
    const endpoint = (this.dependencies.settings.settings.endpoints || []).find((item) => item.url === url);
    return (endpoint?.name || '').trim() || this.dependencies.endpointLabel(url) || '外部接口';
  }

  private async pluginSources(): Promise<DanmakuSourcePort[]> {
    try {
      return [...await this.dependencies.plugins.list()];
    } catch (error) {
      this.dependencies.logger.w(`插件弹幕源加载失败（已忽略）：${errorMessage(error)}`);
      return [];
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
