import { createContext, useContext, type ReactNode } from 'react';
import type { CoverRuntimePorts } from './application/coverLookupPort';

const unavailableCoverPorts: CoverRuntimePorts = {
  lookup: {
    loadSettings: async () => ({ key: '', hasTmdb: false }),
    searchPoster: async () => '',
  },
  settingsChanges: { subscribe: () => () => undefined },
  images: { validate: async () => true, relay: (url) => url },
  clock: { now: () => 0 },
};

const CoverLookupContext = createContext<CoverRuntimePorts>(unavailableCoverPorts);

export function CoversProvider({ ports, children }: { ports: CoverRuntimePorts; children: ReactNode }) {
  return <CoverLookupContext.Provider value={ports}>{children}</CoverLookupContext.Provider>;
}

export function useCoverRuntimePorts(): CoverRuntimePorts {
  return useContext(CoverLookupContext);
}
