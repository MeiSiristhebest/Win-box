import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverSection } from '../../../shared/types';
import type { DiscoverBoardDirectoryPort } from './application/discoveryPorts';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface BoardDirectoryPresentationState {
  sections: DiscoverSection[];
  sectionsStatus: LoadStatus;
  sectionsError: string;
  hasTmdbCredentials: boolean | null;
  credentialsStatus: LoadStatus;
  credentialsError: string;
  retrySections: () => Promise<void>;
  retryCredentials: () => Promise<void>;
  retry: () => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Owns independent loading/error state for the board feed and its optional TMDB credentials. */
export function useBoardDirectoryPresenter(port: DiscoverBoardDirectoryPort, active: boolean): BoardDirectoryPresentationState {
  const [sections, setSections] = useState<DiscoverSection[]>([]);
  const [sectionsStatus, setSectionsStatus] = useState<LoadStatus>('idle');
  const [sectionsError, setSectionsError] = useState('');
  const [hasTmdbCredentials, setHasTmdbCredentials] = useState<boolean | null>(null);
  const [credentialsStatus, setCredentialsStatus] = useState<LoadStatus>('idle');
  const [credentialsError, setCredentialsError] = useState('');
  const sectionRequestId = useRef(0);
  const credentialRequestId = useRef(0);

  const retrySections = useCallback(async (): Promise<void> => {
    const currentRequest = ++sectionRequestId.current;
    setSectionsStatus('loading');
    setSectionsError('');
    try {
      const nextSections = await port.loadSections();
      if (currentRequest !== sectionRequestId.current) return;
      setSections(nextSections);
      setSectionsStatus('ready');
    } catch (error) {
      if (currentRequest !== sectionRequestId.current) return;
      setSectionsStatus('failed');
      setSectionsError(errorMessage(error, '榜单加载失败'));
    }
  }, [port]);

  const retryCredentials = useCallback(async (): Promise<void> => {
    const currentRequest = ++credentialRequestId.current;
    setCredentialsStatus('loading');
    setCredentialsError('');
    try {
      const hasCredentials = await port.hasTmdbCredentials();
      if (currentRequest !== credentialRequestId.current) return;
      setHasTmdbCredentials(hasCredentials);
      setCredentialsStatus('ready');
    } catch (error) {
      if (currentRequest !== credentialRequestId.current) return;
      // Keep the last known value, if any, but expose the failed refresh explicitly.
      setCredentialsStatus('failed');
      setCredentialsError(errorMessage(error, 'TMDB 凭据状态读取失败'));
    }
  }, [port]);

  const retry = useCallback(async (): Promise<void> => {
    await Promise.all([retrySections(), retryCredentials()]);
  }, [retryCredentials, retrySections]);
  const invalidateRequests = useCallback(() => {
    sectionRequestId.current++;
    credentialRequestId.current++;
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void retry();
    });
    return () => {
      cancelled = true;
      invalidateRequests();
    };
  }, [active, invalidateRequests, retry]);

  return {
    sections,
    sectionsStatus,
    sectionsError,
    hasTmdbCredentials,
    credentialsStatus,
    credentialsError,
    retrySections,
    retryCredentials,
    retry,
  };
}
