import type { SearchAllReport } from '../../../../shared/types';
import { SearchResultsAccumulator } from '../../../../engine/vod/aggSearch';
import type { HomeSearchPort } from './homePorts';

export type AggregateSearchScope =
  | { kind: 'profile'; profileId: string }
  | { kind: 'profiles'; profileIds: string[] };

export interface AggregateSearchSessionCommand {
  term: string;
  refresh: boolean;
  scope: AggregateSearchScope;
  isCurrent(): boolean;
}

export interface AggregateSearchSessionClock {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(timer: unknown): void;
}

export interface AggregateSearchSessionPorts {
  api: Pick<HomeSearchPort, 'onSearchAllProgress' | 'searchAll'>;
  clock: AggregateSearchSessionClock;
  publishPartialReport(report: SearchAllReport): void;
  publishProgress(progress: { done: number; total: number; pending: number } | null): void;
}

export type AggregateSearchSessionResult =
  | { kind: 'completed'; report: SearchAllReport }
  | { kind: 'failed'; message: string }
  | { kind: 'stale' };

/** Owns one aggregate-search IPC subscription, progress batch, and response. */
export async function executeAggregateSearchSession(
  command: AggregateSearchSessionCommand,
  ports: AggregateSearchSessionPorts,
): Promise<AggregateSearchSessionResult> {
  const searchedProfileIds = new Set(command.scope.kind === 'profiles'
    ? command.scope.profileIds
    : [command.scope.profileId]);
  let resultsChanged = false;
  let progressed: { done: number; total: number; pending: number } | null = null;
  let flushTimer: unknown = null;
  let unsubscribe = (): void => undefined;
  const results = new SearchResultsAccumulator();

  const flush = (): void => {
    if (flushTimer !== null) {
      ports.clock.cancel(flushTimer);
      flushTimer = null;
    }
    if (!command.isCurrent()) return;
    if (resultsChanged) {
      resultsChanged = false;
      ports.publishPartialReport(results.snapshot());
    }
    if (progressed) ports.publishProgress(progressed);
  };

  try {
    try {
      unsubscribe = ports.api.onSearchAllProgress((event) => {
        if (event.wd !== command.term || !searchedProfileIds.has(event.profileId ?? '')) return;
        if (!command.isCurrent()) return;
        if (event.source) {
          results.add(event.source, { profileOrder: event.profileOrder ?? 0, sourceOrder: event.sourceOrder });
          resultsChanged = true;
        }
        progressed = {
          done: event.done,
          total: event.total,
          pending: event.pending ?? Math.max(0, event.total - event.done),
        };
        if (flushTimer === null) flushTimer = ports.clock.schedule(flush, 200);
      });
    } catch {
      // Progress is optional; the complete response remains authoritative.
    }

    const options = command.scope.kind === 'profiles'
      ? { refresh: command.refresh, profileIds: [...searchedProfileIds] }
      : { refresh: command.refresh, profileId: command.scope.profileId };
    const report = await ports.api.searchAll(command.term, options);
    if (!command.isCurrent()) return { kind: 'stale' };
    flush();
    return { kind: 'completed', report };
  } catch (error) {
    if (!command.isCurrent()) return { kind: 'stale' };
    return { kind: 'failed', message: String((error as Error)?.message ?? error) };
  } finally {
    if (flushTimer !== null) ports.clock.cancel(flushTimer);
    try {
      unsubscribe();
    } catch {
      // A renderer can disappear while the main-process search is still completing.
    }
    if (command.isCurrent()) ports.publishProgress(null);
  }
}

