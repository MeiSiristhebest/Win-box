import type { Logger, SearchAllProgressEvent, SearchAllReport, SourceBean, UserProfile, VodItem, SiteConfig } from '../../shared/types';
import { mergeSearchResults, type AggSearchInput } from '../../engine/vod/aggSearch';
import { throwIfSearchAborted } from '../../engine/vod/searchRuntime';
import {
  searchAcrossProfiles,
  type ProfileWorkerBudget,
  type ProfileWorkerBudgetFactory,
} from '../../engine/vod/searchAcrossProfiles';
import {
  SEARCH_ALL_BUDGET_MS,
  SEARCH_ALL_JS_MAX_MS,
  SEARCH_ALL_PROFILE_WORKERS,
  SEARCH_ALL_QUICK_MS,
  SEARCH_ALL_SOURCE_MAX_MS,
  SEARCH_ALL_WORKERS,
  SEARCH_ALL_WORKERS_MAX,
  UNSUPPORTED_SEARCH_CODES,
} from '../../engine/vod/aggregateSearchPolicy';
import { SearchCache } from '../../engine/vod/searchCache';
import { AggregateSearchRequestBroker } from './AggregateSearchRequestBroker';

export interface ProfileExecutionContext {
  profileId: string;
  config: SiteConfig | null;
}

export interface SearchReadinessPort {
  prepare(options: {
    sources: readonly SourceBean[];
    unsupportedScopes: ReadonlySet<string>;
    term: string;
    profileId: string;
    profileName?: string;
    signal?: AbortSignal;
    onProgress?: (event: SearchAllProgressEvent) => void;
  }): Promise<{ active: number[]; skipped: Array<AggSearchInput | null> }>;
}

export interface SearchTimingPort {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>;
}

export interface AggregateSearchOptions {
  refresh?: boolean;
  profileId?: string;
  profileIds?: string[];
}

/** Narrow consumer contract for the aggregate-search use case. */
export interface AggregateSearchRunnerPort {
  run(
    keyword: string,
    options?: AggregateSearchOptions,
    onProgress?: (event: SearchAllProgressEvent) => void,
  ): Promise<SearchAllReport>;
}

export interface AggregateSearchDependencies {
  profiles: {
    list(): readonly Pick<UserProfile, 'id' | 'name'>[];
    executionContext(profileId?: string): ProfileExecutionContext;
    revision(): number;
    activeProfileId(): string;
    activeSourceKey(): string;
  };
  sources: {
    searchable(profileId?: string, config?: SiteConfig | null): SourceBean[];
    search(source: SourceBean, term: string, timeoutMs: number, signal?: AbortSignal): Promise<VodItem[]>;
  };
  readiness: SearchReadinessPort;
  createWorkerBudget: ProfileWorkerBudgetFactory;
  health: {
    scheduleOrder(sources: readonly SourceBean[]): number[];
    sourceBudget(source: SourceBean, maximumMs: number): number;
    succeeded(scope: string, elapsedMs: number, empty: boolean): void;
    failed(scope: string): void;
  };
  timing: SearchTimingPort;
  logger: Pick<Logger, 'i' | 'w'>;
}

type SearchStateVersion = { configuration: number; credentials: number };

export class AggregateSearchCoordinator implements AggregateSearchRunnerPort {
  private readonly requestBroker = new AggregateSearchRequestBroker();
  private readonly unsupportedScopes = new Set<string>();
  private readonly cache = new SearchCache<SearchAllReport>();
  private credentialRevision = 0;
  private configurationRevision = 0;

  constructor(private readonly dependencies: AggregateSearchDependencies) {}

  run(
    wd: string,
    opts?: AggregateSearchOptions,
    onProgress?: (event: SearchAllProgressEvent) => void,
  ): Promise<SearchAllReport> {
    const term = (wd || '').trim();
    if (!term) throw new Error('请输入搜索关键词');
    const version = this.currentStateVersion();
    const key = JSON.stringify([
      this.dependencies.profiles.revision(),
      version.configuration,
      version.credentials,
      term,
      opts?.profileIds ?? opts?.profileId ?? this.dependencies.profiles.activeProfileId(),
      !!opts?.refresh,
    ]);
    return this.requestBroker.run(
      key,
      (publish) => this.execute(term, opts, publish, version),
      onProgress,
    );
  }

