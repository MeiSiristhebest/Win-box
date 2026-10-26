// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserConfig } from '../src/shared/types';
import type { ConfigurationSnapshotPort } from '../src/renderer/features/settings/application/configurationPagePorts';
import { resolveConfigurationPageRoute, searchConfigurationSettings } from '../src/renderer/features/settings/application/configurationPagePresentation';
import { useConfigurationPagePresenter } from '../src/renderer/features/settings/useConfigurationPagePresenter';

function configuration(revision: string): UserConfig {
  return { revision } as unknown as UserConfig;
}

function createConfigurationPort(load: ConfigurationSnapshotPort['load']): ConfigurationSnapshotPort {
  return { load, announceSourcesChanged: vi.fn() };
}

describe('configuration page presentation model', () => {
  it('resolves section deep links, legacy tab aliases, and defaults through a pure route rule', () => {
    expect(resolveConfigurationPageRoute(new URLSearchParams('section=mpv-kernel'))).toEqual({
      requestedSection: 'mpv-kernel',
      requestedTab: 'play',
      activeTab: 'play',
    });
    expect(resolveConfigurationPageRoute(new URLSearchParams('section=plugin-custom-panel'))).toMatchObject({
      requestedTab: 'plugins',
      activeTab: 'plugins',
    });
    expect(resolveConfigurationPageRoute(new URLSearchParams('tab=network')).activeTab).toBe('network');
    expect(resolveConfigurationPageRoute(new URLSearchParams()).activeTab).toBe('sources');
  });

  it('matches labels, descriptions, and keywords after trimming and normalizing search input', () => {
    expect(searchConfigurationSettings('  PROXY  ').map((section) => section.id)).toContain('network');
    expect(searchConfigurationSettings('字幕').map((section) => section.id)).toContain('play');
    expect(searchConfigurationSettings('no-such-setting')).toEqual([]);
  });
});

describe('useConfigurationPagePresenter', () => {
  it('clears search when switching tabs and delegates route updates to the navigation port', async () => {
    const navigateToTab = vi.fn();
    const configurationPort = createConfigurationPort(vi.fn().mockResolvedValue(configuration('loaded')));
    const { result } = renderHook(() => useConfigurationPagePresenter({
      searchParams: new URLSearchParams('tab=network'),
      navigateToTab,
      configuration: configurationPort,
    }));

    act(() => result.current.changeSettingsQuery('  proxy '));
    expect(result.current.searchTerm).toBe('proxy');
    expect(result.current.matchingSections.map((section) => section.id)).toContain('network');

    act(() => result.current.selectTab('account'));
    expect(navigateToTab).toHaveBeenCalledWith('account');
    expect(result.current.searchTerm).toBe('');
    expect(result.current.tab).toBe('network');

    await waitFor(() => expect(result.current.configurationLoadStatus).toBe('ready'));
  });

  it('keeps IME Escape input intact and clears search on a normal Escape key', () => {
    const configurationPort = createConfigurationPort(vi.fn().mockResolvedValue(configuration('loaded')));
    const { result } = renderHook(() => useConfigurationPagePresenter({
      searchParams: new URLSearchParams(),
      navigateToTab: vi.fn(),
      configuration: configurationPort,
    }));

    act(() => result.current.changeSettingsQuery('subtitle'));
    act(() => result.current.handleSearchKey('Escape', true));
    expect(result.current.settingsQuery).toBe('subtitle');
    act(() => result.current.handleSearchKey('Escape', false));
    expect(result.current.settingsQuery).toBe('');
  });

  it('shows an initial load failure and retries to a ready configuration state', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('configuration unavailable'))
      .mockResolvedValueOnce(configuration('recovered'));
    const configurationPort = createConfigurationPort(load);
    const { result } = renderHook(() => useConfigurationPagePresenter({
      searchParams: new URLSearchParams(),
      navigateToTab: vi.fn(),
      configuration: configurationPort,
    }));

    await waitFor(() => expect(result.current.configurationLoadStatus).toBe('failed'));
    expect(result.current.configurationError).toBe('configuration unavailable');

    await act(async () => {
      await result.current.retryConfigurationLoad();
    });
    expect(result.current.configurationLoadStatus).toBe('ready');
    expect(result.current.configurationError).toBe('');
    expect(result.current.configuration).toEqual(configuration('recovered'));
  });

  it('owns the shared settings busy state consumed by existing import and activation presenters', () => {
    const configurationPort = createConfigurationPort(vi.fn().mockResolvedValue(configuration('loaded')));
    const { result } = renderHook(() => useConfigurationPagePresenter({
      searchParams: new URLSearchParams(),
      navigateToTab: vi.fn(),
      configuration: configurationPort,
    }));

    act(() => result.current.setBusy(true));
    expect(result.current.busy).toBe(true);
    act(() => result.current.setBusy(false));
    expect(result.current.busy).toBe(false);
  });
});
