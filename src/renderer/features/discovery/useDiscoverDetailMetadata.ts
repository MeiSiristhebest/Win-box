import { useEffect, useState } from 'react';
import { loadDiscoverDetailMetadata, type DiscoverDetailMetadata, type DiscoverDetailMetadataPort } from './application/discoverDetailMetadata';

interface LoadedMetadata extends DiscoverDetailMetadata {
  requestKey: string;
}

export function useDiscoverDetailMetadata(title: string, year: string, port: DiscoverDetailMetadataPort) {
  const requestKey = JSON.stringify([title, year]);
  const [loaded, setLoaded] = useState<LoadedMetadata | null>(null);

  useEffect(() => {
    if (!title) return;
    let active = true;
    void loadDiscoverDetailMetadata(title, year, port).then((result) => {
      if (active) setLoaded({ ...result, requestKey });
    });
    return () => { active = false; };
  }, [port, requestKey, title, year]);

  const current = loaded?.requestKey === requestKey ? loaded : null;
  return {
    meta: current?.meta ?? null,
    extra: current?.extra ?? null,
    error: current?.error || '',
    loading: Boolean(title) && !current,
  };
}
