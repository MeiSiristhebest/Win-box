import type { SearchAllReport, VodItem } from '../../../../shared/types';
import { mergeSearchResults } from '../../../../engine/vod/aggSearch';
import type { HomeSearchMem } from './HomeSearchMemory';

export type HomeSearchFolder = NonNullable<HomeSearchMem['folder']>;
export type HomeSearchScope = HomeSearchMem['aggScope'];

export interface HomeSearchFolderBack {
  report: SearchAllReport | null;
  scope: HomeSearchScope;
  sourceFilter: string;
  profileId: string;
  searchAllProfiles: boolean;
}

export interface OpenHomeSearchFolderCommand {
  sourceKey: string;
  categoryId: string;
  name: string;
  profileId: string;
  sourceName: string;
}

export interface OpenHomeSearchFolderPorts {
  category(request: { key: string; tid: string; pg: string; profileId: string }): Promise<{ items: VodItem[] }>;
  isCurrent(): boolean;
}

export type OpenHomeSearchFolderResult =
  | { kind: 'opened'; folder: HomeSearchFolder; report: SearchAllReport }
  | { kind: 'stale' }
  | { kind: 'failed'; message: string };

/** Loads one source folder and turns its category payload into the search-result model. */
export async function openHomeSearchFolder(
  command: OpenHomeSearchFolderCommand,
  ports: OpenHomeSearchFolderPorts,
): Promise<OpenHomeSearchFolderResult> {
  try {
    const result = await ports.category({
      key: command.sourceKey,
      tid: command.categoryId,
      pg: '1',
      profileId: command.profileId,
    });
    if (!ports.isCurrent()) return { kind: 'stale' };

    const items = (result?.items ?? []).map((item) => ({
      ...item,
      sourceKey: item.sourceKey || command.sourceKey,
    }));
    const report = mergeSearchResults([{
      key: command.sourceKey,
      name: `${command.sourceName} · ${command.name}`,
      status: items.length > 0 ? 'ok' : 'empty',
      items,
    }]);

    return {
      kind: 'opened',
      folder: {
        key: command.sourceKey,
        tid: command.categoryId,
        name: command.name,
        profileId: command.profileId,
        sourceName: command.sourceName,
      },
      report,
    };
  } catch (error) {
    if (!ports.isCurrent()) return { kind: 'stale' };
    return { kind: 'failed', message: String((error as Error)?.message ?? error) };
  }
}

export type ExitHomeSearchFolderResult =
  | {
    kind: 'restored';
    memory: HomeSearchMem;
    report: SearchAllReport | null;
    scope: HomeSearchScope;
    sourceFilter: string;
    searchAllSources: boolean;
    searchAllProfiles: boolean;
  }
  | { kind: 'search-again' };

/** Restores the exact search snapshot only while it still belongs to the active profile. */
export function resolveHomeSearchFolderExit(
  snapshot: HomeSearchFolderBack | null,
  activeProfileId: string,
  term: string,
): ExitHomeSearchFolderResult {
  if (!snapshot || snapshot.profileId !== activeProfileId) return { kind: 'search-again' };
  const searchAllSources = snapshot.scope === 'all' || snapshot.scope === 'all-profiles';
  return {
    kind: 'restored',
    memory: {
      wd: term,
      profileId: snapshot.profileId,
      aggMode: true,
      aggScope: snapshot.scope,
      searchAllSources,
      searchAllProfiles: snapshot.searchAllProfiles,
      agg: snapshot.report,
      folder: null,
    },
    report: snapshot.report,
    scope: snapshot.scope,
    sourceFilter: snapshot.sourceFilter,
    searchAllSources,
    searchAllProfiles: snapshot.searchAllProfiles,
  };
}
