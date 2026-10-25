import { useCallback, useEffect, useRef, useState } from 'react';
import type { DavServer } from '../../../shared/webdav';
import type { StorageSettingsPort } from './application/settingsSectionPorts';
import type { StorageSettingsViewModel } from './storageSettingsViewModel';

const EMPTY_SERVER: DavServer = { id: '', name: '', url: '', username: '', password: '' };
type ConfirmStorageRemoval = (message: string, options: { title: string; confirmLabel: string; tone: 'danger' }) => Promise<boolean>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function upsertServer(servers: DavServer[], saved: DavServer): DavServer[] {
  const index = servers.findIndex((server) => server.id === saved.id);
  if (index < 0) return [saved, ...servers];
  return servers.map((server, currentIndex) => currentIndex === index ? saved : server);
}

export function useStorageSettingsPresenter(
  active: boolean,
  port: StorageSettingsPort,
  confirmRemoval: ConfirmStorageRemoval,
) {
  const [loadState, setLoadState] = useState<StorageSettingsViewModel['loadState']>('loading');
  const [servers, setServers] = useState<DavServer[]>([]);
  const [draft, setDraft] = useState<DavServer>({ ...EMPTY_SERVER });
  const [message, setMessage] = useState<StorageSettingsViewModel['message']>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const busyRef = useRef(false);
  const listRevision = useRef(0);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const requestRevision = ++listRevision.current;
    void port.listServers().then((next) => {
      if (!current || requestRevision !== listRevision.current) return;
      setServers(next);
      setLoadState('ready');
      setMessage(null);
    }).catch((error: unknown) => {
      if (!current || requestRevision !== listRevision.current) return;
      setLoadState('error');
      setMessage({ text: `存储列表读取失败：${errorMessage(error)}`, kind: 'err' });
    });
    return () => { current = false; };
  }, [active, port]);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestRevision = ++listRevision.current;
    setBusy(true);
    setRefreshing(true);
    try {
      const next = await port.listServers();
      if (requestRevision !== listRevision.current) return;
      setServers(next);
      setLoadState('ready');
      setMessage({ text: '存储列表已刷新', kind: 'ok' });
    } catch (error) {
      if (requestRevision !== listRevision.current) return;
      setMessage({ text: `列表刷新失败：${errorMessage(error)}`, kind: 'err' });
    } finally {
      busyRef.current = false;
      setBusy(false);
      setRefreshing(false);
    }
  }, [port]);

  const updateDraft = useCallback((patch: Partial<DavServer>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }, []);

  const edit = useCallback((server: DavServer) => {
    setDraft({ ...server });
    setMessage(null);
  }, []);

  const clearDraft = useCallback(() => {
    setDraft({ ...EMPTY_SERVER });
    setMessage(null);
  }, []);

  const save = useCallback(async () => {
    if (busyRef.current || !draft.url.trim()) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await port.saveServer(draft);
      ++listRevision.current;
      // The write is already committed. Reflect it locally before refreshing so a
      // refresh failure cannot make the user believe the write failed or retry it.
      setServers((current) => upsertServer(current, saved));
      setLoadState('ready');
      setDraft({ ...EMPTY_SERVER });
      try {
        setServers(await port.listServers());
        setLoadState('ready');
        setMessage({ text: `已保存「${saved.name}」`, kind: 'ok' });
      } catch (error) {
        setMessage({ text: `已保存「${saved.name}」，但列表刷新失败；当前列表已保留本次更改。可点击“刷新列表”重试：${errorMessage(error)}`, kind: 'warn' });
      }
    } catch (error) {
      setMessage({ text: `保存失败：${errorMessage(error)}`, kind: 'err' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [draft, port]);

  const remove = useCallback(async (server: DavServer) => {
    if (busyRef.current) return;
    const accepted = await confirmRemoval(`确定删除存储「${server.name}」？`, {
      title: '删除存储', confirmLabel: '删除', tone: 'danger',
    });
    if (!accepted || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await port.removeServer(server.id);
      ++listRevision.current;
      setServers((current) => current.filter((item) => item.id !== server.id));
      setLoadState('ready');
      setDraft((current) => current.id === server.id ? { ...EMPTY_SERVER } : current);
      try {
        setServers(await port.listServers());
        setLoadState('ready');
        setMessage({ text: `已删除「${server.name}」`, kind: 'ok' });
      } catch (error) {
        setMessage({ text: `已删除「${server.name}」，但列表刷新失败；当前列表已移除此项。可点击“刷新列表”重试：${errorMessage(error)}`, kind: 'warn' });
      }
    } catch (error) {
      setMessage({ text: `删除失败：${errorMessage(error)}`, kind: 'err' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [confirmRemoval, port]);

  const test = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await port.testServer(draft);
      setMessage({ text: `连接成功：${result.path} 下 ${result.entries.length} 项`, kind: 'ok' });
    } catch (error) {
      setMessage({ text: `连接测试失败：${errorMessage(error)}`, kind: 'err' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [draft, port]);

  return {
    model: { loadState, servers, draft, message, busy, refreshing } satisfies StorageSettingsViewModel,
    actions: { updateDraft, edit, clearDraft, save, remove, test, refresh },
  };
}
