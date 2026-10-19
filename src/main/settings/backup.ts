// src/main/settings/backup.ts — 设置备份文件的组装与校验（纯函数，不依赖 electron/node）。
// 使用方：ipc/index.ts（负责弹保存/打开对话框、读写文件、把内容分发给各 store）。
import {
  BACKUP_APP,
  BACKUP_KIND,
  BACKUP_VERSION,
  type BackupFile,
  type BackupSettingsState,
} from '../../shared/backup';
import { DEFAULT_UI_PREFERENCES, UI_THEME_IDS, validateUiPreferencesPatch, type UiPreferencesPatch } from '../../shared/uiPreferences';

export function backupUiPreferences(renderer: Record<string, string>): UiPreferencesPatch {
  const theme = renderer['winbox-theme'];
  const motion = renderer['winbox-motion'];
  return validateUiPreferencesPatch({
    themeId: theme && (UI_THEME_IDS.includes(theme) || /^plugin:[a-z0-9-]{3,40}$/.test(theme)) ? theme : DEFAULT_UI_PREFERENCES.themeId,
    motion: motion === 'on' || motion === 'off' ? motion : 'auto',
    showDiscover: renderer['winbox-show-discover'] !== '0',
    waterfall: renderer['winbox-waterfall'] === '1',
    homeFilters: renderer['winbox-home-filters'] === '1',
    navMode: renderer['winbox-nav-mode'] === 'window' ? 'window' : 'inline',
  });
}

export interface BackupMeta {
  exportedAt: string;
  appVersion: string;
}

/** 只保留字符串值（localStorage 全量导出；非字符串一律丢弃） */
export function pickStrings(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

export function buildBackupFile(
  settings: BackupSettingsState,
  renderer: Record<string, string>,
  meta: BackupMeta,
): BackupFile {
  return {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    settings,
    renderer: pickStrings(renderer),
  };
}

export type BackupParseResult = { ok: true; file: BackupFile } | { ok: false; error: string };

/** 解析并校验备份文件（失败给中文原因，直接可上屏） */
export function parseBackupFile(text: string): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '备份内容不是 JSON 对象' };
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== BACKUP_KIND) {
    return { ok: false, error: '不是 Win-Box 设置备份文件（kind 不匹配）' };
  }
  const version = Number(o.version);
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: '备份版本号缺失或非法' };
  }
  if (version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本 ${version} 高于当前支持的 ${BACKUP_VERSION}，请升级软件后再导入` };
  }
  const settings = o.settings as BackupSettingsState | undefined;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !settings.userConfig || typeof settings.userConfig !== 'object' || Array.isArray(settings.userConfig)) {
    return { ok: false, error: '备份里缺少设置内容（settings.userConfig）' };
  }
  for (const field of ['driveTokens', 'subtitle', 'metaSettings', 'danmaku', 'player', 'proxy', 'bossKey'] as const) {
    const value = settings[field];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) return { ok: false, error: `备份设置 ${field} 格式无效` };
  }
  return {
    ok: true,
    file: {
      app: BACKUP_APP,
      kind: BACKUP_KIND,
      version,
      exportedAt: String(o.exportedAt || ''),
      appVersion: String(o.appVersion || ''),
      settings,
      renderer: pickStrings(o.renderer),
    },
  };
}
