import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import { wrapImageUrlForRelay } from '../../shared/driveProvider';
import { preloadImage, resolveCover, type CoverRequest } from './coverPick';

export interface CoverItem extends CoverRequest { id: string }
// 同一窗口中的重复片名共享请求；队列限制主进程查询和图片预加载的并发。
const queries = new Map<string, Promise<string>>();
const lanes: Promise<unknown>[] = Array.from({ length: 4 }, () => Promise.resolve());
let lane = 0;
let settingsRequest: Promise<{ key: string; hasTmdb: boolean }> | null = null;
let settingsSnapshot: { key: string; hasTmdb: boolean } | null = null;
let settingsExpiresAt = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const slot = lane++ % lanes.length;
  const pending = lanes[slot].then(job);
  lanes[slot] = pending.catch(() => undefined);
  return pending;
}

function getMetaSettings(forceRefresh = false): Promise<{ key: string; hasTmdb: boolean }> {
  if (settingsRequest) return settingsRequest;
  if (!forceRefresh && settingsSnapshot && Date.now() < settingsExpiresAt) return Promise.resolve(settingsSnapshot);
  if (!settingsRequest) {
    const request = client.metaGetSettings().then((settings) => ({
      key: JSON.stringify([settings.tmdbApiKey, settings.tmdbApiBase, settings.tmdbImageBase]),
      hasTmdb: settings.hasUserKey,
    })).then((snapshot) => {
      settingsSnapshot = snapshot;
      settingsExpiresAt = Date.now() + 30_000;
      return snapshot;
    });
    settingsRequest = request;
    const clear = (): void => { if (settingsRequest === request) settingsRequest = null; };
    void request.then(clear, clear);
  }
  return settingsRequest;
}

/** 所有页面共用封面链路，始终保留原始源图，不把补图写回来源或历史。 */
export function useCovers(items: CoverItem[], enabled = true, sourceFirst = false) {
  const [settings, setSettings] = useState<{ key: string; hasTmdb: boolean } | null>(null);
  const [, setCoverRevision] = useState(0);
  const [failed, setFailed] = useState<Record<string, string[]>>({});
  const covers = useRef(new Map<string, string>());
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signature = JSON.stringify(items.map(({ id, name, year, pic }) => [id, name, year, pic]));
  // Only display fields belong to this signature; avoid cloning and parsing the full list per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableItems = useMemo(() => items.map((item) => ({ ...item })), [signature]);
  const publishCoverBatch = useCallback(() => {
    if (publishTimer.current !== null) return;
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      setCoverRevision((revision) => revision + 1);
    }, 32);
  }, []);

  useEffect(() => () => {
    if (publishTimer.current !== null) clearTimeout(publishTimer.current);
  }, []);

  useEffect(() => {
    let alive = true;
    let request = 0;
    const load = (): void => {
      const current = ++request;
      void getMetaSettings(current > 1).then(s => {
        if (!alive || current !== request) return;
        setSettings((previous) => previous?.key === s.key && previous.hasTmdb === s.hasTmdb ? previous : s);
      }).catch(() => { if (alive && current === request) setSettings(prev => prev || { key: '', hasTmdb: false }); });
    };
    load();
    const storage = (event: StorageEvent): void => { if (event.key === 'winbox-meta-revision') load(); };
    window.addEventListener('focus', load);
    window.addEventListener('winbox:meta-changed', load);
    window.addEventListener('storage', storage);
    return () => {
      alive = false;
      window.removeEventListener('focus', load);
      window.removeEventListener('winbox:meta-changed', load);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const itemKey = (item: CoverItem): string => JSON.stringify([settings?.key, item.id, item.name, item.year, item.pic]);
  useEffect(() => {
    if (!enabled || !settings) return;
    let alive = true;
    for (const item of stableItems) {
      const key = JSON.stringify([settings.key, item.id, item.name, item.year, item.pic]);
      if (covers.current.has(key)) continue;
      // 发现列表保留来源海报，由 img 的原生懒加载决定何时请求。
      if (sourceFirst && item.pic?.trim() && !failed[key]?.includes(item.pic.trim())) continue;
      void enqueue(async () => {
        if (!alive) return;
        const cover = await resolveCover(item, {
          hasTmdb: settings.hasTmdb,
          query: provider => {
            if (!item.name.trim()) return Promise.resolve('');
            const queryKey = JSON.stringify([settings.key, provider, item.name, item.year]);
            let job = queries.get(queryKey);
            if (!job) {
              job = client.metaSearch(item.name, item.year, provider).then(hit => hit?.poster || '').catch(() => '');
              if (queries.size >= 500) queries.delete(queries.keys().next().value!);
              queries.set(queryKey, job);
              void job.then(poster => { if (!poster && queries.get(queryKey) === job) queries.delete(queryKey); });
            }
            return job;
          },
          validate: url => failed[key]?.includes(url) ? Promise.resolve(false) : preloadImage(url),
          relay: url => /\/(?:img|file)\?/.test(url) ? '' : wrapImageUrlForRelay(url, navigator.userAgent),
        });
        if (alive) {
          if (covers.current.size >= 1000 && !covers.current.has(key)) {
            covers.current.delete(covers.current.keys().next().value!);
          }
          covers.current.set(key, cover);
          publishCoverBatch();
        }
      });
    }
    return () => { alive = false; };
    // 完成结果不重启批次，避免仍在处理的队列被取消。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableItems, settings, enabled, sourceFirst, failed, publishCoverBatch]);
  const refresh = useCallback(() => { covers.current.clear(); setFailed({}); }, []);
  return {
    refresh,
    picOf: (item: CoverItem): string => {
      const key = itemKey(item);
      const source = item.pic?.trim() || '';
      return covers.current.get(key) ?? (failed[key]?.includes(source) ? '' : source);
    },
    onError: (item: CoverItem, url: string): void => {
      const key = itemKey(item);
      if (failed[key]?.includes(url)) return;
      setFailed(prev => prev[key]?.includes(url) ? prev : ({ ...prev, [key]: [...(prev[key] || []), url] }));
      covers.current.delete(key);
    },
  };
}
