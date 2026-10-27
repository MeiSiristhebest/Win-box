// src/renderer/api/client.ts — window.api 的类型化封装 + IpcResult 解包
import type { IpcResult } from '../../shared/ipc-result';
import type {
  SourceBean,
  LiveGroup,
  EpgChannelRef,
  SourceMoveDirection,
  SourceUpdatePatch,
  SearchAllProgressEvent,
  BossKeySettings,
  SubscriptionImportProgressEvent,
  SubscriptionRefreshResolution,
  ConfigRuntimeSyncStatus,
  ConfigRuntimeSyncRetryResult,
} from '../../shared/types';
import type {
  SubtitleCandidate,
  SubtitleFetchResult,
  SubtitleProviderView,
  SubtitleSearchReport,
  SubtitleSettings,
} from '../../shared/subtitle';
import type { DanmakuSettings } from '../../shared/danmaku';
import type { MetaSettings } from '../../shared/meta';
import type { ExploreQuery } from '../../shared/discover';
import type { PlayerSettings, MpvStatus, MpvStartOptions, MpvCommand, MpvStateEvent, MediaStateEvent, MediaRuntimeId, MediaRuntimeStatus, MediaRuntimeProgress } from '../../shared/player';
import type { PluginView, PluginInspectResult, SrState, ThemeSkinView, LiveTemplateView, UiCommandView, KeymapView, SettingsPanelView, UiSlotView, PlayerEngineView } from '../../shared/plugin';
import type { DavServer } from '../../shared/webdav';
import type { DlnaCastTarget, DlnaDevice } from '../../shared/dlna';
import type { UpdateProgress } from '../../shared/update';
import type { UiPreferencesPatch, UiPreferencesSnapshot } from '../../shared/uiPreferences';
import type { UiScalePref, UiScaleState } from '../../shared/uiScale';
import { abortError, awaitWithAbort } from '../../engine/util/abort';

export type { HomeResult, ImportReturn } from './windowApi';

async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error.message);
  return r.data as T;
}

export const CONFIG_RUNTIME_SYNC_STATUS_EVENT = 'winbox:config-runtime-sync-status';

function publishConfigRuntimeSyncStatus(status: ConfigRuntimeSyncStatus): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ConfigRuntimeSyncStatus>(CONFIG_RUNTIME_SYNC_STATUS_EVENT, { detail: status }));
}

async function queryConfigRuntimeSyncStatus(): Promise<ConfigRuntimeSyncStatus> {
  const status = await unwrap(window.api.config.runtimeSyncStatus());
  publishConfigRuntimeSyncStatus(status);
  return status;
}

async function afterConfigMutation<T>(request: Promise<IpcResult<T>>): Promise<T> {
  const result = await unwrap(request);
  // Status lookup is observational: an unavailable status endpoint must never turn
  // a successful, already-committed mutation into an apparent failure.
  void queryConfigRuntimeSyncStatus().catch(() => undefined);
  return result;
}

let vodRequestSequence = 0;

