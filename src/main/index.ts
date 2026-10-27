// src/main/index.ts — Electron 主进程入口
// ★★ 第一条 import（import 即执行，勿挪位置）：把数据目录切到**安装目录/data**，
//   并在老用户首次启动时自动迁移 %APPDATA%\win-box（见 dataDirBootstrap.ts 头注释）。
//   必须早于 logger / 各 Store 的模块求值，否则它们会把路径解析到旧位置。
import { dataDirReport } from './util/dataDirBootstrap';
import { registerAppQuitCleanup } from './util/appQuit';
import { createConnection } from 'node:net';
import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, Notification, shell, webContents } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerIpc } from './ipc';
import type { MainIpcApplicationPorts } from './ipc/MainIpcApplicationPorts';
import { createSpiderHostServices } from './spider/createSpiderHostServices';
import { createDefaultSpiderHostInfrastructure } from './spider/createDefaultSpiderHostInfrastructure';
import { LocalProxyServer } from './server/LocalProxyServer';
import { fileLogger } from './util/logger';
// ★ 2026-10-16（用户报「播放时画面突然消失、只剩声音」）：播放诊断上报的收集器（见下方 child-process-gone）
import { lastMediaSummary, lastMediaWcId } from './util/mediaDiag';
import { applyUiScale, registerUiWindow, scaledWindowFor, setMainWindowProvider } from './ui/uiScale';
import { BASE_WINDOW } from '../shared/uiScale';
import { applyWindowCorner } from './util/windowCorner';
import { bossKey } from './bossKey';
import { playerWindow, onPlayerWindowClosed, openPlayerWindow } from './player/PlayerWindow';
import { playerSettings } from './player/playerSettings';
import { hostRegexFor } from '../engine/util/m3u8Purify';
import { TorrentPlay } from './torrent/torrentPlay';
import { DavService } from './webdav/DavService';
import { DlnaService } from './dlna/DlnaService';
import { UpdateService } from './update/UpdateService';
import { DavStore } from './store/DavStore';
import { JsonStore } from './store/JsonStore';
import { LocalPkgStore } from './store/LocalPkgStore';
import { createConfigurationApplicationServices } from './configuration/createConfigurationApplicationServices';
import { LocalImportApplicationService } from './configuration/LocalImportApplicationService';
import { LocalLiveFileImporter } from './live/LocalLiveFileImporter';
import { createSubscriptionAssembly } from './subscriptions/createSubscriptionAssembly';
import { createSubtitleServiceAssembly } from './subtitle/createSubtitleServiceAssembly';
import { createDanmakuServiceAssembly } from './danmaku/createDanmakuServiceAssembly';
import { createMetadataService } from './meta/createMetadataService';
import { SettingsBackupService } from './settings/SettingsBackupService';
import { UiPreferencesService } from './store/UiPreferencesService';
import { applyWindowSurfacePolicy, windowSurfaceColor } from './preferences/WindowSurfacePolicy';
import { colorSchemeFor } from '../shared/ui/themeTokens';
import { PluginHost } from './plugin/PluginHost';
import { PluginDialogService } from './plugin/PluginDialogService';
import type { PluginDialogReply } from '../shared/pluginDialog';
import { PlayerEngineController } from './player/PlayerEngineController';
import { PluginKv } from './plugin/PluginKv';
import { createPluginSandboxApi } from './plugin/pluginHostApi';
import { HttpClient } from './net/HttpClient';
import { LOCAL_PROXY_BASE } from '../shared/constants';
import { pkgSubUrl } from '../engine/config/localPkg';
import { parseLive } from '../engine/config/LiveConfigParser';
import { localLiveUrl } from '../engine/live/localLive';
import { IPC } from '../shared/ipc-channels';
import { builtinPluginsDir, cacheDir, distDir, legacyLocalImportsDir, localImportsDir, pluginsDir, userDataDir } from './util/paths';
import { safeStorageDriveCodec } from './util/driveCodec';
import { clearWinboxCache, type ClearCacheResult } from './util/cacheClean';
import {
  isFirstLaunchAfterUpdate,
  lastRunVersionPath,
  readLastRunVersion,
  writeLastRunVersion,
} from './util/updateCacheReset';

// esbuild 打成 CJS：__dirname 由 Node 提供（= dist/）。资源在 dist/../../resources。
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
const pluginDialogs = new PluginDialogService(() => mainWindow?.webContents ?? null);
ipcMain.on(IPC.PLUGIN_DIALOG_READY, event => pluginDialogs.markReady(event.sender.id));
ipcMain.on(IPC.PLUGIN_DIALOG_REPLY, (event, reply: PluginDialogReply) => pluginDialogs.reply(event.sender.id, reply));
app.on('will-quit', () => pluginDialogs.dispose());
const localPkgs = new LocalPkgStore(
  new JsonStore(join(userDataDir(), 'local-pkgs.json')),
  LOCAL_PROXY_BASE,
  localImportsDir(),
  legacyLocalImportsDir(),
);
const hostInfrastructure = createDefaultSpiderHostInfrastructure();
const configurationServices = createConfigurationApplicationServices({
  persistence: hostInfrastructure.userConfigPersistence,
  logger: hostInfrastructure.logger,
  localPackages: localPkgs,
});
/**
 * ★ 2026-09-29：磁力（BT）引擎（用户选定方案 B）—— aria2c sidecar + 本机中继 `/bt` + 外部播放器接力。
 * 懒启动（首次磁力播放才拉起 aria2c），退出时 dispose（另有 `--stop-with-process` 兜底防孤儿）。
 */