  /** Source configuration changes invalidate cached reports and capability skips. */
  invalidateConfiguration(): void {
    this.configurationRevision++;
    this.cache.clear();
    this.unsupportedScopes.clear();
    this.requestBroker.clear();
  }

  /** Credential changes must not reuse reports or join searches using old credentials. */
  invalidateCredentials(): void {
    this.credentialRevision++;
    this.cache.clear();
    this.requestBroker.clear();
  }

  private async execute(
    term: string,
    opts: { refresh?: boolean; profileId?: string; profileIds?: string[] } | undefined,
    onProgress?: (event: SearchAllProgressEvent) => void,
    version: SearchStateVersion = this.currentStateVersion(),
  ): Promise<SearchAllReport> {
    const progress = onProgress;
    if (!opts?.profileIds) return this.searchSingleProfile(term, opts, progress, undefined, undefined, SEARCH_ALL_WORKERS_MAX, undefined, undefined, version);

    const profileIds = [...new Set(opts.profileIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (profileIds.length === 0) throw new Error('请选择至少一个订阅档案');
    const knownProfiles = new Map(this.dependencies.profiles.list().map((profile) => [profile.id, profile]));
    const contexts = profileIds.map((profileId, profileOrder) => {
      const profile = knownProfiles.get(profileId);
      if (!profile) throw new Error(`订阅档案不存在：${profileId}`);
      const context = this.dependencies.profiles.executionContext(profileId);
      return {
        profileId,
        profileOrder,
        profileName: profile.name || profileId,
        context,
        total: this.dependencies.sources.searchable(profileId, context.config).length,
      };
    });
    return searchAcrossProfiles({
      term,
      profiles: contexts,
      profileWorkerLimit: SEARCH_ALL_PROFILE_WORKERS,
      sourceWorkerLimit: SEARCH_ALL_WORKERS_MAX,
      createWorkerBudget: this.dependencies.createWorkerBudget,
      onProgress: progress,
      searchProfile: (entry, profileProgress, workerBudget, signal) => this.searchSingleProfile(
        term,
        { refresh: opts.refresh, profileId: entry.profileId },
        profileProgress,
        entry.context,
        entry.profileName,
        SEARCH_ALL_WORKERS_MAX,
        workerBudget,
        signal,
        version,
      ),
    });
  }

  private async searchSingleProfile(
    wd: string,
    opts?: { refresh?: boolean; profileId?: string },
    progress?: (event: SearchAllProgressEvent) => void,
    capturedContext?: { profileId: string; config: SiteConfig | null },
    profileNameOverride?: string,
    workerLimit = SEARCH_ALL_WORKERS_MAX,
    workerBudget?: ProfileWorkerBudget,
    signal?: AbortSignal,
    version: SearchStateVersion = this.currentStateVersion(),
  ): Promise<SearchAllReport> {
    throwIfSearchAborted(signal);
    const term = (wd || '').trim();
    if (!term) throw new Error('请输入搜索关键词');
    const context = capturedContext ?? this.dependencies.profiles.executionContext(opts?.profileId);
    const profileId = context.profileId;
    const profileName = profileNameOverride ?? this.dependencies.profiles.list().find((profile) => profile.id === profileId)?.name;
    const cacheKey = JSON.stringify([profileId, version.configuration, term, version.credentials]);
    // ★ 秒回：同一关键词 TTL 内再搜 → 直接给上次报告（带 cachedAt，UI 提示「本地缓存 · 点「重新搜索」刷新」）
    if (!opts?.refresh) {
      const hit = this.cache.getEntryByKey(cacheKey, this.dependencies.timing.now());
      if (hit) {
        this.dependencies.logger.i(`全源搜索命中本地缓存「${term}」（${Math.round((this.dependencies.timing.now() - hit.at) / 1000)}s 前）→ 秒回`);
        return { ...hit.value, cachedAt: hit.at };
      }
    } else {
      this.cache.deleteByKey(cacheKey);
    }
    const pool = this.dependencies.sources.searchable(profileId, context.config);
    const results: Array<AggSearchInput | null> = Array.from({ length: pool.length }, () => null);
    // Only explicit unsupported formats are skipped for this session. A manual
    // refresh rechecks them; network/runtime/ARM bridge errors remain retryable.
    const unsupportedScopes = new Set(this.unsupportedScopes);
    if (opts?.refresh) {
      for (const source of pool) {
        const scope = source.runtimeScope || source.key;
        unsupportedScopes.delete(scope);
        if (this.isCurrent(version)) this.unsupportedScopes.delete(scope);
      }
    }
    const searchT0 = this.dependencies.timing.now();
    let firstHitAt = 0;
    let pushed = 0;
    const { active, skipped } = await this.dependencies.readiness.prepare({
      sources: pool,
      unsupportedScopes,
      term,
      profileId,
      profileName,
      signal,
      onProgress: progress,
    });
    const total = active.length;
    let done = 0;
    const workerCount = Math.min(workerLimit, Math.max(Math.min(SEARCH_ALL_WORKERS, workerLimit), Math.ceil(total / 5)));
    const deadline = this.dependencies.timing.now() + SEARCH_ALL_BUDGET_MS;
    /**
     * ★ 派发顺序（源索引）：健康源（快者优先）→ 未知源 → 近期失败源（短预算）。
     * ★ 三轮：**当前选中源置顶** —— 用户刚在浏览的那个源最先出结果，
     *   观感就是「一点全源搜索，熟悉的那个源立刻回来了」（单源搜索本来就快）。
     */
    const order = this.dependencies.health.scheduleOrder(pool).filter((i) => !skipped[i]);
    // The active source key belongs only to the active profile. Reusing it while
    // searching another profile can prioritize a different source with the same key.
    const activeKey = profileId === this.dependencies.profiles.activeProfileId()
      ? this.dependencies.profiles.activeSourceKey()
      : '';
    if (activeKey) {
      const ai = order.findIndex((i) => pool[i].key === activeKey);
      if (ai > 0) order.unshift(...order.splice(ai, 1));
    }
    let cursor = 0;
    /** 单源完成 → 记结果 + 推流式进度（渲染层边搜边出） */
    const finish = (i: number, input: AggSearchInput): void => {
      const scopedInput: AggSearchInput = {
        ...input,
        profileId,
        ...(profileName ? { profileName } : {}),
        ...(input.items ? {
          items: input.items.map((item) => ({ ...item, sourceRef: { profileId, key: input.key } })),
        } : {}),
      };
      results[i] = scopedInput;
      done++;
      if (scopedInput.status === 'ok' && !firstHitAt) firstHitAt = this.dependencies.timing.now() - searchT0;
      // ★ 2026-09-24：`pushed` 只在**回调真实存在且推送成功**时自增 —— 此前 `?.()` 之后
      //   无条件 `pushed++`，日志会打出「推送进度 32 条」而 IPC 实际上一条都没发（排障被误导）。
      const cb = progress;
      if (cb && this.isCurrent(version)) {
        try {
          cb({ wd: term, profileId, profileName, sourceOrder: i, source: scopedInput, done, total, pending: Math.max(0, total - done) });
          pushed++;
        } catch { /* 进度推送失败不影响搜索本身 */ }
      }
    };
    // ★ 快速窗口：3s 后推一条「不带 source」的进度 → UI 明确显示「已出 X 个 · 其余 N 个仍在补搜」
    const quickTimer = this.dependencies.timing.setTimeout(() => {
      if (signal?.aborted || !this.isCurrent(version)) return;
      try {
        progress?.({ wd: term, profileId, profileName, done, total, pending: Math.max(0, total - done) });
      } catch { /* 忽略 */ }
    }, SEARCH_ALL_QUICK_MS);
    const run = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const i = order[cursor++];
        if (i === undefined) return;
        const b = pool[i];
        const release = workerBudget && signal ? await workerBudget.acquire(profileId, signal) : undefined;
        if (signal?.aborted || (workerBudget && !release)) {
          release?.();
          return;
        }
        const t0 = this.dependencies.timing.now();
        const budget = deadline - t0;
        if (budget <= 500) {
          try {
            finish(i, {
              key: b.key,
              name: b.name || b.key,
              status: 'error',
              error: `总体搜索已超时（>${Math.round(SEARCH_ALL_BUDGET_MS / 1000)}s），该源未执行`,
              ms: 0,
            });
          } finally {
            release?.();
          }
          continue; // 未真正执行 → 不写健康表（不是这个源的错）
        }
        const maxMs = /\.js(\?|$)/i.test(b.api || '') ? SEARCH_ALL_JS_MAX_MS : SEARCH_ALL_SOURCE_MAX_MS;
        const sourceScope = b.runtimeScope || b.key;
        const toMs = Math.min(this.dependencies.health.sourceBudget(b, maxMs), budget);
        let searchStarted = false;
        try {
          const searchRequest = Promise.resolve().then(() => this.dependencies.sources.search(b, term, toMs, signal));
          searchStarted = true;
          const heldSearchRequest = searchRequest.then(
            (items) => { release?.(); return items; },
            (error) => { release?.(); throw error; },
          );
          const items = await this.dependencies.timing.withTimeout(heldSearchRequest, toMs + 500, `单源搜索超时（>${Math.round(toMs / 1000)}s）`);
          const ms = this.dependencies.timing.now() - t0;
          this.dependencies.health.succeeded(sourceScope, ms, items.length === 0); // 空结果也记（连续空 → 下轮压预算）
          finish(i, {
            key: b.key,
            name: b.name || b.key,
            status: items.length > 0 ? 'ok' : 'empty',
            items,
            ms,
          });
        } catch (e) {
          if (signal?.aborted) return;
          const ms = this.dependencies.timing.now() - t0;
          const msg = (e as Error).message || String(e);
          // ★「桌面端不支持」类错误 → 记入跳过集（下次全源搜索不再为它花时间）
          const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
          if (UNSUPPORTED_SEARCH_CODES.has(code)) {
            const sourceScope = b.runtimeScope || b.key;
            if (this.isCurrent(version) && !this.unsupportedScopes.has(sourceScope)) {
              this.unsupportedScopes.add(sourceScope);
              this.dependencies.logger.w(`全源搜索：源「${b.name || b.key}」在桌面端不支持（${msg.slice(0, 60)}）→ 后续全源搜索将跳过`);
            }
          }
          this.dependencies.health.failed(b.runtimeScope || b.key); // 失败 → 后续搜索降权到队尾 + 短预算
          finish(i, { key: b.key, name: b.name || b.key, status: 'error', error: msg, ms });
        } finally {
          // A timeout only ends this caller's wait. Keep the shared permit until the
          // underlying request settles, or it would no longer cap actual VM calls.
          if (!searchStarted) release?.();
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: workerCount }, () => run()));
    } finally {
      this.dependencies.timing.clearTimeout(quickTimer);
    }
    throwIfSearchAborted(signal);
    const all = pool.map((_, i) => results[i] ?? skipped[i]).filter((r): r is AggSearchInput => r !== null);
    const report = mergeSearchResults(all);
    // ★ 仍有源在「准备运行时」→ 报告里带计数，UI 据此显示横幅并自动重搜（不让用户面对空屏）
    const pendingSources = all.filter((r) => r.status === 'error' && (r.error || '').startsWith('运行时就绪中')).length;
    if (pendingSources > 0) report.pendingSources = pendingSources;
    if (this.isCurrent(version)) {
      this.cache.setByKey(cacheKey, report, this.dependencies.timing.now()); // 不缓存配置/凭据变更前启动的过期结果
    }
    // ★ 诊断摘要（2026-09-24）：一行看清「引擎侧到底卡在哪」——首结果耗时/总耗时/推送条数/跳过数。
    //   下次用户再报「慢」，看这一行即可区分是引擎慢还是界面慢（跳过数 > 0 说明有源还在后台准备运行时）。
    this.dependencies.logger.i(
      `全源搜索「${term}」：可搜 ${pool.length} 源（本次执行 ${total} / 跳过 ${pool.length - total}）；` +
        `首结果 ${firstHitAt || '-'}ms；完成 ${this.dependencies.timing.now() - searchT0}ms；命中 ${report.hitSources} 源 ${report.items.length} 条；` +
        `推送进度 ${pushed} 条`,
    );
    return report;
  }

  private currentStateVersion(): SearchStateVersion {
    return { configuration: this.configurationRevision, credentials: this.credentialRevision };
  }

  private isCurrent(version: SearchStateVersion): boolean {
    return version.configuration === this.configurationRevision && version.credentials === this.credentialRevision;
  }
}
