// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaybackSettingsSection } from '../src/renderer/features/settings/PlaybackSettingsSection';
import { client } from '../src/renderer/api/client';
import { DEFAULT_PLAYER_SETTINGS, type MediaRuntimeProgress, type PlayerSettings } from '../src/shared/player';
import { DEFAULT_PLAYER_PREFS, type PlayerPreferencesPort, type PlayerPrefs } from '../src/renderer/features/playback/application/playerPreferences';

vi.mock('../src/renderer/api/client', () => ({ client: { playerPrefsGet: vi.fn(), playerPrefsSet: vi.fn(), mpvStatus: vi.fn(), vodDetectPlayers: vi.fn(), btDetectPlayers: vi.fn(), mediaRuntimeStatus: vi.fn(async () => ({ mpv: { installed: false }, ffmpeg: { installed: false } })), mediaRuntimeInstall: vi.fn(), mediaRuntimeCancel: vi.fn(), mediaRuntimeOnProgress: vi.fn(() => () => {}) } }));
vi.mock('../src/renderer/features/settings/PlayerEngineSettings', () => ({ PlayerEngineSettings: ({ active }: { active: boolean }) => active ? <section id="cfg-plugin-engines">插件内核测试区</section> : null }));

const player = { id: 'potplayer', name: 'PotPlayer', path: 'C:\\Players\\PotPlayerMini64.exe' };
let localPlayerPrefs: PlayerPrefs = { ...DEFAULT_PLAYER_PREFS };
const playerPreferences: PlayerPreferencesPort = {
  load: () => ({ ...localPlayerPrefs }),
  save: patch => { localPlayerPrefs = { ...localPlayerPrefs, ...patch }; },
};
const engineSettings = {
  listEngines: async () => [],
  loadPlayerSettings: async () => ({ ...DEFAULT_PLAYER_SETTINGS }),
  setEngineEnabled: async () => ({ ok: true }),
  savePlayerSettings: async () => ({ ...DEFAULT_PLAYER_SETTINGS }),
};
const engineEvents = { notifyChanged: () => undefined };
const playerSettings = {
  loadSettings: () => client.playerPrefsGet(),
  saveSettings: (patch: Partial<PlayerSettings>) => client.playerPrefsSet(patch),
};
const externalPlayers = {
  detectTorrentPlayers: () => client.btDetectPlayers(),
  detectVodPlayers: () => client.vodDetectPlayers(),
};
const mpvSettings = { loadStatus: () => client.mpvStatus() };
const mediaRuntimes = {
  loadStatus: () => client.mediaRuntimeStatus(),
  install: (runtime: 'mpv' | 'ffmpeg') => client.mediaRuntimeInstall(runtime),
  cancelInstall: () => client.mediaRuntimeCancel(),
  onProgress: (listener: (progress: MediaRuntimeProgress) => void) => client.mediaRuntimeOnProgress(listener),
};

