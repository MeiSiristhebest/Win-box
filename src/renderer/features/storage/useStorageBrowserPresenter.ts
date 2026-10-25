import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DavEntry, DavServer } from '../../../shared/webdav';
import { davParentPath } from '../../../shared/webdav';
import { resolveDavEntryAction, type StorageBrowserPort } from './application/storageBrowser';

export function useStorageBrowserPresenter(port: StorageBrowserPort) {
  const [servers, setServers] = useState<DavServer[]>([]);
  const [serverId, setServerId] = useState('');
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<DavEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [playUrl, setPlayUrl] = useState('');
  const browseRequest = useRef(0);

  const browse = useCallback(async (id: string, nextPath: string): Promise<void> => {
    if (!id) return;
    const request = ++browseRequest.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await port.browse(id, nextPath);
      if (request !== browseRequest.current) return;
      setEntries(result.entries);
      setPath(result.path);
    } catch (cause) {
      if (request !== browseRequest.current) return;
      setError(errorMessage(cause));
      setEntries([]);
    } finally {
      if (request === browseRequest.current) setBusy(false);
    }
  }, [port]);

  useEffect(() => {
    let active = true;
    void port.listServers().then((list) => {
      if (!active) return;
      setServers(list);
      if (list.length) {
        setServerId(list[0].id);
        void browse(list[0].id, '/');
      }
    }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    });
    return () => { active = false; };
  }, [browse, port]);

  const selectServer = useCallback((id: string): void => {
    setServerId(id);
    setEntries([]);
    setPath('/');
    setPlayUrl('');
    setMessage('');
    void browse(id, '/');
  }, [browse]);

  const openEntry = useCallback(async (entry: DavEntry): Promise<void> => {
    setMessage('');
    const action = resolveDavEntryAction(entry, serverId);
    if (action.kind === 'browse') {
      setPlayUrl('');
      void browse(serverId, action.path);
      return;
    }
    if (action.kind === 'play-inline') {
      setPlayUrl(action.url);
      return;
    }
    setPlayUrl('');
    try {
      const result = await port.openExternal(action.url);
      setMessage(result.ok ? `已用「${result.player}」打开播放` : (result.error || '无法用外部播放器打开'));
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  }, [browse, port, serverId]);

  const segments = useMemo(() => path.split('/').filter(Boolean), [path]);
  const breadcrumbs = useMemo(() => segments.map((name, index) => ({
    name,
    path: '/' + segments.slice(0, index + 1).join('/'),
  })), [segments]);

  return {
    servers,
    serverId,
    currentServer: servers.find((server) => server.id === serverId),
    path,
    entries,
    busy,
    error,
    message,
    playUrl,
    breadcrumbs,
    browse,
    refresh: () => { void browse(serverId, path); },
    selectServer,
    openEntry,
    goToParent: () => { void browse(serverId, davParentPath(path)); },
    goToPath: (nextPath: string) => { void browse(serverId, nextPath); },
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
