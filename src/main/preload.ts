// src/main/preload.ts — contextBridge 暴露 window.api
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcResult } from '../shared/ipc-result';
import { IPC } from '../shared/ipc-channels';
import type { SiteConfig, ImportReport, SourceBean, SourceMoveDirection, SourceUpdatePatch, UserConfig, UserProfile, SubscriptionImportProgressEvent, SubscriptionRefreshResolution, MetaHit, MetaExtra, DiscoverSection, DiscoverGenre, DiscoverGenrePage, MetaImages } from '../shared/types';
import type { SubtitleFetchResult } from '../shared/subtitle';
import type { MetaSettings, MetaSettingsView, MetaSuggestion } from '../shared/meta';
import type { UiPreferencesPatch, UiPreferencesSnapshot } from '../shared/uiPreferences';
import type { ExploreQuery, ExplorePage, ExploreVocabulary } from '../shared/discover';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  system: {
    ping: () => invoke<string>(IPC.SYSTEM_PING),
    icon: () => invoke<string>(IPC.APP_ICON),
    quit: () => invoke<void>(IPC.APP_QUIT),
    dataDir: () => invoke(IPC.SYSTEM_DATA_DIR),
    sessionId: () => invoke<string>(IPC.SYSTEM_SESSION_ID),
    getUiPreferences: () => invoke<UiPreferencesSnapshot>(IPC.UI_PREFERENCES_GET),
    initializeUiPreferences: (legacy: UiPreferencesPatch) => invoke<UiPreferencesSnapshot>(IPC.UI_PREFERENCES_INITIALIZE, legacy),
    updateUiPreferences: (patch: UiPreferencesPatch) => invoke<UiPreferencesSnapshot>(IPC.UI_PREFERENCES_UPDATE, patch),
    onUiPreferencesChanged: (cb: (snapshot: UiPreferencesSnapshot) => void) => {
      const listener = (_event: unknown, snapshot: UiPreferencesSnapshot) => cb(snapshot);
      ipcRenderer.on(IPC.UI_PREFERENCES_CHANGED, listener);
      return () => ipcRenderer.removeListener(IPC.UI_PREFERENCES_CHANGED, listener);
    },
  },
  config: {
    import: (args: { url?: string; json?: string }) => invoke(IPC.CONFIG_IMPORT, args),
    listSites: () => invoke(IPC.CONFIG_LIST_SITES),
    diagnose: () => invoke(IPC.CONFIG_DIAGNOSE),
    cfgGet: () => invoke<UserConfig>(IPC.CFG_GET),
    addSource: (bean: SourceBean) => invoke<SourceBean>(IPC.CFG_ADD_SOURCE, bean),
    updateSource: (key: string, patch: SourceUpdatePatch) => invoke<SourceBean>(IPC.CFG_UPDATE_SOURCE, { key, patch }),
    deleteSource: (key: string) => invoke<void>(IPC.CFG_DELETE_SOURCE, key),
    deleteSources: (keys: string[]) => invoke<void>(IPC.CFG_DELETE_SOURCES, keys),
    moveSource: (key: string, direction: SourceMoveDirection) => invoke<void>(IPC.CFG_MOVE_SOURCE, { key, direction }),
    setActiveSource: (key: string) => invoke<void>(IPC.CFG_SET_ACTIVE_SOURCE, key),
    setActiveLive: (index: number) => invoke<void>(IPC.CFG_SET_ACTIVE_LIVE, index),
    importUrl: (url: string, name?: string) => invoke(IPC.CFG_IMPORT_URL, { url, name }),
    startSubscriptionImport: (url: string, name?: string) =>
      invoke<SubscriptionImportProgressEvent>(IPC.CFG_IMPORT_JOB_START, { url, name }),
    cancelSubscriptionImport: (jobId: string) =>
      invoke<SubscriptionImportProgressEvent>(IPC.CFG_IMPORT_JOB_CANCEL, jobId),
    retryFailedSubscriptionImport: (jobId: string) =>
      invoke<SubscriptionImportProgressEvent>(IPC.CFG_IMPORT_JOB_RETRY, jobId),
    continueSubscriptionImport: (jobId: string) =>
      invoke<SubscriptionImportProgressEvent>(IPC.CFG_IMPORT_JOB_CONTINUE, jobId),
    getSubscriptionImport: (jobId: string) =>
      invoke<SubscriptionImportProgressEvent | null>(IPC.CFG_IMPORT_JOB_GET, jobId),
    listSubscriptionImports: () =>
      invoke<SubscriptionImportProgressEvent[]>(IPC.CFG_IMPORT_JOB_LIST),
    resumeSubscriptionImport: (jobId: string) =>
      invoke<SubscriptionImportProgressEvent>(IPC.CFG_IMPORT_JOB_RESUME, jobId),
    removeSubscriptionGroupMember: (groupId: string, memberId: string) =>
      invoke<void>(IPC.CFG_SUBSCRIPTION_GROUP_REMOVE_MEMBER, { groupId, memberId }),
    resolveSubscriptionGroupRefresh: (groupId: string, memberId: string, resolution: SubscriptionRefreshResolution) =>
      invoke<void>(IPC.CFG_SUBSCRIPTION_GROUP_RESOLVE_REFRESH, { groupId, memberId, resolution }),
    onSubscriptionImportProgress: (cb: (event: SubscriptionImportProgressEvent) => void) => {
      const listener = (_event: unknown, value: SubscriptionImportProgressEvent) => cb(value);
      ipcRenderer.on(IPC.CFG_IMPORT_JOB_PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC.CFG_IMPORT_JOB_PROGRESS, listener);
    },
    // ★ 2026-09-27（用户要求）：本地 .json 订阅文件导入（文件选择器；档案名默认取原始文件名）
    importJsonLocal: (name?: string) =>
      invoke<{
        ok: boolean;
        file?: string;
        name?: string;
        error?: string;
        result?: { config: SiteConfig; report: ImportReport; warnings: string[]; urls?: { name: string; url: string }[] };
      }>(IPC.CFG_IMPORT_JSON_LOCAL, name),
    importPyLocal: () => invoke<{ ok: boolean; key?: string; keys?: string[]; imported?: number; failed?: { name: string; error: string }[]; error?: string }>(IPC.CFG_IMPORT_PY_LOCAL),
    /**
     * ★ 2026-09-30（用户要求）：导入**本地 TXT / M3U 直播源**（配置页按钮）。
     * ★ 2026-10-14：改为**两步导入**（对齐本地包命名流程）——
     *   首次调用（不传 path）：选文件 + 校验 + 落盘，返回 `{ needsName:true, path, name }`；
     *   二次调用（传 path + name）：以用户命名登记线路，返回命中下标。
     */
    importLiveLocal: (args?: { name?: string; path?: string }) =>
      invoke<{ ok: boolean; needsName?: boolean; path?: string; name?: string; index?: number; replaced?: boolean; total?: number; error?: string }>(IPC.CFG_IMPORT_LIVE_LOCAL, args),
    /** ★ 2026-10-14（用户要求）：删除某条直播线路（下标） */
    deleteLive: (index: number) => invoke<void>(IPC.CFG_DELETE_LIVE, index),
    /** ★ 2026-10-16（用户要求）：批量删除直播线路（下标数组） */
    deleteLives: (indices: number[]) => invoke<void>(IPC.CFG_DELETE_LIVES, indices),
    /** ★ 2026-10-14（用户要求）：重命名某条直播线路 */
    updateLive: (a: { index: number; name: string }) => invoke<void>(IPC.CFG_UPDATE_LIVE, a),
    /**
     * ★ 2026-09-29（用户要求）：导入**本地包**（含 影视.json 与 py/js/jar/html 等子目录的目录包）。
     * 选目录 → 登记包根 → 包内相对引用展开 → 走正常订阅导入（档案 apiUrl 记 pkg://<i>/<rel>）。
     */
    importPackage: (args?: { name?: string; root?: string }) =>
      invoke<{
        ok: boolean;
        root?: string;
        rel?: string;
        sites?: number;
        name?: string;
        needsName?: boolean;
        error?: string;
        warnings?: string[];
        result?: { config: SiteConfig; report: ImportReport; warnings: string[]; urls?: { name: string; url: string }[] };
      }>(IPC.CFG_IMPORT_PACKAGE, args),
    /** ★ 2026-09-29 本地包「网页源」：在独立窗口打开 homePage html（fm 桥注入 window.fm） */
    webHomeOpen: (init: { url: string; title?: string; site?: Record<string, string | undefined> }) =>
      invoke<{ ok: boolean; error?: string }>(IPC.WEBHOME_OPEN, init),
    saveAsProfile: (name: string) => invoke<UserProfile>(IPC.CFG_PROFILE_SAVE, name),
    activateProfile: (id: string) => invoke<void>(IPC.CFG_PROFILE_ACTIVATE, id),
    deleteProfile: (id: string) => invoke<void>(IPC.CFG_PROFILE_DELETE, id),
    updateProfileName: (a: { id: string; name: string }) => invoke<void>(IPC.CFG_PROFILE_UPDATE_NAME, a),
    cfgProfiles: () => invoke(IPC.CFG_PROFILES),
    /** ★ 2026-09-30（用户要求）：换源弹层「左订阅 / 右源」——每份档案的源 key/name 清单 */
    profileSites: () => invoke(IPC.CFG_PROFILE_SITES),
    profileSources: (profileId: string) => invoke<SourceBean[]>(IPC.CFG_PROFILE_SOURCES, profileId),
    /** ★ 2026-09-30（用户要求）：一步完成「切换档案 + 选中该档案下的源」 */
    switchProfileSource: (a: { profileId: string; key: string }) => invoke<void>(IPC.CFG_SWITCH_PROFILE_SOURCE, a),
    vodDebug: (key: string) => invoke(IPC.VOD_DEBUG, key),
    audit: () => invoke(IPC.VOD_AUDIT),
    cacheClear: () => invoke<{ freedBytes: number; cleared: string[]; failed: string[] }>(IPC.CACHE_CLEAR),
    // ★ 2026-09-27：已学到的「需要网盘绑定」源 key（源主页显示绑定入口的兜底判据，见 needsDriveBind）
    driveBindKeys: () => invoke<string[]>(IPC.DRIVE_BIND_KEYS),
    // ★ 播放网盘资源未绑定 cookie → 请求主窗口跳到「点播页」（源主页有「网盘绑定」入口）
    gotoDriveBind: () => invoke<void>(IPC.UI_GOTO_DRIVE_BIND),
    // 主窗口接收跨窗口跳转指令（播放器窗口发起时主进程转发到主窗口）
    onNavDriveBind: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on(IPC.NAV_DRIVE_BIND, l);
      return () => ipcRenderer.removeListener(IPC.NAV_DRIVE_BIND, l);
    },
  },
  vod: {
    home: (key: string, profileId?: string) => invoke(IPC.VOD_HOME, { key, profileId }),
    category: (a: { key: string; tid: string; pg: string; extend?: Record<string, string>; profileId?: string }) => invoke(IPC.VOD_CATEGORY, a),
    detail: (a: { key: string; ids: string[]; profileId?: string }) => invoke(IPC.VOD_DETAIL, a),
    search: (a: { key: string; wd: string; profileId?: string }) => invoke(IPC.VOD_SEARCH, a),
    /** ★ opts.refresh=true 忽略本地缓存强制重搜（UI「重新搜索」）；缺省命中 5 分钟缓存即秒回 */
    searchAll: (wd: string, opts?: { refresh?: boolean; profileId?: string; profileIds?: string[] }) => invoke(IPC.VOD_SEARCH_ALL, {
      wd,
      refresh: !!opts?.refresh,
      profileId: opts?.profileId,
      profileIds: opts?.profileIds,
    }),
    /**
     * ★ 聚合搜索逐源进度（边搜边出）：订阅后返回退订函数。
     * ★★ 2026-09-24 修复：本方法此前被错放在 `api.config` 下，而渲染层调用的是
     *   `window.api.vod.onSearchAllProgress` → 调用即抛 TypeError（且在 doSearch 的 try 之外）
     *   → `client.searchAll` 从未执行、`loading` 永远为 true → 界面卡在「正在逐源检索…」，
     *   用户侧表现就是「全源搜索搜不出来」。必须挂在 vod 组内。
     */
    onSearchAllProgress: (cb: (ev: unknown) => void) => {
      const l = (_e: unknown, ev: unknown) => cb(ev);
      ipcRenderer.on(IPC.VOD_SEARCH_ALL_PROGRESS, l);
      return () => { ipcRenderer.removeListener(IPC.VOD_SEARCH_ALL_PROGRESS, l); };
    },
    play: (a: { key: string; flag: string; id: string; profileId?: string }) => invoke(IPC.VOD_PLAY, a),
    // ★ 2026-09-30（用户要求）：点播外部播放器（与磁力分开绑定）——探测本机播放器 / 用当前地址拉起
    detectPlayers: () => invoke<Array<{ id: string; name: string; path: string }>>(IPC.VOD_DETECT_PLAYERS),
    // ★ 2026-09-30（用户要求）：`seek`（秒）—— 从历史续播时按播放器类型拼起播参数
    openExternal: (a: { url: string; path?: string; seek?: number }) =>
      invoke<{ ok: boolean; player?: string; error?: string }>(IPC.VOD_OPEN_EXTERNAL, a),
  },
  live: {
    load: (index: number) => invoke(IPC.LIVE_LOAD, index),
    meta: () => invoke('live:meta'),
    /** ★ 2026-09-29 EPG：传入该线路的频道引用（tvg-id/tvg-name/频道名/频道级 epg），返回各键的当前/下一档 */
    epg: (index: number, channels: unknown) => invoke(IPC.LIVE_EPG, { index, channels }),
  },
  /** ★ 2026-09-29 设置备份：导出（含渲染层 localStorage）/ 导入（返回需写回的 localStorage） */
  backup: {
    export: (renderer: unknown) => invoke(IPC.BACKUP_EXPORT, renderer),
    import: () => invoke(IPC.BACKUP_IMPORT),
  },
  /** ★ 2026-09-29 WebDAV 存储（只读）：服务器管理 + 目录浏览 + 外部播放器接力 */
  dav: {
    list: () => invoke(IPC.DAV_LIST),
    set: (s: unknown) => invoke(IPC.DAV_SET, s),
    remove: (id: string) => invoke(IPC.DAV_REMOVE, id),
    browse: (a: { id: string; path?: string }) => invoke(IPC.DAV_BROWSE, a),
    openExternal: (url: string) => invoke(IPC.DAV_OPEN_EXTERNAL, url),
  },
  /** ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作） */
  dlna: {
    discover: () => invoke(IPC.DLNA_DISCOVER),
    cast: (a: unknown) => invoke(IPC.DLNA_CAST, a),
  },
  subtitle: {
    get: () => invoke(IPC.SUBTITLE_GET),
    set: (patch: unknown) => invoke(IPC.SUBTITLE_SET, patch),
    /** ★ 2026-09-28：各字幕源的开关与可用状态（配置页渲染 + 空结果原因说明） */
    providers: () => invoke(IPC.SUBTITLE_PROVIDERS),
    // ★ 2026-09-28：返回 { candidates, providers }（多源聚合；providers 说明每个源的状态/原因）
    search: (name: string) => invoke(IPC.SUBTITLE_SEARCH, name),
    // ★ 2026-09-24：返回 { text, fileName, format, entries, reason }（压缩包已在主进程解出并挑好条目）
    fetch: (cand: unknown) => invoke<SubtitleFetchResult>(IPC.SUBTITLE_FETCH, cand),
  },
  danmaku: {
    get: () => invoke(IPC.DANMAKU_GET),
    set: (patch: unknown) => invoke(IPC.DANMAKU_SET, patch),
    search: (name: string, season?: number) => invoke(IPC.DANMAKU_SEARCH, name, season),
    episodes: (bangumiId: number, animeTitle?: string, source?: string) => invoke(IPC.DANMAKU_EPISODES, bangumiId, animeTitle, source),
    // ★ 2026-09-26：source = 接口基础地址
    fetch: (episodeId: number, source?: string) => invoke(IPC.DANMAKU_FETCH, episodeId, source),
  },
  meta: {
    // 元数据补全；TMDB 仅在用户配置凭据后启用。
    search: (name: string, year?: string, provider?: 'tmdb' | 'douban') => invoke<MetaHit | null>(IPC.META_SEARCH, name, year, provider),
    // ★ 详情页增强：演职员/类型/相关推荐（详情页下方区块）
    extra: (name: string, year?: string) => invoke<MetaExtra | null>(IPC.META_EXTRA, name, year),
    // ★ 发现页榜单（无源时的默认主页；refresh=true 绕过 6h 缓存）
    discover: (refresh?: boolean) => invoke<DiscoverSection[]>(IPC.META_DISCOVER, !!refresh),
    movieHot: () => invoke(IPC.META_MOVIE_HOT),
    discoverImages: (name: string, mediaType: 'movie' | 'tv', year?: string, kind?: 'backdrop' | 'poster', doubanId?: string) => invoke<MetaImages>(IPC.META_DISCOVER_IMAGES, name, mediaType, year, kind, doubanId),
    // 发现页分类随当前榜单来源切换。
    genres: () => invoke<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>(IPC.META_GENRES),
    genrePage: (mediaType: 'movie' | 'tv', genreId: number, page: number) =>
      invoke<DiscoverGenrePage>(IPC.META_GENRE_PAGE, mediaType, genreId, page),
    // ★ 2026-10-15（级联分类）：发现页「分类浏览」（豆瓣 recommend，start 偏移分页）与级联词表
    discoverQuery: (q: ExploreQuery) => invoke<ExplorePage>(IPC.META_DISCOVER_QUERY, q),
    exploreVocab: () => invoke<ExploreVocabulary>(IPC.META_EXPLORE_VOCAB),
    // ★ 2026-09-24：元数据来源配置（TMDB 自填 Key/代理/镜像 + 策略）与搜索面板联想
    //   只读取用户自己的凭据；hasBuiltin 固定 false。
    getSettings: () => invoke<MetaSettingsView>(IPC.META_GET_SETTINGS),
    setSettings: (patch: Partial<MetaSettings>) => invoke<MetaSettingsView>(IPC.META_SET_SETTINGS, patch),
    suggest: (q: string) => invoke<MetaSuggestion[]>(IPC.META_SUGGEST, q),
    // ★ 发现页 Hero 轮播：某部片的横版剧照 / 竖版海报（TMDB images，已包装 /img 中继）
    images: (mediaType: 'movie' | 'tv', tmdbId: number) => invoke<MetaImages>(IPC.META_IMAGES, mediaType, tmdbId),
  },
  drives: {
    get: () => invoke(IPC.DRIVE_GET),
    set: (a: { provider: string; token: string }) => invoke(IPC.DRIVE_SET, a),
    remove: (provider: string) => invoke(IPC.DRIVE_REMOVE, provider),
    qrCreate: (provider?: string) => invoke(IPC.DRIVE_QR_CREATE, provider),
    qrPoll: (provider: string, sid: string) => invoke(IPC.DRIVE_QR_POLL, provider, sid),
    webLogin: (provider: string) => invoke(IPC.DRIVE_WEB_LOGIN, provider),
    ucTvStatus: () => invoke(IPC.DRIVE_UC_TV_STATUS),
    ucTvQrCreate: () => invoke(IPC.DRIVE_UC_TV_QR_CREATE),
    ucTvQrPoll: () => invoke(IPC.DRIVE_UC_TV_QR_POLL),
    ucTvRemove: () => invoke(IPC.DRIVE_UC_TV_REMOVE),
  },
  win: {
    minimize: () => invoke(IPC.WIN_MINIMIZE),
    maximize: () => invoke(IPC.WIN_MAXIMIZE),
    close: () => invoke(IPC.WIN_CLOSE),
    isMaximized: () => invoke<boolean>(IPC.WIN_IS_MAXIMIZED),
    // ★ 2026-09-30（用户要求）：播放器置顶按钮（按发起窗口生效；返回设置后的真实状态）
    setAlwaysOnTop: (on: boolean) => invoke<boolean>(IPC.WIN_SET_ALWAYS_ON_TOP, !!on),
    isAlwaysOnTop: () => invoke<boolean>(IPC.WIN_IS_ALWAYS_ON_TOP),
    // ★ 2026-10-08（用户要求）：详情页独立窗口（外观开关；已开则复用并通知换路由）
    openDetail: (a: { key: string; id: string; query?: string }) => invoke(IPC.WIN_OPEN_DETAIL, a),
    openSearch: (args: { term: string; profileId?: string }) => invoke(IPC.WIN_OPEN_SEARCH, args),
    routeReady: () => invoke(IPC.WIN_ROUTE_READY),
    reportError: (message: string) => invoke(IPC.WIN_REPORT_ERROR, message),
    onNavigate: (cb: (route: string) => void) => {
      const l = (_e: unknown, route: unknown) => cb(String(route || ''));
      ipcRenderer.on(IPC.WIN_NAVIGATE, l);
      return () => ipcRenderer.removeListener(IPC.WIN_NAVIGATE, l);
    },
  },
  net: {
    // 监听主进程推送的实时网速（KB/s，源于 /play 中继真实转发字节）
    onSpeed: (cb: (kbs: number) => void) => {
      const l = (_e: unknown, kbs: number) => cb(kbs);
      ipcRenderer.on('net:speed', l);
      return () => ipcRenderer.removeListener('net:speed', l);
    },
    // ★ 网络代理设置（DNS 污染 / SNI 阻断站点用）
    proxyGet: () => invoke(IPC.PROXY_GET),
    proxySet: (patch: { enabled?: boolean; url?: string }) => invoke(IPC.PROXY_SET, patch),
  },
  player: {
    open: (init: unknown) => invoke(IPC.PLAYER_OPEN, init),
    switchEp: (request: number | import('../shared/playerEpisode').PlayerEpisodeSwitch) => invoke<{ switched: boolean }>(IPC.PLAYER_SWITCH_EP, request),
    /** ★ 2026-09-30：渲染层订阅就绪 → 主进程重发最新 init（新窗口首推与订阅的竞态，见 PlayerWindow） */
    ready: () => invoke(IPC.PLAYER_READY),
    isOpen: () => invoke<{ open: boolean }>(IPC.PLAYER_IS_OPEN),
    close: () => invoke('player:close'),
    setMini: (isMini: boolean) => invoke<{ mini: boolean }>(IPC.PLAYER_SET_MINI, isMini),
    isMini: () => invoke<{ mini: boolean }>(IPC.PLAYER_IS_MINI),
    setFullscreen: (fullscreen: boolean) => invoke<{ fullscreen: boolean }>(IPC.PLAYER_SET_FULLSCREEN, fullscreen),
    isFullscreen: () => invoke<{ fullscreen: boolean }>(IPC.PLAYER_IS_FULLSCREEN),
    setResizable: (resizable: boolean) => invoke<{ resizable: boolean }>(IPC.PLAYER_SET_RESIZABLE, resizable),
    // 监听主进程推送：初始化数据 / 换集
    onInit: (cb: (init: unknown) => void) => {
      const l = (_e: unknown, init: unknown) => cb(init);
      ipcRenderer.on('player:init', l);
      return () => ipcRenderer.removeListener('player:init', l);
    },
    onSwitchEp: (cb: (epIndex: number) => void) => {
      const l = (_e: unknown, epIndex: number) => cb(epIndex);
      ipcRenderer.on('player:switchEp', l);
      return () => ipcRenderer.removeListener('player:switchEp', l);
    },
    // 小窗口模式切换（窗口尺寸由主进程变更，这里只同步状态）
    onMini: (cb: (mini: boolean) => void) => {
      const l = (_e: unknown, mini: boolean) => cb(!!mini);
      ipcRenderer.on('player:mini', l);
      return () => ipcRenderer.removeListener('player:mini', l);
    },
    onFullscreen: (cb: (fullscreen: boolean) => void) => {
      const l = (_e: unknown, fullscreen: boolean) => cb(!!fullscreen);
      ipcRenderer.on('player:fullscreen', l);
      return () => ipcRenderer.removeListener('player:fullscreen', l);
    },
  },
  /**
   * ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）：播放诊断上报（渲染层 → 主进程）。
   *   fire-and-forget（send/on）：不占 IPC 往返、播放路径零负担；主进程落盘并在 GPU 崩溃日志里带出。
   */
  media: { report: (ev: unknown) => ipcRenderer.send(IPC.MEDIA_STATE, ev) },
  boss: {
    get: () => invoke(IPC.BOSS_GET),
    set: (patch: unknown) => invoke(IPC.BOSS_SET, patch),
    // 老板键进入/退出：全应用窗口被隐藏/恢复（渲染层据此暂停静音/恢复播放）
    onEnter: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on('boss:enter', l);
      return () => ipcRenderer.removeListener('boss:enter', l);
    },
    onExit: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on('boss:exit', l);
      return () => ipcRenderer.removeListener('boss:exit', l);
    },
  },
  merge: {
    export: (ids: string[]) => invoke(IPC.CFG_MERGE_EXPORT, ids),
    save: (a: { content: string; defaultName?: string }) => invoke<{ saved: boolean; path: string }>(IPC.CFG_EXPORT_SAVE, a),
  },
  // 播放相关本地偏好（m3u8 去广告开关；改后本地中继 /play 即时生效）
  playerPrefs: {
    get: () => invoke(IPC.PLAYER_PREFS_GET),
    set: (patch: unknown) => invoke(IPC.PLAYER_PREFS_SET, patch),
  },
  // ★ 2026-10-08 MPV 高兼容播放内核（独立播放器窗口内嵌；状态经 MPV_STATE 事件推送）
  mpv: {
    status: () => invoke(IPC.MPV_STATUS),
    start: (opts: unknown) => invoke(IPC.MPV_START, opts),
    cmd: (cmd: unknown) => invoke(IPC.MPV_CMD, cmd),
    stop: () => invoke(IPC.MPV_STOP),
    onState: (cb: (s: unknown) => void) => {
      const l = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on(IPC.MPV_STATE, l);
      return () => ipcRenderer.removeListener(IPC.MPV_STATE, l);
    },
  },
  // ★ 2026-10-16 插件系统（M1）：列表 / 安装（主进程弹选择框）/ 卸载 / 启停 / 超分状态
  plugins: {
    list: () => invoke(IPC.PLUGIN_LIST),
    install: () => invoke(IPC.PLUGIN_INSTALL),
    uninstall: (id: string) => invoke(IPC.PLUGIN_UNINSTALL, id),
    setEnabled: (a: { id: string; enabled: boolean }) => invoke(IPC.PLUGIN_SET_ENABLED, a),
    sr: () => invoke(IPC.PLUGIN_SR),
  },
  // ★ 2026-09-29 磁力（BT）：探测本机已安装的外部播放器（MKV/HEVC 接力；只探测不启动）
  bt: {
    detectPlayers: () => invoke<Array<{ id: string; name: string; path: string }>>(IPC.BT_DETECT_PLAYERS),
  },
  /** ★ 2026-09-29 启动更新：检查 / 下载（进度事件）/ 拉起安装程序 */
  update: {
    check: () => invoke(IPC.UPDATE_CHECK),
    download: () => invoke(IPC.UPDATE_DOWNLOAD),
    install: () => invoke(IPC.UPDATE_INSTALL),
    onProgress: (cb: (p: unknown) => void) => {
      const l = (_e: unknown, p: unknown) => cb(p);
      ipcRenderer.on(IPC.UPDATE_PROGRESS, l);
      return () => ipcRenderer.removeListener(IPC.UPDATE_PROGRESS, l);
    },
  },
  quark: {
    // 夸克落盘文件清理（渲染层播放页/播放器页卸载、窗口关闭时触发）
    cleanup: () => invoke<void>(IPC.QUARK_CLEANUP),
  },
  /** ★ 2026-10-16（用户要求）：界面缩放（跟随屏幕/指定档位）—— 读状态 / 改档位 */
  ui: {
    getScale: () => invoke(IPC.UI_GET_SCALE),
    setScale: (v: string) => invoke(IPC.UI_SET_SCALE, v),
  },
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;
