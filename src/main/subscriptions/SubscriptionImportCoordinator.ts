import { parseSiteConfig, parseSiteConfigWithBase, type ParseResult } from '../../engine/config/ApiConfigParser';
import { isFetchedRepoUrl, repoDisplayName, splitRepoLine, type MultiRepo } from '../../engine/config/multiRepo';
import type { ImportReport, Logger, SiteConfig } from '../../shared/types';
import { reconcileSubscriptionProfileRefresh } from '../store/subscriptionProfileMerge';
import { serializeImport } from '../store/userProfileSnapshot';
import { SUBSCRIPTION_IMPORT_POLICY } from './ImportPolicy';
import { executeSubscriptionImportBatch } from './SubscriptionImportExecutor';
import { runSubscriptionImportGroup, type SubscriptionGroupProfilePort } from './SubscriptionImportGroupService';
import { importSingleRepository } from './SingleRepositoryImporter';
import { createSubscriptionImportRunner } from './SubscriptionImportRunner';
import type { SubscriptionImportProgressPatch, SubscriptionImportRunner } from './SubscriptionImportJobContracts';
import { importSubscriptionConfig, type SubscriptionConfigImportSource } from './SubscriptionConfigImport';

export interface MultiRepositoryImportOptions {
  snapshot: boolean;
  name?: string;
  preferredLine?: number;
  subscriptionUrl?: string;
  signal?: AbortSignal;
  onlyMemberIds?: ReadonlySet<string>;
  onProgress?: (patch: SubscriptionImportProgressPatch) => void;
  expectedConfigRevision?: number;
}

export interface SubscriptionImportCoordinatorPorts {
  profiles: SubscriptionGroupProfilePort;
  fetchConfigWithDiagnostics(url: string, quick: boolean, signal?: AbortSignal): Promise<{ text: string; hint: string }>;
  currentConfig(): SiteConfig | null;
  setCurrentConfig(config: SiteConfig): void;
  applyRuntimeConfig(config: SiteConfig): void;
  recordImportedConfig(config: SiteConfig, sourceUrl: string, snapshot: boolean, name: string): void;
  logger: Pick<Logger, 'i'>;
}

/** Coordinates subscription use cases while keeping networking and host state behind ports. */
export class SubscriptionImportCoordinator {
  private latestReportValue: ImportReport | null = null;

  constructor(private readonly ports: SubscriptionImportCoordinatorPorts) {}

  get latestReport(): ImportReport | null {
    return this.latestReportValue;
  }

  importConfig(
    source: SubscriptionConfigImportSource,
    options: { snapshot: boolean; signal?: AbortSignal },
  ): Promise<ParseResult> {
    return importSubscriptionConfig(source, options, {
      currentConfigRevision: () => this.ports.profiles.revision,
      fetchConfigWithDiagnostics: (url, signal) => this.ports.fetchConfigWithDiagnostics(url, false, signal),
      importMultiRepo: (multi, importOptions) => this.importMultiRepository(multi, importOptions),
      commitParsedConfig: (result, url, snapshot, name) => {
        this.ports.recordImportedConfig(result.config, url, snapshot, name);
        this.latestReportValue = result.report;
        this.ports.setCurrentConfig(result.config);
        this.ports.applyRuntimeConfig(result.config);
      },
    });
  }

  createRunner(sourceUrl: string, name: string): SubscriptionImportRunner {
    return createSubscriptionImportRunner(sourceUrl, name, {
      currentConfigRevision: () => this.ports.profiles.revision,
      groupMembers: (url) => this.ports.profiles.snapshot().subscriptionGroups.find((group) => group.url === url)?.members ?? [],
      fetchConfigText: async (url, signal) => (await this.ports.fetchConfigWithDiagnostics(url, false, signal)).text,
      importMultiRepo: (multi, options) => this.importMultiRepository(multi, {
        snapshot: true,
        name: options.name,
        preferredLine: options.preferredLine,
        subscriptionUrl: options.subscriptionUrl,
        signal: options.signal,
        onlyMemberIds: options.onlyMemberIds,
        onProgress: options.onProgress,
        expectedConfigRevision: options.expectedConfigRevision,
      }),
      commitImportedConfig: (result, sourceUrl, importName) => this.commit(result, sourceUrl, true, importName),
    });
  }