function renderPlaybackSettings(props: { active: boolean; requestedSection?: string }) {
  return render(<PlaybackSettingsSection {...props} preferences={playerPreferences} engineSettings={engineSettings} engineEvents={engineEvents} playerSettings={playerSettings} externalPlayers={externalPlayers} mpvSettings={mpvSettings} mediaRuntimes={mediaRuntimes} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  localPlayerPrefs = { ...DEFAULT_PLAYER_PREFS };
  let settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  vi.mocked(client.playerPrefsGet).mockImplementation(async () => settings);
  vi.mocked(client.playerPrefsSet).mockImplementation(async patch => { settings = { ...settings, ...patch }; return settings; });
  vi.mocked(client.mpvStatus).mockResolvedValue({ available: true, source: 'bundled', path: 'mpv.exe', note: '使用随包版本' });
  vi.mocked(client.vodDetectPlayers).mockResolvedValue([player]);
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('playback settings', () => {
  it('does not query playback components while the settings section is inactive', () => {
    renderPlaybackSettings({ active: false });
    expect(client.playerPrefsGet).not.toHaveBeenCalled();
    expect(client.mpvStatus).not.toHaveBeenCalled();
  });

  it('defaults to automatic playback and keeps manual component paths in advanced controls', async () => {
    renderPlaybackSettings({ active: true });
    const mode = screen.getByRole('combobox', { name: '应用内播放方式' }) as HTMLSelectElement;
    expect(mode.value).toBe('auto');
    await waitFor(() => expect(mode.disabled).toBe(false));
    fireEvent.change(mode, { target: { value: 'html5' } });
    expect(localPlayerPrefs.kernel).toBe('html5');
    expect(screen.getByText('高级：播放组件与磁力播放').closest('details')?.open).toBe(false);
  });

  it('disables the MPV mode when the injected status query reports it unavailable', async () => {
    vi.mocked(client.mpvStatus).mockResolvedValue({ available: false, path: '', source: 'none', note: '未检测到兼容内核' });
    renderPlaybackSettings({ active: true });

    const mpvOption = await screen.findByRole('option', { name: '兼容播放（暂不可用）' }) as HTMLOptionElement;
    expect(mpvOption.disabled).toBe(true);
    expect(screen.getByText('暂不可用：未检测到兼容内核')).toBeTruthy();
  });

  it('loads and keeps configured player paths when opening the advanced deep link', async () => {
    vi.mocked(client.playerPrefsGet).mockResolvedValue({
      ...DEFAULT_PLAYER_SETTINGS,
      mpvPath: 'D:\\Players\\mpv.exe',
      btExternalPlayer: 'D:\\Players\\PotPlayerMini64.exe',
    });
    renderPlaybackSettings({ active: true, requestedSection: 'mpv-kernel' });

    const advanced = screen.getByText('高级：播放组件与磁力播放').closest('details');
    expect(advanced?.open).toBe(true);
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: '兼容播放组件路径' }) as HTMLInputElement).value).toBe('D:\\Players\\mpv.exe');
      expect((screen.getByRole('textbox', { name: '磁力外部播放器路径' }) as HTMLInputElement).value).toBe('D:\\Players\\PotPlayerMini64.exe');
    });
  });

  it('reveals the plugin engine section for its deep link', () => {
    renderPlaybackSettings({ active: true, requestedSection: 'plugin-engines' });
    expect(screen.getByText('插件内核测试区')).toBeTruthy();
    expect(screen.getByText('高级：播放组件与磁力播放').closest('details')?.open).toBe(true);
  });

  it('keeps IPC-backed player controls disabled until preferences finish loading', async () => {
    let resolvePrefs!: (settings: PlayerSettings) => void;
    vi.mocked(client.playerPrefsGet).mockReturnValue(new Promise(resolve => { resolvePrefs = resolve; }));
    renderPlaybackSettings({ active: true, requestedSection: 'mpv-kernel' });

    const mode = screen.getByRole('combobox', { name: '应用内播放方式' }) as HTMLSelectElement;
    const mpvPath = screen.getByRole('textbox', { name: '兼容播放组件路径' }) as HTMLInputElement;
    const mpvSave = mpvPath.parentElement?.querySelector('button') as HTMLButtonElement;
    const btPath = screen.getByRole('textbox', { name: '磁力外部播放器路径' }) as HTMLInputElement;
    expect(mode.disabled).toBe(false);
    expect(mpvPath.disabled).toBe(true);
    expect(mpvSave.disabled).toBe(true);
    expect(btPath.disabled).toBe(true);

    resolvePrefs({ ...DEFAULT_PLAYER_SETTINGS, mpvPath: 'D:\\Players\\mpv.exe' });
    await waitFor(() => expect(mpvPath.disabled).toBe(false));
    expect(mpvPath.value).toBe('D:\\Players\\mpv.exe');
  });

  it('keeps the local playback mode selector available when IPC preferences fail to load', async () => {
    vi.mocked(client.playerPrefsGet).mockRejectedValue(new Error('IPC unavailable'));
    renderPlaybackSettings({ active: true });
    const mode = screen.getByRole('combobox', { name: '应用内播放方式' }) as HTMLSelectElement;
    expect(mode.disabled).toBe(false);
    fireEvent.change(mode, { target: { value: 'html5' } });
    expect(localPlayerPrefs.kernel).toBe('html5');
  });

  it('detects and saves an external player when explicitly enabled', async () => {
    renderPlaybackSettings({ active: true });
    const enabled = screen.getByRole('checkbox', { name: '启用点播外部播放器' }) as HTMLInputElement;
    await waitFor(() => expect(enabled.disabled).toBe(false));
    fireEvent.click(enabled);
    await waitFor(() => expect(enabled.checked).toBe(true));
    expect(client.playerPrefsSet).toHaveBeenCalledWith({ vodExternalPlayerEnabled: true, vodExternalPlayer: player.path });
    expect(localPlayerPrefs.kernel).toBe('auto');
  });

  it('saves a detected player without enabling the external playback switch', async () => {
    renderPlaybackSettings({ active: true });
    const detect = screen.getByRole('button', { name: '检测已安装的播放器' }) as HTMLButtonElement;
    await waitFor(() => expect(detect.disabled).toBe(false));
    fireEvent.click(detect);
    fireEvent.click(await screen.findByRole('button', { name: 'PotPlayer' }));
    await waitFor(() => expect(client.playerPrefsSet).toHaveBeenCalledWith({ vodExternalPlayer: player.path }));
    expect((screen.getByRole('checkbox', { name: '启用点播外部播放器' }) as HTMLInputElement).checked).toBe(false);
  });
});
