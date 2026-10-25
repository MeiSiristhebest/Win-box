import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  LocalSourceImportPort,
  SubscriptionImportJobMemoryPort,
  SubscriptionImportJobsPort,
} from './application/subscriptionImportPorts';
import { useLocalSourceImport } from './useLocalSourceImport';
import { useSubscriptionImportJobs } from './useSubscriptionImportJobs';

interface UseSubscriptionImportOptions {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  onRefresh: () => Promise<void>;
  jobs: SubscriptionImportJobsPort;
  localSources: LocalSourceImportPort;
  jobMemory: SubscriptionImportJobMemoryPort;
}

/** Composition point for URL jobs and local-file imports used by the settings section. */
export function useSubscriptionImport({
  busy,
  setBusy,
  onRefresh,
  jobs: jobsPort,
  localSources,
  jobMemory,
}: UseSubscriptionImportOptions) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const jobs = useSubscriptionImportJobs({
    setBusy,
    setError,
    setName,
    name,
    onRefresh,
    importer: jobsPort,
    jobMemory,
  });
  const local = useLocalSourceImport({
    busy,
    setBusy,
    setError,
    setNotice,
    onRefresh,
    name,
    setName,
    importer: localSources,
  });

  return { ...jobs, ...local, name, setName, busy, error, notice, clearError: () => setError('') };
}