  async importMultiRepository(multi: MultiRepo, options: MultiRepositoryImportOptions): Promise<ParseResult> {
    const name = options.name || '';
    const preferredLine = options.preferredLine ?? -1;
    const subscriptionUrl = options.subscriptionUrl || '';
    const total = multi.items.length;
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('导入已取消');
    if (options.expectedConfigRevision !== undefined && this.ports.profiles.revision !== options.expectedConfigRevision) {
      throw new Error('配置已在导入期间更改；多仓下载尚未开始，请重新导入');
    }

    if (preferredLine >= 0) {
      return importSingleRepository({
        multi,
        snapshot: options.snapshot,
        name,
        preferredLine,
        signal: options.signal,
        expectedConfigRevision: options.expectedConfigRevision,
        onProgress: options.onProgress,
      }, {
        currentRevision: () => this.ports.profiles.revision,
        fetchConfigWithDiagnostics: (url, signal) => this.ports.fetchConfigWithDiagnostics(url, false, signal),
        parse: parseSiteConfigWithBase,
        setReport: (report) => { this.latestReportValue = report; },
        setCurrentConfig: (config) => this.ports.setCurrentConfig(config),
        applyConfig: (config) => this.ports.applyRuntimeConfig(config),
        recordImportedConfig: (config, url, snapshot, importName) =>
          this.ports.recordImportedConfig(config, url, snapshot, importName),
        logger: this.ports.logger,
      });
    }

    const dependencies = {
      labelFor: (item: MultiRepo['items'][number]) => repoDisplayName(item.url, item.name),
      splitRepoLine,
      serializeImport,
      reconcileProfileRefresh: reconcileSubscriptionProfileRefresh,
    };
    const assembled = await runSubscriptionImportGroup({
      manager: this.ports.profiles,
      executeBatch: executeSubscriptionImportBatch,
      restoreDeletedSources: options.snapshot,
      items: multi.items,
      name,
      subscriptionUrl,
      onlyMemberIds: options.onlyMemberIds,
      expectedRevision: options.expectedConfigRevision,
      signal: options.signal,
      policy: SUBSCRIPTION_IMPORT_POLICY,
      dependencies,
      unavailableReason: (item) => !isFetchedRepoUrl(item.url)
        ? /^clan:/i.test(item.url) ? '本地目录仓（clan://）桌面版不可用' : '不支持的协议'
        : null,
      load: async (item, signal) => {
        const child = splitRepoLine(item.url);
        const fetched = await this.ports.fetchConfigWithDiagnostics(child.url, true, signal);
        try {
          const result = parseSiteConfigWithBase(fetched.text, child.url);
          if (!result.config.sites.length && !result.config.lives.length) throw new Error('内容为空/非订阅配置');
          return result;
        } catch (error) {
          if (fetched.hint) throw new Error(fetched.hint);
          throw new Error(`已取得配置正文，但解析失败：${error instanceof Error ? error.message : String(error)}；这不等同于其中所有影片源不可用`);
        }
      },
      onProgress: (progress) => options.onProgress?.({ state: 'running', ...progress }),
      onRevisionConflict: (message) => options.onProgress?.({ total: 0, completed: 0, succeeded: 0, failed: 0, pending: 0, message }),
    });

    const { group, imported, skipped, truncated, unselected, successCount, failedCount, pendingCount } = assembled;
    if (!imported.length) {
      const details = skipped.slice(0, 8).join('；') || '没有可用的 HTTP(S) 子仓';
      const more = skipped.length > 8 ? `；另有 ${skipped.length - 8} 项未列出` : '';
      const message = `本次没有新增可用配置：${details}${more}${truncated || unselected ? `；另有 ${truncated + unselected} 项尚未尝试，可继续处理` : ''}`;
      if (options.onProgress) {
        options.onProgress({ message });
        const fallback = parseSiteConfig('{}');
        return { ...fallback, config: this.ports.currentConfig() || fallback.config, warnings: [message] };
      }
      throw new Error(message);
    }

    const primary = imported[0].result;
    const lineHint = subscriptionUrl ? '需要单独指定线路时，可在订阅地址尾加 #line=N（N 从 0 起）' : '';
    const note = `多仓组「${group.name}」共 ${total} 个子仓：成功 ${successCount}、失败 ${failedCount}、待处理 ${pendingCount}。每个成功子仓已保存为独立档案；此处仅检查配置能否获取和解析，不代表各影片源的播放可用性${skipped.length ? `；问题：${skipped.slice(0, 6).join('；')}${skipped.length > 6 ? `；另有 ${skipped.length - 6} 项未列出` : ''}` : ''}${lineHint ? `。${lineHint}` : ''}`;
    options.onProgress?.({ message: note });
    this.latestReportValue = primary.report;
    const warnings = [...new Set(imported.flatMap((item) => item.result.warnings || []))];
    this.ports.logger.i('multi-repo: ' + note);
    return { ...primary, config: this.ports.currentConfig() || primary.config, warnings: [...warnings, note] };
  }

  private commit(result: ParseResult, sourceUrl: string, snapshot: boolean, name: string): void {
    // Persist the profile transition before mutating the runtime. If disk persistence fails,
    // the active engine keeps using the last committed configuration.
    this.ports.recordImportedConfig(result.config, sourceUrl, snapshot, name);
    this.latestReportValue = result.report;
    this.ports.setCurrentConfig(result.config);
    this.ports.applyRuntimeConfig(result.config);
  }
}