function nextVodRequestId(): string {
  vodRequestSequence = (vodRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${vodRequestSequence.toString(36)}`;
}

function invokeVodRequestWithCancellation<T>(
  signal: AbortSignal | undefined,
  start: (requestId: string) => Promise<IpcResult<T>>,
  cancel: (requestId: string) => void,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  const requestId = nextVodRequestId();
  const request = unwrap(start(requestId));
  if (!signal) return request;

  const cancelRequest = (): void => cancel(requestId);
  signal.addEventListener('abort', cancelRequest, { once: true });
  if (signal.aborted) cancelRequest();
  return awaitWithAbort(request, signal).finally(() => {
    signal.removeEventListener('abort', cancelRequest);
  });
}

export const client = {
  ping: () => unwrap(window.api.system.ping()),
  appIcon: () => unwrap(window.api.system.icon()),
  getUiPreferences: () => unwrap(window.api.system.getUiPreferences()),
  initializeUiPreferences: (legacy: UiPreferencesPatch) => unwrap(window.api.system.initializeUiPreferences(legacy)),
  updateUiPreferences: (patch: UiPreferencesPatch) => unwrap(window.api.system.updateUiPreferences(patch)),
  onUiPreferencesChanged: (cb: (snapshot: UiPreferencesSnapshot) => void) => window.api.system.onUiPreferencesChanged(cb),
  importConfig: (a: { url?: string; json?: string }) => afterConfigMutation(window.api.config.import(a)),
  listSites: () => unwrap(window.api.config.listSites()),
  diagnose: () => unwrap(window.api.config.diagnose()),
  cfgGet: () => unwrap(window.api.config.cfgGet()),
  cfgRuntimeSyncStatus: queryConfigRuntimeSyncStatus,
  cfgRetryRuntimeSync: async (): Promise<ConfigRuntimeSyncRetryResult> => {
    const result = await unwrap(window.api.config.retryRuntimeSync());
    await queryConfigRuntimeSyncStatus().catch(() => undefined);
    return result;
  },
  cfgAddSource: (bean: SourceBean) => afterConfigMutation(window.api.config.addSource(bean)),
  cfgUpdateSource: (key: string, patch: SourceUpdatePatch) => afterConfigMutation(window.api.config.updateSource(key, patch)),
  cfgDeleteSource: (key: string) => afterConfigMutation(window.api.config.deleteSource(key)),
  cfgDeleteSources: (keys: string[]) => afterConfigMutation(window.api.config.deleteSources(keys)),
  cfgSetGlobalSourceBlock: (keys: string[], blocked: boolean) => afterConfigMutation(window.api.config.setGlobalSourceBlock(keys, blocked)),
  cfgMoveSource: (key: string, direction: SourceMoveDirection) => afterConfigMutation(window.api.config.moveSource(key, direction)),
  cfgSetActiveSource: (key: string) => afterConfigMutation(window.api.config.setActiveSource(key)),
  cfgSetActiveLive: (index: number) => afterConfigMutation(window.api.config.setActiveLive(index)),
  cfgImportUrl: (url: string, name?: string) => afterConfigMutation(window.api.config.importUrl(url, name)),
  cfgStartSubscriptionImport: (url: string, name?: string) =>
    afterConfigMutation(window.api.config.startSubscriptionImport(url, name)),
  cfgCancelSubscriptionImport: (jobId: string) => afterConfigMutation(window.api.config.cancelSubscriptionImport(jobId)),
  cfgRetryFailedSubscriptionImport: (jobId: string) => afterConfigMutation(window.api.config.retryFailedSubscriptionImport(jobId)),
  cfgContinueSubscriptionImport: (jobId: string) => afterConfigMutation(window.api.config.continueSubscriptionImport(jobId)),
  cfgGetSubscriptionImport: (jobId: string) => unwrap(window.api.config.getSubscriptionImport(jobId)),
  cfgListSubscriptionImports: () => unwrap(window.api.config.listSubscriptionImports()),
  cfgResumeSubscriptionImport: (jobId: string) => afterConfigMutation(window.api.config.resumeSubscriptionImport(jobId)),
  onSubscriptionImportProgress: (cb: (event: SubscriptionImportProgressEvent) => void) =>
    window.api.config.onSubscriptionImportProgress(cb),
  cfgRemoveSubscriptionGroupMember: (groupId: string, memberId: string) =>
    afterConfigMutation(window.api.config.removeSubscriptionGroupMember(groupId, memberId)),
  cfgResolveSubscriptionGroupRefresh: (groupId: string, memberId: string, resolution: SubscriptionRefreshResolution) =>
    afterConfigMutation(window.api.config.resolveSubscriptionGroupRefresh(groupId, memberId, resolution)),
  cfgImportJsonLocal: (name?: string) => afterConfigMutation(window.api.config.importJsonLocal(name)),
  cfgImportPyLocal: () => afterConfigMutation(window.api.config.importPyLocal()),
  /** ★ 2026-09-29：导入本地包（目录包）—— 返回包根/命中订阅/源数，用于结果提示 */
  cfgImportPackage: (name?: string, root?: string) => afterConfigMutation(window.api.config.importPackage({ name, root })),
  /** ★ 2026-09-29 本地包「网页源」：独立窗口打开 homePage html（fm 桥） */
  webHomeOpen: (init: { url: string; title?: string; site?: Record<string, string | undefined> }) =>
    unwrap(window.api.config.webHomeOpen(init)),
  cfgSaveAsProfile: (name: string) => afterConfigMutation(window.api.config.saveAsProfile(name)),
  cfgActivateProfile: (id: string) => afterConfigMutation(window.api.config.activateProfile(id)),
  cfgDeleteProfile: (id: string) => afterConfigMutation(window.api.config.deleteProfile(id)),
  cfgUpdateProfileName: (a: { id: string; name: string }) => afterConfigMutation(window.api.config.updateProfileName(a)),
  cfgProfiles: () => unwrap(window.api.config.cfgProfiles()),
  /** ★ 2026-09-30（用户要求）：换源弹层「左订阅 / 右源」视图（每份档案的源 key/name 清单） */
  cfgProfileSites: () => unwrap(window.api.config.profileSites()),
  cfgProfileSources: (profileId: string) => unwrap(window.api.config.profileSources(profileId)),
  /** ★ 2026-09-30（用户要求）：一步完成「切换档案 + 选中该档案下的源」 */
  cfgSwitchProfileSource: (profileId: string, key: string) =>
    afterConfigMutation(window.api.config.switchProfileSource({ profileId, key })),
  /**
   * ★ 2026-09-30（用户要求）：导入本地 TXT / M3U 直播源（配置页按钮）。
   * ★ 2026-10-14：两步导入 —— 首次返回 `needsName` 由渲染层弹框命名，二次带 `{ path, name }` 登记。
   */
  cfgImportLiveLocal: (args?: { name?: string; path?: string }) => afterConfigMutation(window.api.config.importLiveLocal(args)),
  /** ★ 2026-10-14（用户要求）：删除某条直播线路（下标） */
  cfgDeleteLive: (index: number) => afterConfigMutation(window.api.config.deleteLive(index)),
  /** ★ 2026-10-16（用户要求）：批量删除直播线路（配置页多选删除） */
  cfgDeleteLives: (indices: number[]) => afterConfigMutation(window.api.config.deleteLives(indices)),
  /** ★ 2026-10-14（用户要求）：重命名某条直播线路 */
  cfgUpdateLive: (a: { index: number; name: string }) => afterConfigMutation(window.api.config.updateLive(a)),
  /** ★ 2026-09-30：数据目录信息（安装目录/data；迁移结果与回退原因） */
  dataDir: () => unwrap(window.api.system.dataDir()),
  vodDebug: (key: string) => unwrap(window.api.config.vodDebug(key)),
  audit: () => unwrap(window.api.config.audit()),
  cacheClear: () => unwrap(window.api.config.cacheClear()),
  /** ★ 2026-09-27：已学到的「需要网盘绑定」源 key（源主页显示绑定入口的兜底判据） */
  driveBindKeys: () => unwrap(window.api.config.driveBindKeys()),
  // ★ 播放网盘资源未绑定 cookie → 让主窗口跳到「点播页」（源主页有「网盘绑定」入口；播放器窗口也走此路径）
  gotoDriveBind: () => unwrap(window.api.config.gotoDriveBind()),
  onNavDriveBind: (cb: () => void) => window.api.config.onNavDriveBind(cb),
  winMinimize: () => unwrap(window.api.win.minimize()),
  winMaximize: () => unwrap(window.api.win.maximize()),
  winClose: () => unwrap(window.api.win.close()),
  winIsMaximized: () => unwrap(window.api.win.isMaximized()),
  // ★ 2026-09-30（用户要求）：播放器「置顶」按钮
  winSetAlwaysOnTop: (on: boolean) => unwrap(window.api.win.setAlwaysOnTop(on)),
  winIsAlwaysOnTop: () => unwrap(window.api.win.isAlwaysOnTop()),
  // ★ 2026-10-08（用户要求）：详情页独立窗口
  winOpenDetail: (a: { key: string; id: string; query?: string }) => unwrap(window.api.win.openDetail(a)),
  winOpenSearch: (term: string, profileId?: string, allProfiles = true) => unwrap(window.api.win.openSearch({ term, profileId, allProfiles })),
  winRouteReady: () => unwrap(window.api.win.routeReady()),
  winReportError: (message: string) => unwrap(window.api.win.reportError(message)),
  winOnNavigate: (cb: (route: string) => void) => window.api.win.onNavigate(cb),
  appQuit: () => unwrap(window.api.system.quit()),
  /** ★ 2026-09-30：本次主进程启动的会话标识（渲染层判定「新一次启动」→ 丢页面状态类记忆） */
  systemSessionId: () => unwrap(window.api.system.sessionId()),
  playerOpen: (init: unknown) => unwrap(window.api.player.open(init)),
  playerSwitchEp: async (request: number | import('../../shared/playerEpisode').PlayerEpisodeSwitch) =>
    (await unwrap(window.api.player.switchEp(request))).switched,
  /** ★ 2026-09-30：播放器窗口订阅就绪 → 重发最新 init（修新窗口「等待播放…」竞态） */
  playerReady: () => unwrap(window.api.player.ready()),
  playerIsOpen: () => unwrap(window.api.player.isOpen()),
  playerClose: () => unwrap(window.api.player.close()),
  playerOnInit: (cb: (init: unknown) => void) => window.api.player.onInit(cb),
  playerOnSwitchEp: (cb: (epIndex: number) => void) => window.api.player.onSwitchEp(cb),
  playerSetMini: (isMini: boolean) => unwrap(window.api.player.setMini(isMini)),
  playerIsMini: () => unwrap(window.api.player.isMini()),
  playerSetFullscreen: (fullscreen: boolean) => unwrap(window.api.player.setFullscreen(fullscreen)),
  playerIsFullscreen: () => unwrap(window.api.player.isFullscreen()),
  playerSetResizable: (resizable: boolean) => unwrap(window.api.player.setResizable(resizable)),
  playerOnMini: (cb: (mini: boolean) => void) => window.api.player.onMini(cb),
  playerOnFullscreen: (cb: (fullscreen: boolean) => void) => window.api.player.onFullscreen(cb),
  /** ★ 2026-10-17（B3）：播放器窗口开/关 → 主窗口据此冻结/解冻隐藏页的已解码图片（零重载） */
  playerOnWindowState: (cb: (open: boolean) => void) => window.api.player.onWindowState((s) => cb(!!s?.open)),
  /** ★ 2026-10-18（R10）：L4 插件 `winbox.player.*` 转发事件（播放器窗口渲染层执行；不带 `MPV_` 前缀） */
  onPlayerCtl: (cb: (a: { op: string; value?: unknown }) => void) => window.api.player.onCtl(cb),
  /** ★ 2026-10-16（用户报「播放时画面突然消失、只剩声音」）：播放诊断上报（fire-and-forget；见 main/util/mediaDiag.ts） */
  mediaReport: (ev: MediaStateEvent) => window.api.media.report(ev),
  bossGet: () => unwrap(window.api.boss.get()),
  bossSet: (patch: Partial<BossKeySettings>) => unwrap(window.api.boss.set(patch)),
  bossOnEnter: (cb: () => void) => window.api.boss.onEnter(cb),
  bossOnExit: (cb: () => void) => window.api.boss.onExit(cb),
  mergeExport: (ids: string[]) => unwrap(window.api.merge.export(ids)),
  mergeSave: (a: { content: string; defaultName?: string }) => unwrap(window.api.merge.save(a)),
  // 夸克落盘文件清理（播放页/播放器页卸载、窗口关闭时触发）
  quarkCleanup: () => unwrap(window.api.quark.cleanup()),
  // ★ 播放偏好（m3u8 去广告开关；配置页读写，本地中继 /play 即时生效）
  playerPrefsGet: () => unwrap(window.api.playerPrefs.get()),
  playerPrefsSet: (patch: Partial<PlayerSettings>) => unwrap(window.api.playerPrefs.set(patch)),
  driveGet: () => unwrap(window.api.drives.get()),
  driveSet: (provider: string, token: string) => unwrap(window.api.drives.set({ provider, token })),
  driveRemove: (provider: string) => unwrap(window.api.drives.remove(provider)),
  driveQrCreate: (provider?: string) => unwrap(window.api.drives.qrCreate(provider)),
  driveQrPoll: (provider: string, sid: string) => unwrap(window.api.drives.qrPoll(provider, sid)),
  driveWebLogin: (provider: string) => unwrap(window.api.drives.webLogin(provider)),
  ucTvStatus: () => unwrap(window.api.drives.ucTvStatus()),
  ucTvQrCreate: () => unwrap(window.api.drives.ucTvQrCreate()),
  ucTvQrPoll: () => unwrap(window.api.drives.ucTvQrPoll()),
  ucTvRemove: () => unwrap(window.api.drives.ucTvRemove()),
  home: (key: string, profileId?: string, signal?: AbortSignal) =>
    invokeVodRequestWithCancellation(signal, (requestId) => window.api.vod.home(key, profileId, requestId),
      (requestId) => window.api.vod.cancelHome(requestId)),
  category: (a: { key: string; tid: string; pg: string; extend?: Record<string, string>; profileId?: string }, signal?: AbortSignal) =>
    invokeVodRequestWithCancellation(signal, (requestId) => window.api.vod.category({ ...a, requestId }),
      (requestId) => window.api.vod.cancelCategory(requestId)),
  detail: (a: { key: string; ids: string[]; profileId?: string }) => unwrap(window.api.vod.detail(a)),
  search: (a: { key: string; wd: string; profileId?: string }, signal?: AbortSignal) =>
    invokeVodRequestWithCancellation(signal, (requestId) => window.api.vod.search({ ...a, requestId }),
      (requestId) => window.api.vod.cancelSearch(requestId)),
  searchAll: (wd: string, opts?: { refresh?: boolean; profileId?: string; profileIds?: string[] }, signal?: AbortSignal) =>
    invokeVodRequestWithCancellation(signal, (requestId) => window.api.vod.searchAll(wd, opts, requestId),
      (requestId) => window.api.vod.cancelSearchAll(requestId)),
  onSearchAllProgress: (cb: (ev: SearchAllProgressEvent) => void) => window.api.vod.onSearchAllProgress(cb as (ev: unknown) => void),
  play: (a: { key: string; flag: string; id: string; profileId?: string; parseOffset?: number }) => unwrap(window.api.vod.play(a)),
  loadLive: (index: number) => unwrap(window.api.live.load(index)),
  liveMeta: () => unwrap(window.api.live.meta()),
  liveEpg: (index: number, channels: EpgChannelRef[]) => unwrap(window.api.live.epg(index, channels)),
  liveTemplates: () => unwrap<LiveTemplateView[]>(window.api.live.templates()),
  liveRender: (a: { templateId: string; groups: LiveGroup[] }) =>
    unwrap<LiveTemplateView & { content: string }>(window.api.live.render(a)),
  liveExport: (a: { templateId: string; groups: LiveGroup[]; defaultName?: string }) =>
    unwrap<{ saved: boolean; path: string }>(window.api.live.export(a)),
  /** ★ 2026-09-29 设置备份 */
  backupExport: (renderer: Record<string, string>) => unwrap(window.api.backup.export(renderer)),
  backupImport: () => unwrap(window.api.backup.import()),
  backupCommit: (restoreId: string) => afterConfigMutation<void>(window.api.backup.commit(restoreId)),
  backupCancel: (restoreId: string) => unwrap<void>(window.api.backup.cancel(restoreId)),
  /** ★ 2026-09-29 WebDAV 存储（只读） */
  davList: () => unwrap(window.api.dav.list()),
  davSet: (s: DavServer) => unwrap(window.api.dav.set(s)),
  davTest: (s: DavServer) => unwrap(window.api.dav.test(s)),
  davRemove: (id: string) => unwrap(window.api.dav.remove(id)),
  davBrowse: (a: { id: string; path?: string }) => unwrap(window.api.dav.browse(a)),
  davOpenExternal: (url: string) => unwrap(window.api.dav.openExternal(url)),
  /** ★ 2026-09-29 DLNA 投屏 */
  dlnaDiscover: () => unwrap(window.api.dlna.discover()),
  dlnaCast: (a: { device: DlnaDevice; target: DlnaCastTarget }) => unwrap(window.api.dlna.cast(a)),
  subtitleGet: () => unwrap(window.api.subtitle.get()),
  subtitleSet: (patch: Partial<SubtitleSettings>) => unwrap(window.api.subtitle.set(patch)),
  /** ★ 2026-09-28：各字幕源的开关/可用状态（配置页渲染） */
  subtitleProviders: () =>
    unwrap(window.api.subtitle.providers()) as Promise<SubtitleProviderView[]>,
  /** ★ 2026-09-28：多源聚合检索 → { candidates, providers }（providers 说明逐源状态，用于空结果提示） */
  subtitleSearch: (name: string) =>
    unwrap(window.api.subtitle.search(name)) as Promise<SubtitleSearchReport>,
  /** ★ 2026-09-24：返回 { text, fileName, format, entries, reason } —— 用真实字幕文件名判定格式 */
  subtitleFetch: (cand: SubtitleCandidate) =>
    unwrap(window.api.subtitle.fetch(cand)) as Promise<SubtitleFetchResult>,
  danmakuGet: () => unwrap(window.api.danmaku.get()),
  danmakuSet: (patch: Partial<DanmakuSettings>) => unwrap(window.api.danmaku.set(patch)),
  danmakuSearch: (name: string, season?: number) => unwrap(window.api.danmaku.search(name, season)),
  danmakuEpisodes: (bangumiId: number, animeTitle: string | undefined, source: string) =>
    unwrap(window.api.danmaku.episodes(bangumiId, animeTitle, source)),
  danmakuFetch: (episodeId: number, source: string) => unwrap(window.api.danmaku.fetch(episodeId, source)),
  onDanmakuRealtime: (cb: (data: { text: string }) => void) => window.api.danmaku.onRealtime?.(cb) ?? (() => undefined),
  // TMDB 元数据补全（缺封面/缺简介兜底，凭据内置密文）
  metaSearch: (name: string, year?: string, provider?: 'tmdb' | 'douban') => unwrap(window.api.meta.search(name, year, provider)),
  /** ★ 详情页增强：演职员/类型/相关推荐 */
  metaExtra: (name: string, year?: string) => unwrap(window.api.meta.extra(name, year)),
  /** ★ 发现页榜单（无源默认主页；refresh 绕过 6h 缓存） */
  metaDiscover: (refresh?: boolean) => unwrap(window.api.meta.discover(refresh)),
  metaBoardPage: (id: string, page: number, refresh?: boolean) => unwrap(window.api.meta.boardPage(id, page, refresh)),
  metaMovieHot: () => unwrap(window.api.meta.movieHot()),
  metaDiscoverImages: (name: string, mediaType: 'movie' | 'tv', year?: string, kind?: 'backdrop' | 'poster', doubanId?: string) => unwrap(window.api.meta.discoverImages(name, mediaType, year, kind, doubanId)),
  /** ★ 发现页「分类」：TMDB 类型清单 */
  metaGenres: () => unwrap(window.api.meta.genres()),
  /** ★ 发现页「分类」：按类型取一页 */
  metaGenrePage: (mediaType: 'movie' | 'tv', genreId: number, page: number) => unwrap(window.api.meta.genrePage(mediaType, genreId, page)),
  /** ★ 2026-10-15（级联分类）：发现页「分类浏览」取一页（豆瓣 recommend） */
  metaDiscoverQuery: (q: ExploreQuery) => unwrap(window.api.meta.discoverQuery(q)),
  /** ★ 2026-10-15（级联分类）：级联词表（发现页 / 点播页共用同一份选项） */
  metaExploreVocab: () => unwrap(window.api.meta.exploreVocab()),
  /** ★ 2026-09-24：元数据来源配置（读取返回能力布尔 + 用户自填值，**绝不含内置密文**） */
  metaGetSettings: () => unwrap(window.api.meta.getSettings()),
  metaSetSettings: (patch: Partial<MetaSettings>) => unwrap(window.api.meta.setSettings(patch)),
  /** ★ 搜索面板联想（TMDB / 豆瓣，随来源策略） */
  metaSuggest: (q: string) => unwrap(window.api.meta.suggest(q)),
  /** ★ 发现页 Hero 轮播：横版剧照（≤6）/ 竖版海报（≤8），已包装 /img 中继 */
  metaImages: (mediaType: 'movie' | 'tv', tmdbId: number) => unwrap(window.api.meta.images(mediaType, tmdbId)),
  netSpeed: (cb: (kbs: number) => void) => window.api.net.onSpeed(cb),
  /** ★ 2026-10-08 MPV 高兼容播放内核：探活/路径、启停、控制命令、状态事件（仅独立播放器窗口用） */
  mpvStatus: () => unwrap<MpvStatus>(window.api.mpv.status()),
  mpvStart: (opts: MpvStartOptions) => unwrap<{ session: number; path: string }>(window.api.mpv.start(opts)),
  mpvCmd: (cmd: MpvCommand) => unwrap<{ ok: boolean }>(window.api.mpv.cmd(cmd)),
  mpvStop: () => unwrap<{ ok: boolean }>(window.api.mpv.stop()),
  mpvOnState: (cb: (s: MpvStateEvent) => void) => window.api.mpv.onState(cb as (s: unknown) => void),
  mediaRuntimeStatus: () => unwrap<MediaRuntimeStatus>(window.api.mediaRuntime.status()),
  mediaRuntimeInstall: (runtime: MediaRuntimeId) => unwrap<MediaRuntimeStatus>(window.api.mediaRuntime.install(runtime)),
  mediaRuntimeCancel: () => unwrap<boolean>(window.api.mediaRuntime.cancel()),
  mediaRuntimeOnProgress: (cb: (progress: MediaRuntimeProgress) => void) =>
    window.api.mediaRuntime.onProgress(cb as (progress: MediaRuntimeProgress) => void),
  // ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`；宿主托管，插件只给描述符）
  /** 内置 2（html5/mpv）+ 插件 N（`engine:<contributeId>`）—— 配置页内核列表 / 播放器切换按钮用 */
  engineList: () => unwrap<PlayerEngineView[]>(window.api.engine.list()),
  engineStatus: (id: string) => unwrap<{ id: string; ready: boolean; path?: string; note?: string }>(window.api.engine.status(id)),
  /** 写启用开关（默认关；首次开启的二次确认在渲染层做） */
  engineSetEnabled: (a: { id: string; enabled: boolean }) => unwrap<{ ok: boolean; reason?: string }>(window.api.engine.setEnabled(a)),
  /** 拉起引擎会话（★ 未启用 → 返回 `{ok:false, reason}`，不抛） */
  engineStart: (a: MpvStartOptions & { engineId: string }) =>
    unwrap<{ ok: boolean; reason?: string; session?: number }>(window.api.engine.start(a)),
  engineCmd: (cmd: MpvCommand) => unwrap<{ ok: boolean }>(window.api.engine.cmd(cmd)),
  engineStop: () => unwrap<{ ok: boolean }>(window.api.engine.stop()),
  engineOnState: (cb: (s: MpvStateEvent) => void) => window.api.engine.onState(cb as (s: unknown) => void),
  // ★ 2026-10-16 插件系统（M1）：列表 / 安装（两段式）/ 卸载 / 启停 / 超分状态
  pluginList: () => unwrap<PluginView[]>(window.api.plugins.list()),
  /** ★ 2026-10-18（R10）安装第 ① 段：干跑校验 → 权限清单（不落盘） */
  pluginInspect: () => unwrap<PluginInspectResult>(window.api.plugins.inspect()),
  pluginInstall: (a?: { path?: string }) =>
    unwrap<{ ok: boolean; canceled?: boolean; reason?: string; items?: PluginView[] }>(window.api.plugins.install(a)),
  pluginUninstall: (id: string) => unwrap<{ ok: boolean; reason?: string; items?: PluginView[] }>(window.api.plugins.uninstall(id)),
  pluginSetEnabled: (a: { id: string; enabled: boolean }) =>
    unwrap<{ ok: boolean; reason?: string; items?: PluginView[] }>(window.api.plugins.setEnabled(a)),
  pluginSr: () => unwrap<SrState>(window.api.plugins.sr()),
  /** ★ 插件皮肤列表（`contributes.theme`）—— 渲染层注册表据此并入可选皮肤 */
  pluginThemes: () => unwrap<ThemeSkinView[]>(window.api.plugins.themes()),
  /** ★ 2026-10-18 插件受限动作按钮（`contributes.ui.command`）—— 配置页 / 播放器据此渲染 */
  pluginCommands: () => unwrap<UiCommandView[]>(window.api.plugins.commands()),
  /** ★ 2026-10-18 追加快捷键（`contributes.keymap`）—— 配置页一览 / 播放器键位面板 + 渲染层分发 */
  pluginKeymaps: () => unwrap<KeymapView[]>(window.api.plugins.keymaps()),
  /** ★ 2026-10-18 插件设置面板（`contributes.settings.panel`）—— 配置页每插件卡片内渲染表单 */
  pluginSettings: () => unwrap<SettingsPanelView[]>(window.api.plugins.settings()),
  /** ★ 写一个设置字段值（宿主代持久化 + 值校验；成功时回带最新面板列表） */
  pluginSettingSet: (a: { id: string; panelId: string; key: string; value: unknown }) =>
    unwrap<{ ok: boolean; reason?: string; panels?: SettingsPanelView[] }>(window.api.plugins.setSetting(a)),
  /** ★ 2026-10-18 受限 UI 槽位（`contributes.ui.slot`）—— 渲染层 `<PluginSlot slot="…" />` 消费 */
  pluginSlots: () => unwrap<UiSlotView[]>(window.api.plugins.slots()),
  /** ★ 2026-09-29 磁力（BT）：探测本机外部播放器（MKV/HEVC 接力；配置页可指定路径） */
  btDetectPlayers: () => unwrap(window.api.bt.detectPlayers()),
  /** ★ 2026-09-30（用户要求）：点播外部播放器（与磁力分开绑定）——探测本机播放器 / 用当前地址拉起 */
  vodDetectPlayers: () => unwrap(window.api.vod.detectPlayers()),
  /** `seek`（秒）：显式绑定外部播放器时，从历史续播的位置（按播放器类型拼起播参数） */
  vodOpenExternal: (url: string, path?: string, seek?: number) => unwrap(window.api.vod.openExternal({ url, path, seek })),
  /** ★ 2026-09-29 启动更新：检查 / 下载 / 拉起安装程序（进度走 onUpdateProgress） */
  updateCheck: () => unwrap(window.api.update.check()),
  updateDownload: () => unwrap(window.api.update.download()),
  updateCancel: () => unwrap(window.api.update.cancel()),
  updateInstall: () => unwrap(window.api.update.install()),
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => window.api.update.onProgress(cb),
  /** ★ 2026-10-16（用户要求「自适应屏幕分辨率调节窗口大小与字体大小」）：界面缩放读/写 */
  uiGetScale: () => unwrap(window.api.ui.getScale()),
  uiSetScale: (v: UiScalePref) => unwrap(window.api.ui.setScale(v)),
  onUiScaleChanged: (cb: (state: UiScaleState) => void) => window.api?.ui?.onScaleChanged?.(cb) || (() => undefined),
  /** ★ 网络代理设置（DNS 污染 / SNI 阻断站点用） */
  proxyGet: () => unwrap<{ enabled: boolean; url: string }>(window.api.net.proxyGet()),
  proxySet: (patch: { enabled?: boolean; url?: string }) =>
    unwrap<{ enabled: boolean; url: string }>(window.api.net.proxySet(patch)),
};