const torrent = new TorrentPlay(fileLogger, () => playerSettings.settings.btExternalPlayer);
/**
 * ★ 2026-09-29 WebDAV 存储（用户选定「WebDAV 直连」）：服务器与凭据加密落盘，
 * 浏览走 PROPFIND、播放走 `/play?dav=<id>` 由中继注入 Authorization（凭据绝不进 URL）。
 */
const davStore = new DavStore(new JsonStore(join(userDataDir(), 'webdav-servers.json')), fileLogger, safeStorageDriveCodec());
const dav = new DavService(hostInfrastructure.http, davStore, fileLogger);
/** ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作；对位 CatClaw Dlna.cs = TVBox osc/dlna） */
const dlna = new DlnaService(fileLogger);
/**
 * ★ 2026-09-29 启动更新检查：本地版本低于 GitHub 最新 Release 时提示用户选择——
 *   查 `api.github.com`（失败不锁死）→ 代理加速下载 Setup → 拉起安装程序并退出本程序。
 */
const updater = new UpdateService(fileLogger);
/**
 * ★ 2026-09-29（用户要求）本地包（影视壳/影视仓 目录包）：登记表 + `/pkg` 资源路由 + py 就地运行。
 *   导入安装目录下的 imports 副本，原始包可移动/删除，不影响已导入订阅。
 */
const uiPreferences = new UiPreferencesService(
  new JsonStore(join(userDataDir(), 'ui-preferences.json')),
  (snapshot) => {
    nativeTheme.themeSource = colorSchemeFor(snapshot.values.themeId);
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      const role = window === playerWindow() ? 'player' : 'application';
      applyWindowSurfacePolicy(window, snapshot.values.themeId, role);
      window.webContents.send(IPC.UI_PREFERENCES_CHANGED, snapshot);
    }
  },
);
nativeTheme.themeSource = colorSchemeFor(uiPreferences.get().values.themeId);
/**
 * ★ 2026-10-16 插件系统（M1，用户拍板「方案 A」）：宿主聚合——
 *   随包官方插件启动时**物化**（`resources/plugins/*.winbox` → `<userData>/plugins/<id>.winbox/` + 侧签）
 *   → 与用户安装**同构**；用户插件安装/启停；超分档位 → mpv 着色器**绝对路径**解析。
 */
/** ★ R10：L4 沙箱用的 HTTP（独立实例；与 SpiderHost 内部实例同实现，无共享状态） */
const pluginHttp = new HttpClient();
const plugins = new PluginHost({
  pluginsDir: pluginsDir(),
  builtinDir: builtinPluginsDir(),
  statePath: join(userDataDir(), 'plugins-state.json'),
  // ★ 2026-10-18 插件设置面板（`contributes.settings.panel`）：宿主**代插件持久化**字段值（读取面留给 L4）
  settingsPath: join(userDataDir(), 'plugin-settings.json'),
  // ★ 2026-10-18（R11）第三方播放内核：`local-path` 来源的本机程序路径由用户在配置页填写
  enginePaths: () => playerSettings.settings.enginePaths,
});
// ★ 2026-10-18（R10）L4 沙箱（`kind:"code"`）：**每插件独立 worker**；宿主能力经 API 面回主进程。
//   权限门禁在 worker 侧 globals 构造（未授权的 `winbox.*` 根本不存在）；沙箱内无 require/process/fs。
//   kv 走独立 `<userData>/plugin-kv.json`（键前缀 `plugin:<id>:` 由宿主拼接）；
//   settings 与设置面板**同一份存储**（`plugin-settings.json`）；
//   player.control 经 `player:ctl` 事件转给播放器窗口（插件不碰内核）。
plugins.attachSandbox({
  workerFile: join(distDir(), 'plugin-worker.cjs'),
  logger: fileLogger,
  api: createPluginSandboxApi({
    http: pluginHttp,
    logger: fileLogger,
    pluginsDir: pluginsDir(),
    settings: plugins.pluginSettingsAccess(),
    kv: new PluginKv(new JsonStore(join(userDataDir(), 'plugin-kv.json'))),
    playerRelay: (op, value) => {
      const w = playerWindow();
      if (!w) return { ok: false, reason: '播放器未打开' };
      try {
        w.webContents.send(IPC.PLAYER_CTL, { op, value });
        return { ok: true };
      } catch {
        return { ok: false, reason: '播放器窗口不可用' };
      }
    },
    notify: (title, body) => {
      try {
        new Notification({ title: String(title), body: String(body) }).show();
      } catch {
        /* 通知不可用（无权限 / 无 DBus）不影响插件 */
      }
    },
    clipboardRead: () => clipboard.readText(),
    clipboardWrite: (text) => clipboard.writeText(String(text)),
    dialogBox: (op, message, title, pluginId) => pluginDialogs.request(pluginId || '插件', op, message, title),
    openExternal: (url) => shell.openExternal(url),
  }),
});
// 退出时释放全部 L4 沙箱 worker（避免残留线程）
app.on('will-quit', () => plugins.dispose());
/**
 * ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`）：宿主托管的引擎**单会话控制器**
 *   （插件永不拉进程 —— `spawn` 是规范 §6.2 永久禁止项）。与内置 `MpvController` 实例分离，零回归。
 */
