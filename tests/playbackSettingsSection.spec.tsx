// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaybackSettingsSection } from '../src/renderer/features/settings/PlaybackSettingsSection';
import { client } from '../src/renderer/api/client';
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../src/shared/player';
import { loadPlayerPrefs } from '../src/renderer/lib/playerPrefs';

vi.mock('../src/renderer/api/client', () => ({ client: { playerPrefsGet: vi.fn(), playerPrefsSet: vi.fn(), mpvStatus: vi.fn(), vodDetectPlayers: vi.fn(), btDetectPlayers: vi.fn() } }));
vi.mock('../src/renderer/features/settings/PlayerEngineSettings', () => ({ PlayerEngineSettings: () => null }));

const player = { id: 'potplayer', name: 'PotPlayer', path: 'C:\\Players\\PotPlayerMini64.exe' };
beforeEach(() => {
  vi.clearAllMocks();
  let settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  vi.mocked(client.playerPrefsGet).mockImplementation(async () => settings);
  vi.mocked(client.playerPrefsSet).mockImplementation(async patch => { settings = { ...settings, ...patch }; return settings; });
  vi.mocked(client.mpvStatus).mockResolvedValue({ available: true, source: 'bundled', path: 'mpv.exe', note: '使用随包版本' });
  vi.mocked(client.vodDetectPlayers).mockResolvedValue([player]);
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('playback settings', () => {
  it('does not query playback components while the settings section is inactive', () => {
    render(<PlaybackSettingsSection active={false} />);
    expect(client.playerPrefsGet).not.toHaveBeenCalled();
    expect(client.mpvStatus).not.toHaveBeenCalled();
  });

  it('defaults to automatic playback and keeps manual component paths in advanced controls', () => {
    render(<PlaybackSettingsSection active />);
    const mode = screen.getByRole('combobox', { name: '应用内播放方式' }) as HTMLSelectElement;
    expect(mode.value).toBe('auto');
    fireEvent.change(mode, { target: { value: 'html5' } });
    expect(loadPlayerPrefs().kernel).toBe('html5');
    expect(screen.getByText('FFmpeg：后台兼容组件').closest('details')?.open).toBe(false);
  });

  it('detects and saves an external player when explicitly enabled', async () => {
    render(<PlaybackSettingsSection active />);
    const enabled = screen.getByRole('checkbox', { name: '启用点播外部播放器' }) as HTMLInputElement;
    await waitFor(() => expect(enabled.disabled).toBe(false));
    fireEvent.click(enabled);
    await waitFor(() => expect(enabled.checked).toBe(true));
    expect(client.playerPrefsSet).toHaveBeenCalledWith({ vodExternalPlayerEnabled: true, vodExternalPlayer: player.path });
    expect(loadPlayerPrefs().kernel).toBe('auto');
  });

  it('saves a detected player without enabling the external playback switch', async () => {
    render(<PlaybackSettingsSection active />);
    const detect = screen.getByRole('button', { name: '检测已安装的播放器' }) as HTMLButtonElement;
    await waitFor(() => expect(detect.disabled).toBe(false));
    fireEvent.click(detect);
    fireEvent.click(await screen.findByRole('button', { name: 'PotPlayer' }));
    await waitFor(() => expect(client.playerPrefsSet).toHaveBeenCalledWith({ vodExternalPlayer: player.path }));
    expect((screen.getByRole('checkbox', { name: '启用点播外部播放器' }) as HTMLInputElement).checked).toBe(false);
  });
});
