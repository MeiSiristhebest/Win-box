import type { Logger, MetaExtra, MetaHit, MetaImages, DiscoverGenre, DiscoverGenrePage, DiscoverSection, MovieHotList } from '../../shared/types';
import type { ExplorePage, ExploreQuery, ExploreVocabulary } from '../../shared/discover';
import type { DiscoverBoardPage } from '../../shared/discoverBoards';
import type { MetaSettings, MetaSettingsView, MetaSuggestion } from '../../shared/meta';
import { normalizeMetaSettings as normalizeSettings } from '../../shared/meta';
import { discoverBoardById as findDiscoverBoard, normalizeBoardPage as normalizePage } from '../../shared/discoverBoards';

export interface MetadataSettingsPort {
  read(): MetaSettings;
  write(settings: MetaSettings): void;
}

export interface MetadataCachePort {
  get(key: string): { hit: MetaHit | null } | undefined;
  set(key: string, hit: MetaHit | null, verifiedAt: number): void;
}

export interface MetadataLookupSourcePort {
  readonly id: string;
  search(query: { title: string; year?: string }): Promise<MetaHit | null>;
}

export interface DiscoverySourcePort {
  readonly id: string;
  sections(): Promise<DiscoverSection[]>;
}

export interface MetadataServiceDependencies {
  settings: MetadataSettingsPort;
  cache: MetadataCachePort;
  tmdb: {
    configure(settings: MetaSettings): void;
    hasKey(): boolean;
    images(mediaType: 'movie' | 'tv', tmdbId: number): Promise<MetaImages>;
    suggest(query: string): Promise<MetaSuggestion[]>;
    searchTitle(name: string, year?: string): Promise<MetaHit | null>;
    extras(name: string, year?: string): Promise<MetaExtra | null>;
    discover(refresh: boolean): Promise<DiscoverSection[]>;
    boardPage(id: string, page: number, refresh: boolean): Promise<DiscoverBoardPage>;
    genres(): Promise<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>;
    genrePage(mediaType: 'movie' | 'tv', genreId: number, page: number): Promise<DiscoverGenrePage>;
  };
  douban: {
    suggest(query: string): Promise<MetaSuggestion[]>;
    titleVariants(name: string): string[];
    cacheKey(name: string, year: string): string;
    searchTitle(name: string, year?: string): Promise<MetaHit | null>;
    stills(doubanId: string): Promise<string[]>;
    explorePage(query: ExploreQuery): Promise<ExplorePage>;
    exploreVocabulary(): Promise<ExploreVocabulary>;
  };
  domestic: {
    discover(refresh: boolean): Promise<DiscoverSection[]>;
    boardPage(id: string, page: number, refresh: boolean): Promise<DiscoverBoardPage>;
    genres(): { movie: DiscoverGenre[]; tv: DiscoverGenre[] };
    genrePage(mediaType: 'movie' | 'tv', genreId: number, page: number): Promise<DiscoverGenrePage>;
    hot(): Promise<MovieHotList>;
  };
  artwork: {
    images(name: string, mediaType: 'movie' | 'tv', year?: string, kind?: 'backdrop' | 'poster'): Promise<MetaImages>;
  };
  plugins: {
    metadataProviders(): Promise<readonly MetadataLookupSourcePort[]>;
    discoverySources(): Promise<readonly DiscoverySourcePort[]>;
  };
  logger: Pick<Logger, 'e' | 'i' | 'w'>;
  now(): number;
}

const MAX_DOUBAN_TITLE_VARIANTS = 2;

/** Metadata/discovery use cases. Storage, provider I/O, and plugin loading enter through ports. */
export class MetadataService {
  constructor(private readonly dependencies: MetadataServiceDependencies) {
    this.dependencies.tmdb.configure(this.dependencies.settings.read());
  }

  settingsSnapshot(): MetaSettings {
    return this.dependencies.settings.read();
  }

  restoreSettings(settings: MetaSettings): void {
    this.dependencies.settings.write(settings);
    this.configureTmdb();
  }

  getSettings(): MetaSettingsView {
    const settings = this.dependencies.settings.read();
    return { ...settings, hasBuiltin: false, hasUserKey: !!settings.tmdbApiKey.trim() };
  }

