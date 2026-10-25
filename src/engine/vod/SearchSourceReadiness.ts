// Filters aggregate-search sources by spider runtime readiness before workers start.
import type { Logger, SearchAllProgressEvent, SourceBean } from '../../shared/types';
import type { AggSearchInput } from './aggSearch';
import { throwIfSearchAborted } from './searchRuntime';

export const SEARCH_SOURCE_PREPARE_MS = 12_000;

export interface SourceRuntimeReadinessSnapshot {
  state: 'ready' | 'preparing' | 'unavailable';
  reason?: string;
  waitUntilReady?: () => Promise<unknown> | null;
}

export interface SourceRuntimeReadinessPort {
  inspect(source: SourceBean): SourceRuntimeReadinessSnapshot | null;
}

export interface SearchSourceReadinessOptions {
  sources: readonly SourceBean[];
  unsupportedScopes: ReadonlySet<string>;
  term: string;
  profileId: string;
  profileName?: string;
  signal?: AbortSignal;
  onProgress?: (event: SearchAllProgressEvent) => void;
}

export class SearchSourceReadiness {
  constructor(
    private readonly runtimeReadiness: SourceRuntimeReadinessPort,
    private readonly logger: Pick<Logger, 'i'>,
  ) {}

  async prepare(options: SearchSourceReadinessOptions): Promise<{ active: number[]; skipped: Array<AggSearchInput | null> }> {
    const { sources, unsupportedScopes, term, profileId, profileName, signal, onProgress } = options;
    const skipped: Array<AggSearchInput | null> = Array.from({ length: sources.length }, () => null);
    const notReadyYet = new Set<number>();
    const pendingRuntime: Array<Promise<unknown>> = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (unsupportedScopes.has(source.runtimeScope || source.key) || source.type !== 3) continue;
      try {
        const runtime = this.runtimeReadiness.inspect(source);
        if (!runtime) continue;
        const state = runtime.state;
        if (state === 'ready') continue;
        if (state === 'unavailable') {
          skipped[i] = {
            key: source.key, name: source.name || source.key, status: 'error',
            error: runtime.reason || '运行时不可用：请检查该源的 jar 地址或运行时配置', ms: 0,
          };
          continue;
        }
        notReadyYet.add(i);
        const waiter = runtime.waitUntilReady?.();
        if (waiter) pendingRuntime.push(waiter);
      } catch { /* Readiness probes are advisory; normal source execution owns the final error. */ }
    }

    if (notReadyYet.size > 0) {
      this.logger.i('全源搜索：' + notReadyYet.size + ' 个源的运行时正在准备 → 最多等 ' + Math.round(SEARCH_SOURCE_PREPARE_MS / 1000) + 's');
      try { onProgress?.({ wd: term, profileId, profileName, done: 0, total: sources.length, pending: sources.length }); } catch { /* Progress cannot fail search. */ }
      if (pendingRuntime.length > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
          const aborted = signal ? new Promise<void>((resolve) => {
            onAbort = resolve;
            signal.addEventListener('abort', onAbort, { once: true });
          }) : new Promise<void>(() => undefined);
          await Promise.race([
            Promise.allSettled(pendingRuntime),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, SEARCH_SOURCE_PREPARE_MS); }),
            aborted,
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          if (onAbort && signal) signal.removeEventListener('abort', onAbort);
        }
      }
      throwIfSearchAborted(signal);
    }

    const active: number[] = [];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (unsupportedScopes.has(source.runtimeScope || source.key)) {
        skipped[i] = {
          key: source.key, name: source.name || source.key, status: 'error',
          error: '已跳过：该源在桌面端不支持（本会话已判定，单源搜索仍可单独尝试）', ms: 0,
        };
        continue;
      }
      if (notReadyYet.has(i)) {
        let state = 'ready';
        let reason = '';
        try {
          const runtime = this.runtimeReadiness.inspect(source);
          state = runtime?.state ?? 'ready';
          reason = runtime?.reason || '';
        } catch { state = 'ready'; }
        if (state !== 'ready') {
          skipped[i] = {
            key: source.key, name: source.name || source.key, status: 'error',
            error: state === 'unavailable'
              ? reason || '运行时不可用：请检查该源的 jar 地址或运行时配置'
              : '运行时就绪中：' + (reason || '正在后台下载/转换 jar') + '；本次未参与，完成后可重搜',
            ms: 0,
          };
          continue;
        }
      }
      if (!skipped[i]) active.push(i);
    }
    return { active, skipped };
  }
}
