import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserConfig } from '../../../shared/types';
import type { ConfigurationSnapshotPort } from './application/configurationPagePorts';

/** Owns the lifetime and write authority of configuration snapshot reads. */
export function useConfigurationSnapshotSession(port: ConfigurationSnapshotPort) {
  const [configuration, setConfiguration] = useState<UserConfig | null>(null);
  const requestGeneration = useRef(0);

  useEffect(() => () => {
    requestGeneration.current += 1;
  }, [port]);

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestGeneration.current;
    let nextConfiguration: UserConfig;
    try {
      nextConfiguration = await port.load();
    } catch (error) {
      if (request !== requestGeneration.current) return;
      throw error;
    }
    if (request !== requestGeneration.current) return;
    setConfiguration(nextConfiguration);
    port.announceSourcesChanged();
  }, [port]);

  return { configuration, refresh };
}
