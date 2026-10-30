// src/main/ipc/index.ts — 主进程 IPC 组合根
import { app, BrowserWindow, clipboard, dialog } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHandler } from '../util/ipcGuard';
import { fileLogger } from '../util/logger';
import { setUiScalePref, uiScaleState } from '../ui/uiScale';
import { resourcesDir, userDataDir, spiderCacheDir } from '../util/paths';
import type { UiPreferencesService } from '../store/UiPreferencesService';
import {
  openWebHomeWindow,
  webHomeReq,
  webHomeCookie,
  webHomePlay,
  type FmReqPayload,
  type WebHomeOpenInit,
} from '../webbridge/WebHomeWindow';
import { clearAppCache } from '../util/cacheClean';
import { nameFromLocalFile } from '../util/importNaming';
import { join, basename } from 'node:path';
import { IPC } from '../../shared/ipc-channels';
import { dataDirReport } from '../util/dataDirBootstrap';
import { proxySettingsView, setProxySettings, type ProxySettings } from '../net/proxy';
import { registerBackupIpc } from '../settings/backupIpc';
import type { SettingsBackupService } from '../settings/SettingsBackupService';
import { registerPlayerRuntimeIpc } from './playerRuntime';
import { registerPluginManagementIpc } from './pluginManagement';
import { registerExternalPlaybackIpc } from './externalPlayback';
import { registerMetadataIpc } from './metadataIpc';
import type { MetadataIpcPort } from './metadataIpc';
import { registerDriveIpc } from './driveIpc';
import { registerSubtitleIpc } from './subtitleIpc';
import type { SubtitleIpcPort } from './subtitleIpc';
import { registerDanmakuIpc } from './danmakuIpc';
import type { DanmakuIpcPort } from './danmakuIpc';
import {
  registerLiveChannelConfigurationIpc,
  registerProfileIpc,
  registerSourceConfigurationIpc,
  registerSubscriptionImportIpc,
} from './configurationIpc';
import { registerPlayerWindowIpc } from './playerWindowIpc';
import { registerVodIpc } from './vodIpc';
import { registerLiveIpc } from './liveIpc';
import type { MainIpcApplicationPorts } from './MainIpcApplicationPorts';
import { registerLocalImportIpc } from './localImportIpc';
import type { DavServer } from '../../shared/webdav';
import type { DavService } from '../webdav/DavService';
import type { DlnaCastTarget, DlnaDevice } from '../../shared/dlna';
import type { DlnaService } from '../dlna/DlnaService';
import type { UpdateProgress } from '../../shared/update';
import type { UpdateService } from '../update/UpdateService';
// 独立播放器窗口
import { openPlayerWindow, playerSwitchEpisode, isPlayerOpen, closePlayerWindow, playerSetMini, playerIsMini, playerWindow, playerResendInit, isPlayerWindow, playerSetFullscreen, playerIsFullscreen, playerSetResizable } from '../player/PlayerWindow';
// ★ 2026-10-08 MPV 高兼容播放内核（独立播放器窗口内嵌 --wid）
import { MpvController } from '../player/MpvController';
// ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`；宿主托管，插件只给描述符）
import type { PlayerEngineController } from '../player/PlayerEngineController';
// ★ 2026-10-16 插件系统（M1）：宿主聚合（登记/安装/启停/超分着色器解析）
import type { PluginHost } from '../plugin/PluginHost';
// ★ 2026-10-08 详情页独立窗口（外观开关控制；见 renderer/lib/detailWin.ts）
import { openDetailWindow, detailWindowReady } from '../player/DetailWindow';
import { openSearchWindow, searchWindowReady } from '../player/SearchWindow';
// 老板键
import { bossKey, BOSS_DEFAULT_ACCEL } from '../bossKey';
import { playerSettings } from '../player/playerSettings';
import { MediaRuntimeProvisioner } from '../player/MediaRuntimeProvisioner';
import { detectPlayers, launchPlayer, resolvePlayer, seekArgs } from '../torrent/externalPlayer';
import { ExternalPlayback } from '../torrent/ExternalPlayback';
import { normalizePlayerExecutablePath } from '../../shared/player';
import type { IpcMainInvokeEvent } from 'electron';
import type { BossKeySettings, ImportReport, MultiConfigEntry, SiteConfig } from '../../shared/types';
import type { PlayerSettings } from '../../shared/player';

