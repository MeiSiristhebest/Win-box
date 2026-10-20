import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { SpiderHost } from '../src/main/spider/SpiderHost';
import type { UiPreferencesService } from '../src/main/store/UiPreferencesService';
import type { BackupImportResult, BackupSettingsState } from '../src/shared/backup';
import { DEFAULT_UI_PREFERENCES } from '../src/shared/uiPreferences';
import { DEFAULT_PLAYER_SETTINGS } from '../src/shared/player';
import { DEFAULT_SUBTITLE_SETTINGS } from '../src/shared/subtitle';
import { DEFAULT_DANMAKU_SETTINGS } from '../src/shared/danmaku';
import { emptyUserConfig } from '../src/main/store/UserConfigManager';
import { buildBackupFile } from '../src/main/settings/backup';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (...args: unknown[]) => unknown;
const fixtures = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  owner: { destroy: vi.fn() }, auxiliary: { isDestroyed: () => false, destroy: vi.fn() },
  pick: vi.fn(), setProxy: vi.fn(), player: { settings: {} }, boss: { settings: {}, apply: vi.fn() },
}));
vi.mock('electron', () => ({ app: { getVersion: () => '1.22.0' }, BrowserWindow: { fromWebContents: () => fixtures.owner }, dialog: { showOpenDialog: fixtures.pick, showSaveDialog: vi.fn() } }));
vi.mock('../src/main/util/ipcGuard', () => ({ registerHandler: (name: string, handler: Handler) => fixtures.handlers.set(name, handler) }));
vi.mock('../src/main/util/logger', () => ({ fileLogger: { i: vi.fn(), w: vi.fn(), e: vi.fn() } }));
vi.mock('../src/main/player/playerSettings', () => ({ playerSettings: fixtures.player }));
vi.mock('../src/main/bossKey', () => ({ bossKey: fixtures.boss }));
vi.mock('../src/main/net/proxy', () => ({ getProxySettings: () => ({ enabled: false, url: '' }), setProxySettings: fixtures.setProxy }));
vi.mock('../src/main/player/PlayerWindow', () => ({ playerWindow: () => fixtures.auxiliary }));
vi.mock('../src/main/player/DetailWindow', () => ({ detailWindow: () => null }));
vi.mock('../src/main/player/SearchWindow', () => ({ searchWindow: () => null }));
import { registerBackupIpc } from '../src/main/settings/backupIpc';

let directory = '';
let path = '';
let settings: BackupSettingsState;
let sender: EventEmitter & { id: number };
let event: IpcMainInvokeEvent;
let restore: ReturnType<typeof vi.fn>;
let preferences: { get(): { values: typeof DEFAULT_UI_PREFERENCES }; update: ReturnType<typeof vi.fn> };
const invoke = async (channel: string, ...args: unknown[]) => fixtures.handlers.get(channel)!(event, ...args);

beforeEach(() => {
  vi.clearAllMocks(); fixtures.handlers.clear();
  directory = mkdtempSync(join(tmpdir(), 'winbox-backup-ipc-')); path = join(directory, 'backup.json');
  settings = { userConfig: emptyUserConfig(), driveTokens: {}, subtitle: DEFAULT_SUBTITLE_SETTINGS, danmaku: DEFAULT_DANMAKU_SETTINGS, player: DEFAULT_PLAYER_SETTINGS, proxy: { enabled: false, url: '' }, bossKey: { enabled: false, accel: '' }, metaSettings: { tmdbApiKey: '', tmdbApiBase: '', tmdbImageBase: '', metaSource: 'auto' } };
  writeFileSync(path, JSON.stringify(buildBackupFile(settings, { 'winbox-theme': 'apple' }, { appVersion: '1.22.0', exportedAt: new Date().toISOString() })));
  fixtures.pick.mockResolvedValue({ canceled: false, filePaths: [path] });
  fixtures.player.settings = DEFAULT_PLAYER_SETTINGS;
  fixtures.boss.settings = settings.bossKey;
  sender = Object.assign(new EventEmitter(), { id: 1 });
  event = { sender } as unknown as IpcMainInvokeEvent;
  restore = vi.fn();
  preferences = { get: () => ({ values: DEFAULT_UI_PREFERENCES }), update: vi.fn() };
  const host = { settingsSnapshot: () => structuredClone(settings), restoreSettings: restore, resetSpidersForProxyChange: vi.fn() };
  registerBackupIpc(host as unknown as SpiderHost, preferences as unknown as UiPreferencesService);
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });

describe('staged backup import', () => {
  it('validates and closes auxiliary windows before staging, then commits only for its owner', async () => {
    const result = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    expect(result.ok).toBe(true);
    expect(result.renderer).toEqual({ 'winbox-theme': 'apple' });
    expect(result.restoreId).toBeTruthy();
    expect(fixtures.auxiliary.destroy).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();
    const originalEvent = event;
    event = { sender: { id: 2 } } as unknown as IpcMainInvokeEvent;
    await expect(invoke(IPC.BACKUP_COMMIT, result.restoreId)).rejects.toThrow('失效');
    event = originalEvent;
    await invoke(IPC.BACKUP_COMMIT, result.restoreId);
    expect(restore).toHaveBeenCalledWith(settings);
    expect(preferences.update).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'light' }));
    await expect(invoke(IPC.BACKUP_COMMIT, result.restoreId)).rejects.toThrow('失效');
  });

  it('does not change settings or close windows for invalid backup content', async () => {
    writeFileSync(path, JSON.stringify({ kind: 'win-box-backup', version: 1, settings: { userConfig: [], proxy: [] } }));
    const result = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    expect(result.ok).toBe(false);
    expect(fixtures.auxiliary.destroy).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('rolls main settings back if a later setting fails', async () => {
    const result = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    fixtures.setProxy.mockImplementationOnce(() => { throw new Error('write failed'); });
    await expect(invoke(IPC.BACKUP_COMMIT, result.restoreId)).rejects.toThrow('write failed');
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore.mock.calls[1][0]).toEqual(settings);
  });

  it('invalidates sessions on cancellation, expiry and owner destruction', async () => {
    const canceled = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    await invoke(IPC.BACKUP_CANCEL, canceled.restoreId);
    await expect(invoke(IPC.BACKUP_COMMIT, canceled.restoreId)).rejects.toThrow('失效');
    const destroyed = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    sender.emit('destroyed');
    await expect(invoke(IPC.BACKUP_COMMIT, destroyed.restoreId)).rejects.toThrow('失效');
    vi.useFakeTimers();
    const expired = await invoke(IPC.BACKUP_IMPORT) as BackupImportResult;
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(invoke(IPC.BACKUP_COMMIT, expired.restoreId)).rejects.toThrow('失效');
    expect(restore).not.toHaveBeenCalled();
  });
});
