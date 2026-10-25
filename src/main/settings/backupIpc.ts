import { app, BrowserWindow, dialog } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import type { UiPreferencesService } from '../store/UiPreferencesService';
import { bossKey } from '../bossKey';
import { playerSettings } from '../player/playerSettings';
import { playerWindow } from '../player/PlayerWindow';
import { detailWindow } from '../player/DetailWindow';
import { searchWindow } from '../player/SearchWindow';
import { getProxySettings, setProxySettings } from '../net/proxy';
import { registerHandler } from '../util/ipcGuard';
import { fileLogger as log } from '../util/logger';
import { IPC } from '../../shared/ipc-channels';
import type { BackupFile, BackupExportResult, BackupImportResult, BackupSettingsState } from '../../shared/backup';
import { backupUiPreferences, buildBackupFile, parseBackupFile } from './backup';

/** Stage before replacing renderer data; commit belongs to the same live requesting window. */
export interface BackupIpcHostPort {
  settingsSnapshot(): Pick<BackupSettingsState, 'userConfig' | 'driveTokens' | 'subtitle' | 'metaSettings' | 'danmaku'>;
  restoreSettings(settings: Partial<BackupSettingsState>): void;
  resetSpidersForProxyChange(): void;
}

export function registerBackupIpc(host: BackupIpcHostPort, uiPreferences: UiPreferencesService): void {
  let pending: { id: string; owner: number; file: BackupFile; expiresAt: number } | null = null;
  const snapshot = (): BackupSettingsState => ({
    ...host.settingsSnapshot(), player: playerSettings.settings, proxy: getProxySettings(), bossKey: bossKey.settings,
  });
  const apply = (settings: BackupSettingsState) => {
    host.restoreSettings(settings);
    if (settings.player) playerSettings.settings = settings.player;
    if (settings.proxy) { setProxySettings(settings.proxy); host.resetSpidersForProxyChange(); }
    if (settings.bossKey) { bossKey.settings = settings.bossKey; bossKey.apply(); }
  };
  registerHandler(IPC.BACKUP_EXPORT, async (event: IpcMainInvokeEvent, renderer: Record<string, string>): Promise<BackupExportResult> => {
    const file = buildBackupFile(snapshot(), renderer || {}, { exportedAt: new Date().toISOString(), appVersion: app.getVersion() });
    const stamp = file.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
    const picked = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) ?? undefined!, {
      title: '导出设置备份', defaultPath: `win-box-backup-${stamp}.json`, filters: [{ name: 'Win-Box 备份', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return { saved: false, path: '' };
    writeFileSync(picked.filePath, JSON.stringify(file, null, 2), 'utf8');
    return { saved: true, path: picked.filePath };
  }, log);
  registerHandler(IPC.BACKUP_IMPORT, async (event: IpcMainInvokeEvent): Promise<BackupImportResult> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const auxiliaries = [playerWindow(), detailWindow(), searchWindow()].filter((window): window is BrowserWindow => !!window && !window.isDestroyed());
    if (!owner || auxiliaries.includes(owner)) throw new Error('请从主窗口导入设置备份');
    if (pending && pending.expiresAt > Date.now()) throw new Error('另一个备份恢复任务尚未完成');
    const picked = await dialog.showOpenDialog(owner, { title: '导入设置备份', properties: ['openFile'], filters: [{ name: 'Win-Box 备份', extensions: ['json'] }] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    const parsed = parseBackupFile(readFileSync(picked.filePaths[0], 'utf8'));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    backupUiPreferences(parsed.file.renderer); // Validate all settings before closing a window or replacing storage.
    const id = randomUUID();
    pending = { id, owner: event.sender.id, file: parsed.file, expiresAt: Date.now() + 5 * 60_000 };
    event.sender.once('destroyed', () => { if (pending?.id === id) pending = null; });
    for (const window of auxiliaries) window.destroy();
    return { ok: true, path: picked.filePaths[0], renderer: parsed.file.renderer, restoreId: id };
  }, log);
  registerHandler(IPC.BACKUP_CANCEL, (event: IpcMainInvokeEvent, id: string) => {
    if (pending?.id === id && pending.owner === event.sender.id) pending = null;
  }, log);
  registerHandler(IPC.BACKUP_COMMIT, (event: IpcMainInvokeEvent, id: string) => {
    if (!pending || pending.id !== id || pending.owner !== event.sender.id || pending.expiresAt <= Date.now()) throw new Error('备份恢复会话已失效，请重新选择文件');
    const file = pending.file;
    pending = null;
    const previous = snapshot();
    const previousUi = uiPreferences.get().values;
    try {
      apply(file.settings);
      uiPreferences.update(backupUiPreferences(file.renderer));
    } catch (error) {
      try { apply(previous); uiPreferences.update(previousUi); } catch (rollbackError) {
        log.e('备份恢复回滚失败', rollbackError);
        throw new Error('备份恢复失败，部分设置无法回滚；请保留原备份并检查磁盘权限', { cause: error });
      }
      throw error;
    }
  }, log);
}
