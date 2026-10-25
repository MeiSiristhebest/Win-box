import type { DavEntry } from '../../../../shared/webdav';
import { isDavInlinePlayable, wrapDavPlayUrl } from '../../../../shared/webdav';

export type DavEntryAction =
  | { kind: 'browse'; path: string }
  | { kind: 'play-inline'; url: string }
  | { kind: 'open-external'; url: string };

export function resolveDavEntryAction(entry: DavEntry, serverId: string): DavEntryAction {
  if (entry.isDir) return { kind: 'browse', path: entry.path };
  const url = wrapDavPlayUrl(entry.url, serverId);
  return isDavInlinePlayable(entry.name)
    ? { kind: 'play-inline', url }
    : { kind: 'open-external', url };
}

export interface StorageBrowserPort {
  listServers(): Promise<import('../../../../shared/webdav').DavServer[]>;
  browse(serverId: string, path: string): Promise<{ entries: DavEntry[]; path: string }>;
  openExternal(url: string): Promise<{ ok: boolean; player?: string; error?: string }>;
}