function winOf(e: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

interface IpcFeaturePorts {
  subtitles: SubtitleIpcPort;
  danmaku: DanmakuIpcPort;
  metadata: MetadataIpcPort;
}

/** ★ 本次主进程启动的会话标识（模块求值 = 应用启动一次；重启必变） */
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function registerIpc(
  services: MainIpcApplicationPorts,
  dav: DavService,
  dlna: DlnaService,
  updater: UpdateService,
  uiPreferences: UiPreferencesService,
  plugins: PluginHost,
  engines: PlayerEngineController,
  features: IpcFeaturePorts,
  backup: Pick<SettingsBackupService, 'snapshot' | 'restore'>,
): void {
  const log = fileLogger;
  /** ★ 2026-10-08 MPV 播放内核（单会话；播放器窗口关闭/退出应用会 dispose） */
  const mpv = new MpvController(fileLogger);
  const mediaRuntimes = new MediaRuntimeProvisioner(fileLogger, event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.MEDIA_RUNTIME_PROGRESS, event);
    }
  });
  const externalPlayback = new ExternalPlayback({
    settings: playerSettings,
    players: { detectPlayers, launchPlayer, resolvePlayer, seekArgs, normalizeExecutablePath: normalizePlayerExecutablePath },
    logger: log,
  });
  /**
   * ★ 2026-10-17（B3「冻结/解冻」）：播放器窗口开/关 → 广播给**其余窗口**。
   *   主窗口据此把隐藏页里已解码的图片位图释放掉（只清 `img.src`、React 树与数据原地保留，零重载）；
   *   实测这部分埋在 GPU 进程里 ≈130~200MB（见 docs/design/内存优化_专项立项.md §2.9）。
   */
  const notifyPlayerWindowState = (open: boolean): void => {
    const pwin = playerWindow();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === pwin || w.isDestroyed()) continue;
      try { w.webContents.send(IPC.PLAYER_WINDOW_STATE, { open }); } catch { /* 窗口已关：忽略 */ }
    }
  };

  // 自定义无边框窗口控制
  registerHandler(IPC.WIN_MINIMIZE, (e: IpcMainInvokeEvent) => winOf(e)?.minimize(), log);
  registerHandler(IPC.WIN_MAXIMIZE, (e: IpcMainInvokeEvent) => {
    const w = winOf(e);
    if (!w) return;
    // Transparent player windows can report false from isFullScreen() on Windows;
    // use the event-backed player state so a maximize click always exits player fullscreen.
    if (isPlayerWindow(w) && playerIsFullscreen()) { void playerSetFullscreen(false); return; }
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  }, log);
  registerHandler(IPC.WIN_CLOSE, (e: IpcMainInvokeEvent) => winOf(e)?.close(), log);
  registerHandler(IPC.WIN_IS_MAXIMIZED, (e: IpcMainInvokeEvent) => !!winOf(e)?.isMaximized(), log);
  /**
   * ★ 2026-09-30（用户要求）：播放器「置顶」按钮 —— 把**发起窗口**设为始终置顶。
   *   level 用 'floating'（HWND_TOPMOST 语义：压过所有普通窗口，但不与任务栏/系统 UI 抢层级）。
   *   ★ 必须走 registerHandler（IpcResult 信封）—— 渲染层 client 的 unwrap 只认 {ok,data}。
   */
  registerHandler(IPC.WIN_SET_ALWAYS_ON_TOP, (e: IpcMainInvokeEvent, on: unknown) => {
    const w = winOf(e);
    if (!w) return false;
    const flag = !!on;
    try {
      w.setAlwaysOnTop(flag, 'floating');
    } catch {
      w.setAlwaysOnTop(flag);
    }
    return w.isAlwaysOnTop();
  }, log);
  registerHandler(IPC.WIN_IS_ALWAYS_ON_TOP, (e: IpcMainInvokeEvent) => !!winOf(e)?.isAlwaysOnTop(), log);

  registerHandler(IPC.SYSTEM_PING, () => 'pong', log);
  /**
   * ★ 2026-09-30（用户要求「软件关闭后，所有的墓碑机制都应该脱钩」）：
   *   本次**主进程启动**的唯一会话标识（每次启动必变）——渲染层用它判定「新一次启动」，
   *   决定是否丢弃页面状态类记忆（搜索态/浏览态/详情态）。见 renderer/lib/uiMemory.ts。
   */
  registerHandler(IPC.SYSTEM_SESSION_ID, () => SESSION_ID, log);
  registerHandler(IPC.UI_PREFERENCES_GET, () => uiPreferences.get(), log);
  registerHandler(IPC.UI_PREFERENCES_INITIALIZE, (_e: unknown, legacy: unknown) => uiPreferences.initialize(legacy), log);
  registerHandler(IPC.UI_PREFERENCES_UPDATE, (_e: unknown, patch: unknown) => uiPreferences.update(patch), log);
  // 退出整个应用（免责声明「拒绝」等场景）
  registerHandler(IPC.APP_QUIT, () => {
    app.quit();
    return { ok: true };
  }, log);
  // 应用图标 dataURL（标题栏/窗口内展示与进程图标一致）
  registerHandler(IPC.APP_ICON, () => {
    const p = join(resourcesDir(), 'ui', 'icon32.png');
    if (!existsSync(p)) return '';
    return 'data:image/png;base64,' + readFileSync(p).toString('base64');
  }, log);
  // ★ 2026-09-30（用户要求）：数据目录信息（安装目录/data；老用户迁移结果 / 回退原因）——配置页展示 + 排障
  registerHandler(IPC.SYSTEM_DATA_DIR, () => ({
    path: userDataDir(),
    mode: dataDirReport.mode,
    planned: dataDirReport.planned,
    reason: dataDirReport.reason,
    migration: dataDirReport.migration,
  }), log);

  registerSourceConfigurationIpc(services.sourceConfiguration, services.sourceReads, log, services.configRuntimeSync);
  registerSubscriptionImportIpc(services.subscriptionImports, services.subscriptionGroups, log);
  registerProfileIpc(services.profileConfiguration, log);
  registerLiveChannelConfigurationIpc(services.liveChannelConfiguration, log);
  registerLocalImportIpc({
    application: services.localImports,
    dialog: { showOpenDialog: (owner, options) => dialog.showOpenDialog(owner ?? undefined!, options) },
    windowForEvent: event => winOf(event),
  }, log);
  // 清理缓存：只删可重建的纯缓存（Chromium 缓存 / jar 转换缓存），绝不动配置/历史/绑定
  //   ★ 2026-09-24：清完立刻在后台重建蜘蛛运行时（重新转换 jar + 重启热进程），
  //     否则用户下一次进源要在请求里现付 30~40s 的「下载 + dex2jar」并被超时打断。
  registerHandler(IPC.CACHE_CLEAR, async () => {
    const r = clearAppCache(userDataDir(), spiderCacheDir());
    try { services.spiderRuntime.rewarmAfterCacheClear(); } catch { /* 预热失败不影响清理结果 */ }
    return r;
  }, log);
  registerHandler(IPC.VOD_DEBUG, (_e: any, key: string) => services.sourceDiagnostics.debug(key), log);
  registerHandler(IPC.VOD_AUDIT, (_event: unknown, expectedProfileId?: string) => services.sourceDiagnostics.auditAll(expectedProfileId), log);
  registerDriveIpc(services.driveAccounts, log);
  registerSubtitleIpc(features.subtitles, log);
  registerDanmakuIpc(features.danmaku, log);
  registerMetadataIpc(features.metadata, log);
  registerHandler(IPC.CFG_MERGE_EXPORT, (_e: any, ids: string[]) => services.profileConfiguration.exportMergedProfiles(ids), log);
  registerHandler(IPC.CFG_EXPORT_SAVE, async (_e: any, a: { content: string; defaultName?: string }) => {
    const w = winOf(_e as IpcMainInvokeEvent);
    const r = await dialog.showSaveDialog(w ?? undefined!, {
      title: '另存为',
      defaultPath: a.defaultName || 'merged-subscription.json',
      filters: [{ name: 'JSON 配置', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { saved: false, path: '' };
    writeFileSync(r.filePath, a.content, 'utf-8'); // 只写新文件，绝不改动任何原始文件
    return { saved: true, path: r.filePath };
  }, log);
  registerBackupIpc({
    settingsSnapshot: () => backup.snapshot(),
    restoreSettings: (settings) => backup.restore(settings),
    resetSpidersForProxyChange: () => services.spiderRuntime.clearSpiderInstances(),
  }, uiPreferences);
  // ★ 播放网盘资源未绑定 cookie → 从任意窗口请求主窗口跳到「点播页」
  //   （网盘绑定入口已统一到源内：点播页 → 该源 → 「网盘绑定」按钮；配置页不再放网盘配置）
  registerHandler(IPC.UI_GOTO_DRIVE_BIND, () => {
    const pwin = playerWindow();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w === pwin || w.isDestroyed()) continue;
      try {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
        w.webContents.send(IPC.NAV_DRIVE_BIND);
      } catch { /* ignore */ }
      break;
    }
    return true;
  }, log);
  /**
   * ★ 2026-09-27（用户要求）：导入**本地 .json 订阅文件**（替代原「粘贴 JSON 文本」入口）。
   *   档案名：自填名优先，否则**取原始文件名**（去扩展名）——不再一律「新订阅 xx」。
   */
  registerHandler(IPC.CFG_IMPORT_JSON_LOCAL, async (e: any, customName?: string): Promise<{
    ok: boolean; file?: string; name?: string; error?: string;
    result?: { config: SiteConfig; report: ImportReport; warnings: string[]; urls?: MultiConfigEntry[] };
  }> => {
    const win = winOf(e);
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON 订阅文件', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: false }; // 用户取消，不视为错误
    const filePath = picked.filePaths[0];
    try {
      const text = readFileSync(filePath, 'utf-8');
      if (!text.trim()) return { ok: false, error: '所选 .json 文件为空' };
      const name = nameFromLocalFile(filePath, customName);
    const r = await services.subscriptionImports.importConfig({ json: text, name });
      return {
        ok: true,
        file: basename(filePath),
        name,
        result: { config: r.config, report: r.report, warnings: r.warnings, urls: r.urls },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, log);

  // 本地 .py：复制到安装目录 imports/py 后入库，不依赖原始文件。
  //   ★ 2026-09-27（用户要求）：源名/源 key 用**原始文件名**（去扩展名）——与本地 .json 同一命名口径
  //   ★ 2026-10-16（用户要求）：文件选择器支持**按住 Ctrl 多选**——所选 .py 一并导入；
  //     逐个文件独立成败（单个失败只丢弃该文件副本、不影响其余），最后汇总回执。
  registerHandler(IPC.WEBHOME_OPEN, (_e: any, init: WebHomeOpenInit) => openWebHomeWindow(init || { url: '' }), log);
  // 以下三条是**网页窗口 preload → 主进程**的桥（渲染层不直接调用；见 WebHomeWindow / webhomePreload.ts）
  registerHandler(IPC.WEBHOME_FM_REQ, (_e: any, payload: FmReqPayload) => webHomeReq(payload || { url: '' }), log);
  registerHandler(IPC.WEBHOME_FM_PLAY, (_e: any, payload: { url?: string; title?: unknown }) => webHomePlay(payload || {}), log);
  registerHandler(IPC.WEBHOME_FM_COOKIE, (_e: any, domain: string) => webHomeCookie(domain), log);

  registerVodIpc(services.vod, {
    windowForEvent: (event) => winOf(event),
    writeClipboard: (text) => clipboard.writeText(text),
  }, log);

  registerPlayerWindowIpc({
    open: openPlayerWindow,
    switchEpisode: playerSwitchEpisode,
    isOpen: isPlayerOpen,
    resendInit: playerResendInit,
    setMini: playerSetMini,
    isMini: playerIsMini,
    setFullscreen: playerSetFullscreen,
    isFullscreen: playerIsFullscreen,
    setResizable: playerSetResizable,
    close: closePlayerWindow,
  }, log, notifyPlayerWindowState);

  // ---- 详情/搜索独立窗口（已开则复用：聚焦 + 通知其换路由）----
  registerHandler(IPC.WIN_OPEN_DETAIL, (_e: any, a: { key?: string; id?: string; query?: string }) =>
    openDetailWindow(a || {}, uiPreferences.get().values.themeId), log);
  registerHandler(IPC.WIN_OPEN_SEARCH, (_e: any, value: string | { term: string; profileId?: string; allProfiles?: boolean }) => openSearchWindow(value, uiPreferences.get().values.themeId), log);
  registerHandler(IPC.WIN_ROUTE_READY, (e: any) => {
    searchWindowReady(e.sender.id);
    detailWindowReady(e.sender.id);
    return { ok: true };
  }, log);
  registerHandler(IPC.WIN_REPORT_ERROR, (e: any, message: string) => {
    // 报告只保留异常/组件栈，移除 URL（源地址可能含凭据）。
    log.w(`renderer-error wc=${e.sender.id}: ${String(message).replace(/https?:\/\/\S+/gi, '[url]').slice(0, 3000)}`);
    return { ok: true };
  }, log);

  registerPlayerRuntimeIpc({
    logger: log,
    mpv,
    mediaRuntimes,
    plugins,
    settings: playerSettings,
    engines,
    onPlaybackStarted: () => services.spiderRuntime.onPlaybackStarted(),
    notifyPlayerWindowState,
  });

  // ---- 老板键（全局快捷键隐藏/恢复窗口）----
  registerHandler(IPC.BOSS_GET, () => bossKey.settings, log);
  registerHandler(IPC.BOSS_SET, (_e: any, patch: Partial<BossKeySettings>) => {
    const cur = bossKey.settings;
    bossKey.settings = {
      enabled: patch?.enabled ?? cur.enabled,
      accel: (patch?.accel ?? cur.accel).trim() || BOSS_DEFAULT_ACCEL,
    };
    const registered = bossKey.apply();
    return { settings: bossKey.settings, registered: registered || !bossKey.settings.enabled };
  }, log);
  // ---- 夸克落盘文件清理（渲染层播放页/播放器页卸载时触发；删除异步执行，失败会持久化重试）----
  registerHandler(IPC.QUARK_CLEANUP, () => {
      void services.driveFileCleanup.deletePending().catch(() => undefined);
    return true;
  }, log);

  // ---- ★ 网络代理（DNS 污染 / TLS SNI 阻断站点用；改后即时生效，无需重启）----
  registerHandler(IPC.PROXY_GET, () => proxySettingsView(), log);
  registerHandler(IPC.PROXY_SET, (_e: any, patch: Partial<ProxySettings>) => {
    const next = setProxySettings(patch || {});
    // 代理变了 → 常驻蜘蛛进程的参数已变（池 key 含代理参数）→ 清一次实例缓存，下一轮按新参数拉起
    services.spiderRuntime.clearSpiderInstances();
    return next;
  }, log);

  // ---- ★ 播放偏好（m3u8 去广告开关；本地中继 /play 每轮读一次 → 改后即时生效）----
  registerHandler(IPC.PLAYER_PREFS_GET, () => playerSettings.settings, log);
  registerHandler(IPC.PLAYER_PREFS_SET, (_e: any, patch: Partial<PlayerSettings>) => playerSettings.update(patch || {}), log);
  registerPluginManagementIpc({ logger: log, plugins, settings: playerSettings });
  registerExternalPlaybackIpc({ logger: log, playback: externalPlayback });

  // ★ 2026-09-29 WebDAV 存储（只读）：服务器管理 + 目录浏览；取流走 `/play?dav=<id>`（中继注入 Authorization）
  registerHandler(IPC.DAV_LIST, () => dav.list(), log);
  registerHandler(IPC.DAV_SET, (_e: any, s: DavServer) => dav.set(s || ({} as DavServer)), log);
  registerHandler(IPC.DAV_TEST, (_e: any, s: DavServer) => dav.test(s || ({} as DavServer)), log);
  registerHandler(IPC.DAV_REMOVE, (_e: any, id: string) => {
    dav.remove(String(id || ''));
  }, log);
  registerHandler(
    IPC.DAV_BROWSE,
    (_e: any, a: { id: string; path?: string }) => dav.browse(String(a?.id || ''), a?.path || '/'),
    log,
  );
  // ★ 2026-09-29 DLNA 投屏：SSDP 发现局域网 MediaRenderer + AVTransport 三动作投屏
  registerHandler(IPC.DLNA_DISCOVER, () => dlna.discover(), log);
  registerHandler(IPC.DLNA_CAST, (_e: any, a: { device: DlnaDevice; target: DlnaCastTarget }) =>
    dlna.cast(a?.device, a?.target || ({ url: '', name: '', positionMs: 0 } as DlnaCastTarget)), log);

  // ★ 2026-09-29 启动更新：检查（失败不影响使用）→ 用户确认后代理加速下载 Setup（进度推送）→ 拉起安装程序
  registerHandler(IPC.UPDATE_CHECK, () => updater.check(), log);
  // ★ 2026-10-16（用户要求）：界面缩放：读取当前窗口状态，更新所有应用窗口的文字与控件缩放
  registerHandler(IPC.UI_GET_SCALE, (event: Electron.IpcMainInvokeEvent) => uiScaleState(BrowserWindow.fromWebContents(event.sender)), log);
  registerHandler(IPC.UI_SET_SCALE, (_e: unknown, v: unknown) => setUiScalePref(v), log);
  registerHandler(IPC.UPDATE_DOWNLOAD, async () => {
    const push = (p: UpdateProgress): void => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.UPDATE_PROGRESS, p);
      }
    };
    return updater.download(push);
  }, log);
  registerHandler(IPC.UPDATE_CANCEL, () => updater.cancel(), log);
  app.on('before-quit', () => updater.cancel());
  registerHandler(IPC.UPDATE_INSTALL, async () => {
    const path = updater.downloadedPath();
    if (!path) throw new Error('安装包不存在，请重新下载');
    const r = await updater.launch(path);
    if (!r.ok) throw new Error(r.error || '无法启动安装程序');
    // 拉起安装程序后退出本程序，避免占用安装目录文件（NSIS 才能覆盖安装）
    setTimeout(() => app.quit(), 1500);
    return { ok: true, path };
  }, log);

  registerLiveIpc(services.livePlayback, {
    chooseExportPath: async (event, request) => {
      const owner = winOf(event as IpcMainInvokeEvent);
      const result = await dialog.showSaveDialog(owner ?? undefined!, {
        title: request.title,
        defaultPath: request.defaultName,
        filters: [{ name: '直播源', extensions: [request.extension] }],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    writeExportFile: (path, content) => writeFileSync(path, content, 'utf-8'),
  }, log);
}
