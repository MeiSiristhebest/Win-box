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

interface ConfigurationLoadState {
  port: ConfigurationSnapshotPort | null;
  status: ConfigurationLoadStatus;
  error: string;
}

interface ConfigurationLoadResult extends ConfigurationLoadState {
  generation: number;
}

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
  const [configurationLoad, setConfigurationLoad] = useState<ConfigurationLoadState>({
    port: null,
    status: 'loading',
    error: '',
  });
  const loadGeneration = useRef(0);

  const requestConfigurationLoad = useCallback((): Promise<ConfigurationLoadResult> => {
    const generation = ++loadGeneration.current;
    return Promise.resolve()
      .then(() => refresh())
      .then<ConfigurationLoadResult, ConfigurationLoadResult>(
        () => ({ generation, port: configurationPort, status: 'ready', error: '' }),
        (error: unknown) => ({
          generation,
          port: configurationPort,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }, [configurationPort, refresh]);

  useEffect(() => {
    let active = true;
    void requestConfigurationLoad().then((result) => {
      if (active && result.generation === loadGeneration.current) {
        const { generation: _generation, ...state } = result;
        setConfigurationLoad(state);
      }
    });
    return () => {
      active = false;
      loadGeneration.current += 1;
    };
  }, [requestConfigurationLoad]);

  const retryConfigurationLoad = useCallback(async () => {
    setConfigurationLoad({ port: configurationPort, status: 'loading', error: '' });
    const result = await requestConfigurationLoad();
    if (result.generation !== loadGeneration.current) return false;
    const { generation: _generation, ...state } = result;
    setConfigurationLoad(state);
    return result.status === 'ready';
  }, [configurationPort, requestConfigurationLoad]);

  const configurationLoadStatus = configurationLoad.port === configurationPort
    ? configurationLoad.status
    : 'loading';
  const configurationError = configurationLoad.port === configurationPort
    ? configurationLoad.error
    : '';

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
    retryConfigurationLoad,
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
