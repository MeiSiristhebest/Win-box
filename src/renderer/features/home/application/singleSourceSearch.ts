import type { SearchAllReport } from '../../../../shared/types';
import { mergeSearchResults } from '../../../../engine/vod/aggSearch';
import type { HomeSearchPort } from './homePorts';

export interface SingleSourceSearchCommand {
  key: string;
  name: string;
  term: string;
  profileId: string;
  isCurrent(): boolean;
}

export interface SingleSourceSearchPorts {
  api: Pick<HomeSearchPort, 'search'>;
  clock: { now(): number };
}

export type SingleSourceSearchResult =
  | { kind: 'completed'; report: SearchAllReport }
  | { kind: 'stale' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs one source search and converts both empty and failed responses into the shared report model. */
export async function executeSingleSourceSearch(
  command: SingleSourceSearchCommand,
  ports: SingleSourceSearchPorts,
): Promise<SingleSourceSearchResult> {
  const startedAt = ports.clock.now();
  try {
    const items = await ports.api.search({ key: command.key, wd: command.term, profileId: command.profileId });
    if (!command.isCurrent()) return { kind: 'stale' };
    return {
      kind: 'completed',
      report: mergeSearchResults([{
        key: command.key,
        name: command.name,
        status: items.length > 0 ? 'ok' : 'empty',
        items,
        ms: ports.clock.now() - startedAt,
      }]),
    };
  } catch (error) {
    if (!command.isCurrent()) return { kind: 'stale' };
    return {
      kind: 'completed',
      report: mergeSearchResults([{
        key: command.key,
        name: command.name,
        status: 'error',
        error: errorMessage(error),
        ms: ports.clock.now() - startedAt,
      }]),
    };
  }
}