  setSettings(patch: Partial<MetaSettings>): MetaSettingsView {
    const current = this.dependencies.settings.read();
    const next = normalizeSettings({ ...current, ...patch });
    this.dependencies.settings.write(next);
    this.dependencies.tmdb.configure(next);
    this.dependencies.logger.i(
      `meta: 来源策略=${next.metaSource}；用户 Key=${next.tmdbApiKey ? '已配置' : '未配置'}；代理=${next.tmdbApiBase || '默认'}；图床=${next.tmdbImageBase || '默认'}`,
    );
    return this.getSettings();
  }

  async images(mediaType: 'movie' | 'tv', tmdbId: number): Promise<MetaImages> {
    try {
      return await this.dependencies.tmdb.images(mediaType, tmdbId);
    } catch (error) {
      this.dependencies.logger.w(`meta:剧照查询失败: ${errorMessage(error)}`);
      return { backdrops: [], posters: [] };
    }
  }

  async suggest(query: string): Promise<MetaSuggestion[]> {
    const term = (query || '').trim();
    if (!term) return [];
    try {
      const list = this.dependencies.tmdb.hasKey() ? await this.dependencies.tmdb.suggest(term) : [];
      if (list.length) return list;
      return await this.dependencies.douban.suggest(term);
    } catch {
      return [];
    }
  }

  async search(name: string, year?: string, provider?: 'tmdb' | 'douban'): Promise<MetaHit | null> {
    const title = (name || '').trim();
    if (!title) return null;
    try {
      if (provider !== 'douban' && this.dependencies.tmdb.hasKey()) {
        try {
          const hit = await this.dependencies.tmdb.searchTitle(title, year || undefined);
          if (hit) return hit;
        } catch { /* TMDB 不可用时继续查豆瓣。 */ }
      }
      if (provider === 'tmdb') return null;
      const doubanHit = await this.searchDouban(title, year);
      if (doubanHit) return doubanHit;
      if (provider) return null;
      return await this.searchPluginMetadata(title, year);
    } catch (error) {
      this.dependencies.logger.e('meta:搜索失败', error);
      return null;
    }
  }

  async extras(name: string, year?: string): Promise<MetaExtra | null> {
    const title = (name || '').trim();
    if (!title || !this.dependencies.tmdb.hasKey()) return null;
    try {
      return await this.dependencies.tmdb.extras(title, year || undefined);
    } catch (error) {
      this.dependencies.logger.w(`meta:详情增强查询失败: ${errorMessage(error)}`);
      return null;
    }
  }

  async discover(refresh = false): Promise<DiscoverSection[]> {
    let base: DiscoverSection[] = [];
    try {
      base = this.dependencies.tmdb.hasKey()
        ? await this.dependencies.tmdb.discover(!!refresh)
        : await this.dependencies.domestic.discover(!!refresh);
    } catch (error) {
      this.dependencies.logger.w(`meta:发现页查询失败: ${errorMessage(error)}`);
    }
    const extra = await this.pluginDiscoverySections();
    const seen = new Set(base.map((section) => section.id));
    return [...base, ...extra.filter((section) => !seen.has(section.id)).map((section) => ({ ...section, browseId: `plugin:${section.id}` }))];
  }

  async boardPage(id: string, page: number, refresh = false): Promise<DiscoverBoardPage> {
    const pluginId = id.startsWith('plugin:') ? id.slice(7) : id;
    const board = id.startsWith('plugin:') ? undefined : findDiscoverBoard(id);
    if (board?.provider === 'douban') return this.dependencies.domestic.boardPage(id, page, refresh);
    if (board?.provider === 'tmdb') return this.dependencies.tmdb.boardPage(id, page, refresh);
    if (!id || id.length > 200) throw new Error('无效的榜单');
    const section = (await this.pluginDiscoverySections()).find((item) => item.id === pluginId);
    if (!section) throw new Error('这个榜单已不可用，请返回榜单列表重新选择');
    if (normalizePage(page) !== 1) throw new Error('这个插件仅提供一页内容');
    return {
      board: { id, title: section.title, provider: 'plugin', description: '插件提供的内容列表。', mediaType: section.mediaType },
      items: section.items,
      page: 1,
      pageSize: section.items.length,
      total: section.items.length,
      totalPages: 1,
      hasMore: false,
      fetchedAt: 0,
      stale: false,
      notice: '这里只能显示插件提供的条目，插件未提供继续分页或原站入口。',
    };
  }