const playerEngines = new PlayerEngineController(fileLogger);
app.on('will-quit', () => {
  try {
    playerEngines.dispose();
  } catch {
    /* ignore */
  }
});
/** Main composition root: optional player and plugin adapters are fixed before host construction. */
const subtitleService = createSubtitleServiceAssembly({
  userDataDirectory: hostInfrastructure.directories.userData,
  logger: hostInfrastructure.logger,
  credentialCodec: hostInfrastructure.credentialCodec,
  listPluginProviders: async () => (await plugins.subtitleProviders()) ?? [],
}).service;
const danmakuServices = createDanmakuServiceAssembly({
  userDataDirectory: hostInfrastructure.directories.userData,
  logger: hostInfrastructure.logger,
  listPluginSources: async () => (await plugins.danmakuSources()) ?? [],
});
const metadataService = createMetadataService({
  userDataDir: hostInfrastructure.directories.userData,
  cacheDir: hostInfrastructure.directories.cache,
  logger: hostInfrastructure.logger,
  driveCodec: hostInfrastructure.credentialCodec,
  metadataProviders: async () => (await plugins.metaProviders()) ?? [],
  discoverySources: async () => (await plugins.discoverSources()) ?? [],
});
const hostServices = createSpiderHostServices(hostInfrastructure, {
  configuration: configurationServices,
  createSubscriptionImports: (coordinator) => createSubscriptionAssembly({
    userDataDirectory: hostInfrastructure.directories.userData,
    profiles: configurationServices.userConfig,
    logger: fileLogger,
    coordinator,
    onImportProgress: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          if (!window.isDestroyed()) window.webContents.send(IPC.CFG_IMPORT_JOB_PROGRESS, event);
        } catch {
          // A window can close while the import job continues.
        }
      }
    },
    onPersistenceError: (error) => fileLogger.w(`订阅导入任务进度保存失败：${error instanceof Error ? error.message : String(error)}`),
  }).imports,
  localPackages: localPkgs,
  integrations: {
    torrentPlayback: torrent,
    liveTemplates: () => plugins.liveTemplates(),
  },
});
const syncDriveCredentialFiles = (): void => {
  hostServices.driveCredentialSynchronizer.sync(hostServices.drives.list(), hostServices.ucTvStore.get());
};
const resetSpidersAfterDriveChange = (): void => {
  hostServices.aggregateSearch.invalidateCredentials();
  hostServices.spiderRuntime.resetAfterDriveCredentialChange();
};
const ipcServices: MainIpcApplicationPorts = {
  localImports: new LocalImportApplicationService({
    pythonFiles: {
      copyPython: sourcePath => localPkgs.importPython(sourcePath),
      discard: (reference, currentConfig) => localPkgs.discardImport(reference, currentConfig),
    },
    sources: hostServices.sourceConfiguration,
    packages: {
      inspect: root => localPkgs.inspectSubscription(root),
      copyAndRegister: (root, name) => localPkgs.importSubscription(root, name),
      rootOf: index => localPkgs.rootOf(index),
      discard: (reference, currentConfig) => localPkgs.discardImport(reference, currentConfig),
    },
    subscriptions: hostServices.subscriptionImports,
    liveFiles: new LocalLiveFileImporter({
      read: path => readFileSync(path),
      writeUtf8: (fileName, text) => {
        const directory = join(userDataDir(), 'local-live');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, fileName), Buffer.from(text, 'utf-8'));
      },
    }),
    liveChannels: {
      add: channel => hostServices.liveChannelConfiguration.add(channel),
      count: () => hostServices.livePlayback.lives.length,
    },
    packageUrl: pkgSubUrl,
    liveChannel: (name, fileName) => parseLive({
      name,
      api: '',
      type: '0',
      url: localLiveUrl(LOCAL_PROXY_BASE, fileName),
    }, 0),
    logger: { warn: message => fileLogger.w(message) },
  }),
  sourceConfiguration: hostServices.sourceConfiguration,
  configRuntimeSync: {
    status: () => {
      const service = configurationServices.userConfig;
      const revision = service.revision;
      const pendingRevision = service.pendingRuntimeSyncRevision;
      if (pendingRevision === null) return { status: 'synchronized', revision, pendingRevision: null };
      const outcome = service.lastCommitOutcome;
      if (outcome?.status === 'committed-runtime-sync-failed' && outcome.revision === pendingRevision) {
        return { status: 'failed', revision, pendingRevision, error: outcome.error };
      }
      return { status: 'pending', revision, pendingRevision };
    },
    retry: () => configurationServices.userConfig.retryRuntimeSync(),
  },
  sourceReads: {
    importConfig: (source) => hostServices.subscriptionImports.importConfig(source),
    get sites() { return hostServices.sourceRuntimeConfiguration.current?.sites ?? []; },
    get importReport() { return hostServices.subscriptionImports.latestReport; },
    driveBindLearned: () => hostServices.driveBindingLearning.learnedSourceKeys(),
  },
  subscriptionImports: hostServices.subscriptionImports,
  subscriptionGroups: hostServices.subscriptionGroups,
  profileConfiguration: hostServices.profileConfiguration,
  liveChannelConfiguration: hostServices.liveChannelConfiguration,
  sourceDiagnostics: hostServices.sourceDiagnostics,
  driveAccounts: hostServices.driveAccounts,
  spiderRuntime: hostServices.spiderRuntime,
  driveFileCleanup: hostServices.driveFileCleanup,
  livePlayback: hostServices.livePlayback,
  vod: {
    home: (key, profileId, signal) => hostServices.sourceCatalog.home(key, profileId, signal),
    category: (key, tid, page, extend, profileId, signal) => hostServices.sourceCatalog.category(key, tid, page, extend, profileId, signal),
    detail: (key, ids, profileId) => hostServices.sourceCatalog.detail(key, ids, profileId),
    search: (key, keyword, profileId, signal) => hostServices.sourceCatalog.search(key, keyword, profileId, signal),
    searchAll: (keyword, options, onProgress, signal) => hostServices.aggregateSearchRunner.run(keyword, options, onProgress, signal),
    play: (key, flag, id, profileId) => hostServices.playbackRequest.execute(key, flag, id, profileId),
  },
};
const disposeSpiderServices = (): void => {
  hostServices.subscriptionImports.dispose();
  try {
    hostServices.spiderRuntime.dispose();
  } catch {
    /* ignore */
  }
};
const settingsBackup = new SettingsBackupService({
  userConfig: {
    snapshot: () => configurationServices.sources.getSnapshot(),
    restore: (value) => configurationServices.userConfig.restore(value),
  },
  drives: {
    list: () => hostServices.driveAccounts.list(),
    set: (provider, token) => hostServices.driveAccounts.set(provider, token),
    remove: (provider) => hostServices.driveAccounts.remove(provider),
  },
  subtitle: subtitleService,
  metadata: metadataService,
  danmaku: {
    getSettings: () => danmakuServices.store.settings,
    setSettings: (settings) => { danmakuServices.store.settings = settings; },
  },
  driveRuntime: {
    resetAfterCredentialChange: resetSpidersAfterDriveChange,
    syncCredentialFiles: syncDriveCredentialFiles,
  },
});
const proxy = new LocalProxyServer(
  fileLogger,
  () => hostServices.driveAccounts.list(),
  // ★ 2026-09-29 m3u8 去广告注入（默认关，配置页「播放」可开）：
  //   开关每轮清单回源时现读（改后即时生效）；规则用当前订阅的 rules[].regex 按 host 匹配。
  {
    enabled: () => playerSettings.settings.m3u8Purify,
    rulesFor: (url) => hostRegexFor(url, hostServices.sourceRuntimeConfiguration.current?.rules),
  },
  // ★ 2026-09-29 WebDAV 取流认证（凭据只在主进程加密存储里）
  (id) => dav.authHeader(id),
);
// ★ 2026-09-29（用户要求）本地包：包内资源路由（/pkg/<i>/<rel>）+ 订阅 pkg:// 读取
proxy.pkgRoot = (i) => localPkgs.rootOf(i);
  hostServices.sourceConfiguration.initializeLocalImports();
