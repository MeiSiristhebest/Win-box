import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigurationSnapshotPort } from './application/configurationPagePorts';
import {
  normalizeConfigurationSettingsSearch,
  resolveConfigurationPageRoute,
  searchConfigurationSettings,
  type ConfigurationSettingsSection,
  type ConfigurationSettingsTab,
} from './application/configurationPagePresentation';
import { useConfigurationSnapshotSession } from './useConfigurationSnapshotSession';

export type ConfigurationLoadStatus = 'loading' | 'ready' | 'failed';

interface ConfigurationPagePresenterOptions {
  searchParams: URLSearchParams;
  navigateToTab(tab: ConfigurationSettingsTab): void;
  configuration: ConfigurationSnapshotPort;
}

/** Owns shared settings-page state while section presenters own their business workflows. */
export function useConfigurationPagePresenter({
  searchParams,
  navigateToTab,
  configuration: configurationPort,
}: ConfigurationPagePresenterOptions) {
  const route = resolveConfigurationPageRoute(searchParams);
  const { configuration, refresh } = useConfigurationSnapshotSession(configurationPort);
  const [busy, setBusy] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [configurationError, setConfigurationError] = useState('');
  const [configurationLoadStatus, setConfigurationLoadStatus] = useState<ConfigurationLoadStatus>('loading');
  const loadGeneration = useRef(0);

  const loadConfiguration = useCallback(async (): Promise<boolean> => {
    const generation = ++loadGeneration.current;
    setConfigurationError('');
    setConfigurationLoadStatus('loading');
    try {
      await refresh();
      if (generation !== loadGeneration.current) return false;
      setConfigurationLoadStatus('ready');
      return true;
    } catch (error) {
      if (generation !== loadGeneration.current) return false;
      setConfigurationError(error instanceof Error ? error.message : String(error));
      setConfigurationLoadStatus('failed');
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    void loadConfiguration();
    return () => {
      loadGeneration.current += 1;
    };
  }, [loadConfiguration]);

  const searchTerm = normalizeConfigurationSettingsSearch(settingsQuery);
  const matchingSections: readonly ConfigurationSettingsSection[] = searchConfigurationSettings(searchTerm);
  const changeSettingsQuery = useCallback((query: string) => setSettingsQuery(query), []);
  const clearSettingsQuery = useCallback(() => setSettingsQuery(''), []);
  const handleSearchKey = useCallback((key: string, isComposing: boolean) => {
    if (key === 'Escape' && !isComposing) setSettingsQuery('');
  }, []);
  const selectTab = useCallback((tab: ConfigurationSettingsTab) => {
    setSettingsQuery('');
    navigateToTab(tab);
  }, [navigateToTab]);

  return {
    configuration,
    refresh,
    busy,
    setBusy,
    configurationError,
    configurationLoadStatus,
    retryConfigurationLoad: loadConfiguration,
    requestedSection: route.requestedSection,
    requestedTab: route.requestedTab,
    tab: route.activeTab,
    settingsQuery,
    searchTerm,
    matchingSections,
    changeSettingsQuery,
    clearSettingsQuery,
    handleSearchKey,
    selectTab,
  };
}
