import type { SearchAllReport } from '../../../../shared/types';
import type { AggregateSearchSessionClock } from './aggregateSearchSession';
import { executeAggregateSearchSession } from './aggregateSearchSession';
import type { HomeSearchPort } from './homePorts';
import { executeSingleSourceSearch } from './singleSourceSearch';

export type HomeSearchExecutionScope =
  | { kind: 'current'; profileId: string; source: { key: string; name: string } | null }
  | { kind: 'all'; profileId: string }
  | { kind: 'all-profiles'; profileIds: string[] };

export interface HomeSearchExecutionCommand {
  term: string;
  refresh: boolean;
  scope: HomeSearchExecutionScope;
  signal?: AbortSignal;
  isCurrent(): boolean;
}

export interface HomeSearchExecutionPorts {
  api: Pick<HomeSearchPort, 'onSearchAllProgress' | 'searchAll' | 'search'>;
  aggregateClock: AggregateSearchSessionClock;
  wallClock: { now(): number };
  publishPartialReport(report: SearchAllReport): void;
  publishProgress(progress: { done: number; total: number; pending: number } | null): void;
}

export type HomeSearchExecutionResult =
  | { kind: 'completed'; scope: 'current' | 'all' | 'all-profiles'; report: SearchAllReport }
  | { kind: 'stale' }
  | { kind: 'failed'; message: string }
  | { kind: 'no-source' }
  | { kind: 'no-profiles' };

/** Chooses and runs a search scope without depending on React or renderer routing. */
export async function executeHomeSearch(
  command: HomeSearchExecutionCommand,
  ports: HomeSearchExecutionPorts,
): Promise<HomeSearchExecutionResult> {
  if (command.scope.kind === 'current') {
    if (!command.scope.source) return { kind: 'no-source' };
    const result = await executeSingleSourceSearch({
      key: command.scope.source.key,
      name: command.scope.source.name,
      term: command.term,
      profileId: command.scope.profileId,
      signal: command.signal,
      isCurrent: command.isCurrent,
    }, { api: { search: ports.api.search }, clock: ports.wallClock });
    return result.kind === 'stale'
      ? result
      : { kind: 'completed', scope: 'current', report: result.report };
  }

  if (command.scope.kind === 'all-profiles' && command.scope.profileIds.length === 0) {
    return { kind: 'no-profiles' };
  }

  const aggregate = await executeAggregateSearchSession({
    term: command.term,
    refresh: command.refresh,
    scope: command.scope.kind === 'all-profiles'
      ? { kind: 'profiles', profileIds: command.scope.profileIds }
      : { kind: 'profile', profileId: command.scope.profileId },
    isCurrent: command.isCurrent,
    signal: command.signal,
  }, {
    api: { onSearchAllProgress: ports.api.onSearchAllProgress, searchAll: ports.api.searchAll },
    clock: ports.aggregateClock,
    publishPartialReport: ports.publishPartialReport,
    publishProgress: ports.publishProgress,
  });

  if (aggregate.kind === 'stale' || aggregate.kind === 'failed') return aggregate;
  return {
    kind: 'completed',
    scope: command.scope.kind === 'all-profiles' ? 'all-profiles' : 'all',
    report: aggregate.report,
  };
}