// ★ 把 /play 中继的真实转发字节速率推给渲染层（播放器「缓存中」实时网速）
const pushSpeed = (kbs: number): void => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('net:speed', kbs);
  }
};
proxy.onSpeed = pushSpeed;
// ★ 2026-09-29：BT 下载速率走同一条通道（/bt 中继写回字节 + aria2 下载速率）→ 播放器「缓存中 x MB/s」
torrent.onSpeed = pushSpeed;
// ★ 2026-09-26：壳/蜘蛛的宿主代理（`/proxy/<jvmPort>?do=proxy&key=…`）被访问 → 钉住那个 JVM
proxy.onSpiderProxy = (port) => hostServices.bridge.pinSpiderProxy(port);
proxy.onPythonProxy = (key, params) => hostServices.pythonSourceProxy.execute(key, params);
// ★ 2026-09-29：`/bt/<hash>/<idx>` 取流口（Range + piece 门控 + 本地读盘）
proxy.bt = torrent;
// ★ 2026-10-25（9978 局域网控制台与手机端推送）：处理手机扫码/局域网网页推送动作
proxy.onRemoteAction = async (action) => {
  fileLogger.i(`remote: 收到指令 ${action.do} ${action.name || ''} ${action.url || ''}`);
  if (action.do === 'pushStore' && action.url) {
    try {
      const res = await hostServices.subscriptionImports.importConfig({ url: action.url, name: action.name || '推送仓库' });
      fileLogger.i(`remote: 仓库推送导入完成，共 ${res.config.sites.length} 源`);
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.WIN_REPORT_ERROR, { message: `已成功导入手机推送的仓库：${action.name || action.url}` });
      }
    } catch (e) {
      fileLogger.w(`remote: 仓库推送导入失败: ${(e as Error).message}`);
    }
  } else if (action.do === 'push' && action.url) {
    openPlayerWindow({
      key: 'push',
      flag: 'push',
      title: action.name || '手机推送播放',
      episodes: [{ name: action.name || '推送视频', url: action.url }],
      epIndex: 0,
      lastUrl: action.url,
      lastName: action.name || '推送视频',
    });
  } else if (action.do === 'livePush' && (action.address || action.url)) {
    const liveUrl = action.address || action.url || '';
    openPlayerWindow({
      key: 'livePush',
      flag: 'livePush',
      title: action.name || '手机推送直播',
      episodes: [{ name: action.name || '直播频道', url: liveUrl }],
      epIndex: 0,
      lastUrl: liveUrl,
      lastName: action.name || '直播频道',
    });
  } else if (action.do === 'pushAliToken' && action.token) {
    try {
      await hostServices.driveAccounts.set('ali', action.token);
      fileLogger.i('remote: 阿里云盘 Token 保存成功');
    } catch (e) {
      fileLogger.w(`remote: 阿里云盘 Token 保存失败: ${(e as Error).message}`);
    }
  } else if (action.do === 'search' && action.word) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.show();
        w.focus();
        w.webContents.send('nav:search', { keyword: action.word });
      }
    }
  } else if (action.do === 'danmaku' && action.text) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.DANMAKU_EMIT_REALTIME, { text: action.text });
      }
    }
  }
};

