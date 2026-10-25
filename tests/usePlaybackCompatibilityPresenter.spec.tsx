// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYER_SETTINGS, type MpvStatus, type PlayerSettings } from '../src/shared/player';
import type { MpvSettingsPort, PlayerSettingsPort } from '../src/renderer/features/settings/application/playbackSettingsPorts';
import { usePlaybackCompatibilityPresenter } from '../src/renderer/features/settings/usePlaybackCompatibilityPresenter';

const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
const availableStatus: MpvStatus = { available: true, path: 'mpv.exe', source: 'bundled', note: '已就绪' };

function createPorts(saved: PlayerSettings = settings): PlayerSettingsPort {
  return {
    loadSettings: vi.fn().mockResolvedValue(settings),
    saveSettings: vi.fn().mockResolvedValue(saved),
  };
}

describe('usePlaybackCompatibilityPresenter', () => {
  it('loads availability and saves a trimmed custom path', async () => {
    const statusQuery: MpvSettingsPort = { loadStatus: vi.fn().mockResolvedValue(availableStatus) };
    const settingsPort = createPorts();
    const onSettingsSaved = vi.fn();
    const onAvailabilityChange = vi.fn();
    const { result } = renderHook(() => usePlaybackCompatibilityPresenter({
      active: true,
      settingsLoaded: true,
      settings,
      settingsReader: settingsPort,
      settingsWriter: settingsPort,
      statusQuery,
      onSettingsSaved,
      onAvailabilityChange,
    }));

    await waitFor(() => expect(result.current.model.statusLabel).toContain('已就绪'));
    act(() => result.current.actions.setPathDraft('  C:\\Player\\mpv.exe  '));
    await act(async () => { await result.current.actions.savePath(); });

    expect(settingsPort.saveSettings).toHaveBeenCalledWith({ mpvPath: 'C:\\Player\\mpv.exe' });
    expect(onSettingsSaved).toHaveBeenCalledWith(settings);
    expect(onAvailabilityChange).toHaveBeenCalledWith(true);
    expect(result.current.model.message).toMatchObject({ kind: 'ok' });
  });

  it('reports a saved path when only the subsequent status refresh fails', async () => {
    const statusQuery: MpvSettingsPort = {
      loadStatus: vi.fn().mockResolvedValueOnce(availableStatus).mockRejectedValueOnce(new Error('status unavailable')),
    };
    const settingsPort = createPorts();
    const onSettingsSaved = vi.fn();
    const onAvailabilityChange = vi.fn();
    const { result } = renderHook(() => usePlaybackCompatibilityPresenter({
      active: true,
      settingsLoaded: true,
      settings,
      settingsReader: settingsPort,
      settingsWriter: settingsPort,
      statusQuery,
      onSettingsSaved,
      onAvailabilityChange,
    }));

    await waitFor(() => expect(statusQuery.loadStatus).toHaveBeenCalledOnce());
    act(() => result.current.actions.setPathDraft('custom-mpv.exe'));
    await act(async () => { await result.current.actions.savePath(); });

    expect(settingsPort.saveSettings).toHaveBeenCalledOnce();
    expect(result.current.model.message).toMatchObject({ kind: 'err', text: expect.stringContaining('已保存，但兼容组件状态刷新失败') });
  });
});