  async genres(): Promise<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }> {
    try {
      return this.dependencies.tmdb.hasKey() ? await this.dependencies.tmdb.genres() : this.dependencies.domestic.genres();
    } catch (error) {
      this.dependencies.logger.w(`meta:类型清单查询失败: ${errorMessage(error)}`);
      return { movie: [], tv: [] };
    }
  }

  discoverQuery(query: ExploreQuery): Promise<ExplorePage> {
    const mediaType = query?.mediaType === 'tv' ? 'tv' : 'movie';
    return this.dependencies.douban.explorePage({ ...query, mediaType });
  }

  exploreVocabulary(): Promise<ExploreVocabulary> {
    return this.dependencies.douban.exploreVocabulary();
  }

  async genrePage(mediaType: string, genreId: number, page: number): Promise<DiscoverGenrePage> {
    const type = String(mediaType) === 'tv' ? 'tv' : 'movie';
    try {
      return this.dependencies.tmdb.hasKey()
        ? await this.dependencies.tmdb.genrePage(type, Number(genreId) || 0, Number(page) || 1)
        : await this.dependencies.domestic.genrePage(type, Number(genreId) || 0, Number(page) || 1);
    } catch (error) {
      this.dependencies.logger.w(`meta:分类查询失败: ${errorMessage(error)}`);
      return { items: [], page: 1, totalPages: 1 };
    }
  }

  movieHot(): Promise<MovieHotList> {
    return this.dependencies.domestic.hot();
  }

  async discoverImages(
    name: string,
    mediaType: 'movie' | 'tv',
    year?: string,
    kind: 'backdrop' | 'poster' = 'backdrop',
    doubanId?: string,
  ): Promise<MetaImages> {
    if (kind === 'poster') {
      const hit = await this.search(name, year);
      return { backdrops: [], posters: hit?.poster ? [hit.poster] : [] };
    }
    if (doubanId) {
      try {
        const stills = await this.dependencies.douban.stills(doubanId);
        if (stills.length) return { backdrops: stills, posters: [] };
      } catch { /* 再试 TMDB 或背景图缓存。 */ }
    }
    if (this.dependencies.tmdb.hasKey()) {
      try {
        const hit = await this.dependencies.tmdb.searchTitle(name, year);
        if (hit?.tmdbId) {
          const images = await this.dependencies.tmdb.images(hit.type, hit.tmdbId);
          if (images.backdrops.length) return images;
        }
      } catch { /* 横版图片搜索仍可独立提供候选。 */ }
    }
    return this.dependencies.artwork.images(name, mediaType, year, kind);
  }

  private configureTmdb(): void {
    this.dependencies.tmdb.configure(this.dependencies.settings.read());
  }

  private async searchDouban(name: string, year?: string): Promise<MetaHit | null> {
    for (const variant of this.dependencies.douban.titleVariants(name).slice(0, MAX_DOUBAN_TITLE_VARIANTS)) {
      const key = this.dependencies.douban.cacheKey(variant, year || '');
      const cached = this.dependencies.cache.get(key);
      if (cached) {
        if (cached.hit) return cached.hit;
        continue;
      }
      const hit = await this.dependencies.douban.searchTitle(variant, year);
      this.dependencies.cache.set(key, hit, this.dependencies.now());
      if (hit) return hit;
    }
    return null;
  }

  private async searchPluginMetadata(name: string, year?: string): Promise<MetaHit | null> {
    let sources: readonly MetadataLookupSourcePort[];
    try {
      sources = await this.dependencies.plugins.metadataProviders();
    } catch (error) {
      this.dependencies.logger.w(`插件元数据源加载失败（已忽略）：${errorMessage(error)}`);
      return null;
    }
    for (const source of sources) {
      try {
        const hit = await source.search({ title: name, year: year || undefined });
        if (hit) {
          this.dependencies.logger.i(`meta: 插件元数据源命中（${source.id}）`);
          return hit;
        }
      } catch (error) {
        this.dependencies.logger.w(`插件元数据源 ${source.id} 查询失败（已跳过）：${errorMessage(error)}`);
      }
    }
    return null;
  }

  private async pluginDiscoverySections(): Promise<DiscoverSection[]> {
    let sources: readonly DiscoverySourcePort[];
    try {
      sources = await this.dependencies.plugins.discoverySources();
    } catch (error) {
      this.dependencies.logger.w(`插件发现页数据源加载失败（已忽略）：${errorMessage(error)}`);
      return [];
    }
    const sections: DiscoverSection[] = [];
    for (const source of sources) {
      try {
        for (const section of await source.sections()) {
          if (!sections.some((item) => item.id === section.id)) sections.push(section);
        }
      } catch (error) {
        this.dependencies.logger.w(`插件发现页数据源 ${source.id} 查询失败（已跳过）：${errorMessage(error)}`);
      }
    }
    return sections;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