function isDev(): boolean {
  return !app.isPackaged && process.env.NODE_ENV !== 'production';
}

const devReloadPipe = process.env.WINBOX_DEV_RELOAD_PIPE;
if (!app.isPackaged && devReloadPipe) {
  const devReloadConnection = createConnection(devReloadPipe);
  devReloadConnection.setEncoding('utf8');
  let devReloadCommand = '';
  devReloadConnection.on('data', (chunk) => {
    devReloadCommand += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const newline = devReloadCommand.indexOf('\n');
    if (newline < 0) return;
    const command = devReloadCommand.slice(0, newline).trim();
    devReloadCommand = devReloadCommand.slice(newline + 1);
    if (command === 'quit') {
      fileLogger.i('开发重启：收到退出命令');
      devReloadConnection.end();
      app.quit();
    }
  });
  devReloadConnection.on('error', (error) => {
    fileLogger.w(`开发重启通道连接失败：${error.message}`);
  });
}

// 渲染策略：**不再强制禁用 GPU/硬件加速**。
//   过往为"无 GPU/驱动异常环境"加了 disableHardwareAcceleration + disable-gpu + disable-software-rasterizer，
//   但用户实测（本机有正常 GPU）强禁后无边框窗口在最大化/resize 时合成器不刷新，
//   网页只渲染在左上角原尺寸、右侧/下方直接露出 backgroundColor（"最大化异形"）。
//   交由 Electron/Chromium 按环境自选：有 GPU 走硬件合成（最大化正常），无 GPU 时自动回退软件。
// no-sandbox / disable-dev-shm-usage 仍保留（子进程沙箱相关，与渲染无关）。
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// 原生崩溃此前没有应用日志；记录进程类型/退出码，不记录资源 URL 或凭据。
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_e, details) => {
    fileLogger.w(`renderer-gone wc=${contents.id} reason=${details.reason} exitCode=${details.exitCode}`);
  });
  contents.on('unresponsive', () => fileLogger.w(`renderer-unresponsive wc=${contents.id}`));
});
/**
 * ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）★★
 *
 * 证据：10-16 日志里唯一非 jvm 异常 = `child-process-gone type=GPU reason=crashed exitCode=34`；
 *   症状完全吻合 —— GPU 子进程（合成器）死掉后整窗内容不再刷新（连进度条都不动），
 *   音频走另一条通道继续 ⇒ 用户看到的就是「画面消失、只剩声音」。Chromium 不会自愈（不会自动补拉 GPU 进程）。
 *
 * ① 恢复：GPU 崩溃后**主动 reload 一次「最后在播放的那个窗口」**。
 *    · 目标 = 渲染层最近一次上报的窗口（见 util/mediaDiag）→ 回退播放器窗 → 回退主窗；
 *    · 播放器窗 reload 后由它自己的 `did-finish-load` + `pendingInit` 重发最后一发 init ⇒ 自动续播；
 *      主窗是 hash 路由，reload 后仍停在原页面（不会跳到首页）。
 *    · 退避：60s 滑动窗口内 GPU 崩溃 ≥3 次 → 只记日志、不再自动重载（避免与坏驱动形成「崩→载→崩」风暴）。
 * ② 诊断：日志带上崩溃前的最后一条播放事件（渲染层上报），否则永远只有一行 GPU 崩溃、无从定位。
 * ③ 有意不做：不重启整个应用（会丢播放器窗、宿主与蜘蛛状态）；不动渲染策略（见上方 GPU/硬件加速注释）。
 */
