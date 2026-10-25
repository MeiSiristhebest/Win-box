import { useEffect, useState } from 'react';
import type { DetailBackdropPort } from './application/detailBackdrop';

interface DetailBackdropOptions {
  identity: string;
  name: string;
  year?: string;
  mediaType: 'movie' | 'tv';
  enabled: boolean;
  loading: boolean;
  port: DetailBackdropPort;
}

/** Loads optional backdrop art without blocking the detail or playback workflow. */
export function useDetailBackdrop({ identity, name, year, mediaType, enabled, loading, port }: DetailBackdropOptions) {
  const [backdrop, setBackdrop] = useState<{ key: string; urls: string[] } | null>(null);

  useEffect(() => {
    if (loading || !name || !enabled) return;
    let active = true;
    void port.load(name, mediaType, year)
      .then((urls) => {
        if (active) setBackdrop({ key: identity, urls });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [enabled, identity, loading, mediaType, name, port, year]);

  return backdrop;
}
