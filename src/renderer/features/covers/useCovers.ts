import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveCover, type CoverRequest } from '../../lib/coverPick';
import { useCoverRuntimePorts } from './CoverLookupContext';
import type { CoverLookupSettings } from './application/coverLookupPort';
import { sharedCoverLookupCoordinator } from './application/CoverLookupCoordinator';

export interface CoverItem extends CoverRequest { id: string }

/** Shared cover workflow: keep source posters intact and fetch enriched covers only for the current view. */
export function useCovers(items: CoverItem[], enabled = true, sourceFirst = false) {
  const { lookup: port, settingsChanges, images, clock } = useCoverRuntimePorts();
  const lookupCoordinator = useMemo(() => sharedCoverLookupCoordinator(port, clock), [port, clock]);
  const [settings, setSettings] = useState<CoverLookupSettings | null>(null);
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
      void lookupCoordinator.loadSettings(current > 1).then((snapshot) => {
        if (!alive || current !== request) return;
        setSettings((previous) => previous?.key === snapshot.key && previous.hasTmdb === snapshot.hasTmdb ? previous : snapshot);
      }).catch(() => { if (alive && current === request) setSettings((previous) => previous || { key: '', hasTmdb: false }); });
    };
    load();
    const unsubscribeSettingsChanges = settingsChanges.subscribe(load);
    return () => {
      alive = false;
      unsubscribeSettingsChanges();
    };
  }, [lookupCoordinator, settingsChanges]);

  const itemKey = (item: CoverItem): string => JSON.stringify([settings?.key, item.id, item.name, item.year, item.pic]);
  useEffect(() => {
    if (!enabled || !settings) return;
    let alive = true;
    for (const item of stableItems) {
      const key = JSON.stringify([settings.key, item.id, item.name, item.year, item.pic]);
      if (covers.current.has(key)) continue;
      // Keep source covers in discovery lists and let the browser's native lazy loading decide when to fetch.
      if (sourceFirst && item.pic?.trim() && !failed[key]?.includes(item.pic.trim())) continue;
      void lookupCoordinator.enqueue(async () => {
        if (!alive) return;
        const cover = await resolveCover(item, {
          hasTmdb: settings.hasTmdb,
          query: (provider) => {
            if (!provider || !item.name.trim()) return Promise.resolve('');
            return lookupCoordinator.searchPoster(item.name, item.year, provider, settings.key);
          },
          validate: (url) => failed[key]?.includes(url) ? Promise.resolve(false) : images.validate(url),
          relay: images.relay,
        });
        if (alive) {
          if (covers.current.size >= 1000 && !covers.current.has(key)) covers.current.delete(covers.current.keys().next().value!);
          covers.current.set(key, cover);
          publishCoverBatch();
        }
      });
    }
    return () => { alive = false; };
    // Completed batches should not restart their queue as individual results arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableItems, settings, enabled, sourceFirst, failed, publishCoverBatch, lookupCoordinator, images]);

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
      setFailed((previous) => previous[key]?.includes(url) ? previous : ({ ...previous, [key]: [...(previous[key] || []), url] }));
      covers.current.delete(key);
    },
  };
}