const gpuCrashAt: number[] = [];
/** 退避判定（本次计入）：60s 内第 3 次及以后不再自动重载 */
function gpuRecoverAllowed(): boolean {
  const now = Date.now();
  while (gpuCrashAt.length && now - gpuCrashAt[0] > 60_000) gpuCrashAt.shift();
  gpuCrashAt.push(now);
  return gpuCrashAt.length < 3;
}
/** 恢复目标 = 最后在播放的那个窗口 → 播放器窗 → 主窗（都没有则 null） */
function gpuRecoveryTarget(): BrowserWindow | null {
  const id = lastMediaWcId();
  if (id != null) {
    const wc = webContents.fromId(id);
    const w = wc ? BrowserWindow.fromWebContents(wc) : null;
    if (w && !w.isDestroyed()) return w;
  }
  const pw = playerWindow();
  if (pw && !pw.isDestroyed()) return pw;
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}
app.on('child-process-gone', (_event, details) => {
  let suffix = '';
  if (details.type === 'GPU') {
    suffix = ` | ${lastMediaSummary()}`;
    if (!gpuRecoverAllowed()) {
      suffix += ' | 退避：60s 内第 3 次及以上 GPU 崩溃 → 只记日志、不自动重载';
    } else {
      const target = gpuRecoveryTarget();
      if (!target) {
        suffix += ' | 未找到可重载的窗口（无播放上报且主窗已关）→ 不恢复';
      } else {
        const wcId = target.webContents.id;
        // 稍等再 reload：给 Chromium 一点时间重建 GPU 进程，立刻 reload 可能又撞上未就绪的合成器
        setTimeout(() => {
          try {
            if (!target.isDestroyed()) target.webContents.reload();
          } catch {
            /* ignore */
          }
        }, 800);
        suffix += ` | 已触发 GPU 崩溃恢复：800ms 后重载窗口（wc=${wcId}）`;
      }
    }
  }
  fileLogger.w(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${suffix}`);
});

function createWindow(): void {
  /**
   * ★ 2026-10-16（用户要求「自适应屏幕分辨率调节窗口大小、字体大小」）：
   *   默认窗口尺寸与最小尺寸都按**当前显示器工作区**推出来的倍率等比放大（见 `ui/uiScale`），
   *   并用 `setZoomFactor` 把整套 UI（含字号）一起放大 —— 1K 下仍是 1280×800（回归不变），
   *   4K 下窗口与字体同步变大，不再「UI 特别小」。
   */
  const size = scaledWindowFor(BASE_WINDOW);
  const winOpts: Electron.BrowserWindowConstructorOptions = {
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    // 默认跟随系统亮暗（Mica 背景会随之切换深浅）
    // backgroundMaterial: 'mica' 仅 Win11 有效；旧版本自动降级无副作用
    // ★ 用不透明底色：无边框窗口若背景全透明，放大/最大化时未渲染区域会显示黑色残影/形状异常
    //   （--bg-glass 本身约 90% 不透明，视觉几乎无差异，Mica 磨砂不受影响）
    backgroundColor: windowSurfaceColor(uiPreferences.get().values.themeId, 'application'),
    title: 'Win-Box',
    // 无边框自定义标题栏：窗口控制（最小化/最大化/关闭）与拖拽由渲染层 TitleBar 处理
    frame: false,
    autoHideMenuBar: true,
    icon: app.isPackaged ? undefined : join(__dirname, '..', '..', 'build', 'icon.png'),
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  mainWindow = new BrowserWindow(winOpts);
  const showMainWindowIfUnexpectedlyHidden = (reason: string) => {
    const win = mainWindow;
    if (!win || win.isDestroyed() || bossKey.isActive || win.isVisible()) return;
    fileLogger.w(`主窗口在 ${reason} 后仍被隐藏，Boss Key 未激活，重新显示`);
    win.show();
  };
  mainWindow.on('hide', () => {
    fileLogger.w(`主窗口收到隐藏事件（Boss Key active=${bossKey.isActive}, enabled=${bossKey.settings.enabled}）`);
    setTimeout(() => showMainWindowIfUnexpectedlyHidden('hide event'), 0);
  });
  mainWindow.once('ready-to-show', () => showMainWindowIfUnexpectedlyHidden('ready-to-show'));
  fileLogger.i(`主窗口已创建（visible=${mainWindow.isVisible()}, bounds=${JSON.stringify(mainWindow.getBounds())}）`);
  // ★ 2026-10-16：登记为主窗口（界面缩放要按倍率重排它的尺寸）+ 立刻套用当前倍率
  registerUiWindow(mainWindow);
  setMainWindowProvider(() => mainWindow);
  applyUiScale();

  // ★ Win11 无边框圆角在最大化时露出右上角黑角（关闭钮旁异形）：最大化取消圆角、还原恢复
  const setCorner = (round: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) applyWindowCorner(mainWindow, round);
  };
  // ★ 最大化/还原后强制重绘：无边框窗口在最大化动画期间 webContents 视口可能未铺到新尺寸，
  //   未重绘区域会直接显示 backgroundColor（暗色）→ 观感像"小窗贴左上、右侧补背景"。强制重绘兜底。
  const refreshContent = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const { webContents } = mainWindow;
        if (!webContents.isDestroyed()) webContents.invalidate();
      } catch {
        /* ignore */
      }
    }
  };
  mainWindow.on('maximize', () => { setCorner(false); refreshContent(); });
  mainWindow.on('unmaximize', () => { setCorner(true); refreshContent(); });

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    setTimeout(() => showMainWindowIfUnexpectedlyHidden('openDevTools'), 0);
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // ★ 2026-09-30 数据目录（安装目录/data；老用户自动迁移 + 清理旧 C 盘目录）——排障第一现场
  try {
    const m = dataDirReport.migration;
    const migDesc = m
      ? `迁移=${m.status}${m.files ? `（${m.files} 文件 / ${(m.bytes / 1024 / 1024).toFixed(1)}MB）` : ''}${m.skipped ? `，跳过可重建缓存 ${m.skipped} 项` : ''}${m.status === 'moved' ? '（整目录移动）' : ''}${m.cleanedLegacy ? '，旧目录已清理' : ''}${m.error ? `，注意：${m.error}` : ''}`
      : '迁移=无旧数据';
    if (dataDirReport.mode === 'fallback') {
      fileLogger.w(
        `数据目录: ${dataDirReport.target}（回退，计划目录 ${dataDirReport.planned}）：${dataDirReport.reason || ''}`,
      );
    } else {
      fileLogger.i(`数据目录: ${dataDirReport.target}（模式 ${dataDirReport.mode}；${migDesc}）`);
    }
  } catch {
    /* ignore */
  }

  // 启动即记录资源根定位结果：打包后（尤其 portable 的 7z-out 解压布局）
  // 若再出现「JRE 缺失」，日志首行就能看出真实路径命中情况。
  try {
    const { resourcesDir, resourcesDirDebug } = await import('./util/paths');
    const dir = resourcesDir();
    const ok = existsSync(join(dir, 'jvm', 'jre', 'bin', 'java.exe'));
    fileLogger.i(`资源根: ${dir} | java.exe: ${ok ? 'OK' : '缺失'}`);
    if (!ok) fileLogger.w('资源候选路径探测:\n' + resourcesDirDebug());
  } catch (e) {
    fileLogger.w('资源根探测失败: ' + (e instanceof Error ? e.message : String(e)));
  }

  // ★ 2026-10-09：构建标记 —— 日志排障第一行就能确认「跑的是哪只构建」。
  //   背景：同版本号覆盖安装时用户日志无法区分新旧产物（1.20.0 两轮都叫 1.20.0），
  //   此标记随每轮 main 改动手工递增（含当轮关键词，grep 即证）。
    fileLogger.i(`build: 20261012.1 release-${app.getVersion()}`);

  // ★ 2026-10-15（用户要求）：**更新后首次启动**清空应用私有缓存（winbox-cache）。
  //   背景：升级下载的安装包落在 `winbox-cache/update/` 且从不删除，逐版累积会让安装目录涨到 GB 级。
  //   判定 = 与 `<userData>/last-run-version.json` 记的「上次运行版本」比较，版本变化即视为更新后首次启动；
  //   **仅打包态生效**（开发态版本抖动不应误清）；标记文件放在 winbox-cache 之外，不会被本次清理删掉。
  //   清理后所有内容自动重建（见下方 `enablePrewarm` 之后的 `rewarmAfterCacheClear`）。
  let privateCacheReset: ClearCacheResult | null = null;
  try {
    const marker = lastRunVersionPath(userDataDir());
    const prev = readLastRunVersion(marker);
    if (app.isPackaged && isFirstLaunchAfterUpdate(prev, app.getVersion())) {
      privateCacheReset = clearWinboxCache(cacheDir());
      fileLogger.i(
        `更新后首次启动（${prev} → ${app.getVersion()}）：已清空应用私有缓存 winbox-cache（释放 ${(privateCacheReset.freedBytes / 1024 / 1024).toFixed(1)}MB；`
          + `清理 ${privateCacheReset.cleared.length} 项${privateCacheReset.cleared.length ? `：${privateCacheReset.cleared.slice(0, 12).join('/')}` : ''}`
          + `${privateCacheReset.failed.length ? `；失败 ${privateCacheReset.failed.join('/')}` : ''}）`,
      );
    }
    if (app.isPackaged) writeLastRunVersion(marker, app.getVersion());
  } catch (e) {
    fileLogger.w('更新后清空私有缓存失败：' + (e instanceof Error ? e.message : String(e)));
  }

  try {
    await proxy.start();
  } catch {
    fileLogger.w('本地代理启动失败，直播归一化可能受影响');
  }
  // ★ 网络代理设置（用户可在配置页填 http 代理；用于被 DNS 污染 / SNI 阻断的站点）。
  //   初始化后所有出站（本进程请求 / 本地中继 / JVM 与 Python 蜘蛛 / 嗅探窗口）统一生效。
  try {
    const { initProxySettings } = await import('./net/proxy');
    const { userDataDir } = await import('./util/paths');
    initProxySettings(join(userDataDir(), 'proxy.json'));
  } catch (e) {
    fileLogger.w('代理设置初始化失败：' + (e as Error).message);
  }
  // ★ 2026-09-28：播放/落盘诊断落盘（`<userData>/logs/play-diag-*.jsonl`）
  //   注入式（playDiag 不静态依赖 electron），供「落盘/播放成功率」排查取数。
  try {
    const { initPlayDiag } = await import('./util/playDiag');
    const { userDataDir } = await import('./util/paths');
    initPlayDiag({
      logDir: () => join(userDataDir(), 'logs'),
      log: (m: string) => fileLogger.i(m),
    });
  } catch (e) {
    fileLogger.w('播放诊断初始化失败：' + (e as Error).message);
  }
  // ★ 网盘会话必须在蜘蛛预热前准备好：夸克 member 接口会补发新版 __puus，
  //   而 Pizazz/fty 蜘蛛在 init 时只读一次 cookie。失败时保留旧凭据并继续启动。
  try { syncDriveCredentialFiles(); } catch { /* 同步失败不影响启动 */ }
  try { await hostServices.driveAccounts.refreshSessions(); } catch (e) {
    fileLogger.w('网盘会话刷新失败（保留现有绑定）：' + (e as Error).message);
  }
  try { syncDriveCredentialFiles(); } catch { /* 同步失败不影响启动 */ }
  hostServices.spiderRuntime.enablePrewarm();
  // ★ 更新后已清空 winbox-cache（含 jar 转换产物与常驻运行时）→ 立刻在后台重建，
  //   否则用户下次进源要现付「下载 + dex2jar + JVM 冷启动」（实测 37s，会被请求超时顶掉）。
  if (privateCacheReset) {
    try { hostServices.spiderRuntime.rewarmAfterCacheClear(); } catch { /* 预热失败不影响清理结果 */ }
  }
  // ★ 2026-10-16 插件宿主：物化随包官方插件 + 刷新登记表（失败不阻塞启动）
  try {
    await plugins.init();
    const items = await plugins.list();
    fileLogger.i(`插件：登记 ${items.length} 个（${items.map((p) => `${p.id}@${p.version}/${p.source}`).join('、') || '无'}）`);
  } catch (e) {
    fileLogger.w('插件初始化失败：' + (e instanceof Error ? e.message : String(e)));
  }
  registerIpc(ipcServices, dav, dlna, updater, uiPreferences, plugins, playerEngines, {
    subtitles: subtitleService,
    danmaku: danmakuServices.service,
    metadata: metadataService,
  }, settingsBackup);
  /**
   * 显式设置 WINBOX_MEMORY_PROBE=1 时，启动后 15s 采一次空闲基线；
   *   供与「播放中」的采样对照；播放中的 60s 采样由 ipc 的 `media:state`（播放器窗口）触发。
   *   口径与隐私说明见 util/memProbe（只记内存数字与进程名，不含 URL / 凭据）。
   */
  if (process.env.WINBOX_MEMORY_PROBE === '1') {
    setTimeout(() => {
      void import('./util/memProbe').then((m) => m.sampleMemory('idle@15s')).catch(() => undefined);
    }, 15_000).unref?.();
  }
  // 老板键：注入窗口提供者（主窗口 + 播放器窗口）并按上次设置注册全局快捷键
  bossKey.start(() => {
    const ws: BrowserWindow[] = [];
    if (mainWindow && !mainWindow.isDestroyed()) ws.push(mainWindow);
    const pw = playerWindow();
    if (pw) ws.push(pw);
    return ws;
  });
  bossKey.apply();
  // ★ 关闭播放器窗口 → 删除本次夸克转存落盘文件（观看进度保留在本地历史）
  onPlayerWindowClosed(() => {
    void hostServices.driveFileCleanup.deletePending().catch(() => undefined);
  });
  // ★ 启动时清理上次遗留的夸克落盘文件（此前关闭/退出未删成功的）
  void hostServices.driveFileCleanup.deletePending().catch(() => undefined);
  createWindow();
  // ★ 启动时自动订阅刷新（≥7 天一次，静默后台执行，失败仅记日志）
  void hostServices.subscriptionImports.refreshIfDue();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  proxy.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ★ 退出前彻底清理：terminate 所有 JVM 蜘蛛子进程 + 停本地代理 + 断 token 解码，
//   确保关闭应用后无任何后台残留进程/服务（含 Electron 隐含子进程会在 app.quit 后自行结束）。
registerAppQuitCleanup(app, {
  cleanup: () => hostServices.driveFileCleanup.deletePending(),
  timeoutMs: 8_000,
  onError: error => fileLogger.w(`退出清理失败：${error instanceof Error ? error.message : String(error)}`),
  dispose: () => {
    try {
      // ★ 退出前再尝试一次夸克落盘文件清理（失败会持久化到下次启动重试）
      void hostServices.driveFileCleanup.deletePending();
    } catch {
      /* ignore */
    }
    try {
      disposeSpiderServices();
    } catch {
      /* ignore */
    }
    try {
      // ★ 2026-09-29：停 BT 引擎（回收到 win-quit 这一步，保证不留 aria2c 孤儿进程）
      torrent.dispose();
    } catch {
      /* ignore */
    }
    try {
      proxy.stop();
    } catch {
      /* ignore */
    }
  },
});

// 兜底：若 did-fail-load 或异常，也让 JVM 子进程不残留
process.on('beforeExit', () => {
  try { disposeSpiderServices(); } catch { /* ignore */ }
});

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  /**
   * ★★ 2026-10-16（用户报「卸载软件 → 重装 → 打开会闪退，排查指向 9978 端口占用中」）★★
   *   真因 = **已有一个实例还在跑，但用户看不到它的窗口** —— 最典型的是老板键
   *   （默认 `Ctrl+Shift+B`，本机 `bosskey.json` 里 `enabled: true`）：它把**所有窗口连同任务栏图标**
   *   一起 `hide()`（见 bossKey.ts），用户就以为「软件已关闭」，而它其实活着，
   *   同时占着 **单实例锁** 与 **本地中继 9978** ⇒ 本次启动拿不到锁 → 走到这里静默 `app.quit()`
   *   ＝ 既没有窗口、也**不留任何日志**的「闪退」（旧代码这条路径完全无痕，所以日志里查不到）。
   *   两层修复：① 这里补一行日志（日后「闪退」可定位）；② `second-instance` 里把已有实例**显出来**
   *   （先退老板模式 → show/restore/focus；没有主窗口就补一个），让用户看到软件其实还在运行。
   */
  fileLogger.w(
    '已有实例在运行（单实例锁被占用）→ 本次启动退出；若界面上看不到窗口，多半是上一实例被老板键（默认 Ctrl+Shift+B）隐藏或残留：'
    + '按一次老板键可恢复，或在任务管理器结束 Win-Box（本地中继 9978 由该实例占着）',
  );
  app.quit();
} else {
  app.on('second-instance', () => {
    fileLogger.w('检测到第二实例启动：已有实例在运行 → 退出老板模式并把窗口显出来');
    try {
      if (bossKey.isActive) bossKey.exit(); // 老板键隐藏态：先恢复，否则下面的 show() 也没人看得到
    } catch {
      /* ignore */
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow(); // 残例态（主窗口早没了但进程还在）→ 补一个窗口，别让用户对着"闪退"发呆
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}
