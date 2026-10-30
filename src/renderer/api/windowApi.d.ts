// Renderer preload contract. Runtime wrappers live in client.ts.
import type { IpcResult } from '../../shared/ipc-result';
import type { DiscoverBoardPage } from '../../shared/discoverBoards';
import type {
  SiteConfig,
  ImportReport,
  SourceBean,
  VodItem,
  VodDetail,
  PlayResult,
  LiveGroup,
  LiveBean,
  EpgChannelRef,
  LiveEpgResult,
  UserConfig,
  SourceMoveDirection,
  SourceUpdatePatch,
  SearchAllReport,
  SearchAllProgressEvent,
  SourceDebugReport,
  UserProfile,
  ProfileSitesView,
  DataDirInfo,
  AuditItem,
  FilterGroup,
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
import type { DanmakuAnime, DanmakuCandidate, DanmakuSettings } from '../../shared/danmaku';
import type { MetaHit, MetaExtra, DiscoverSection, DiscoverGenre, DiscoverGenrePage, MetaImages, MovieHotList } from '../../shared/types';
import type { MetaSettings, MetaSettingsView, MetaSuggestion } from '../../shared/meta';
import type { ExploreQuery, ExplorePage, ExploreVocabulary } from '../../shared/discover';
import type { PlayerSettings, MpvStatus, MpvStartOptions, MpvCommand, MpvStateEvent, MediaStateEvent, MediaRuntimeId, MediaRuntimeStatus, MediaRuntimeProgress } from '../../shared/player';
import type { PluginView, PluginInspectResult, SrState, ThemeSkinView, LiveTemplateView, UiCommandView, KeymapView, SettingsPanelView, UiSlotView, PlayerEngineView } from '../../shared/plugin';
import type { BackupExportResult, BackupImportResult } from '../../shared/backup';
import type { PluginDialogReply, PluginDialogRequest } from '../../shared/pluginDialog';
import type { DavBrowseResult, DavServer } from '../../shared/webdav';
import type { DlnaCastResult, DlnaCastTarget, DlnaDevice } from '../../shared/dlna';
import type { UpdateCheckResult, UpdateProgress } from '../../shared/update';
import type { UiPreferencesPatch, UiPreferencesSnapshot } from '../../shared/uiPreferences';
import type { UiScalePref, UiScaleState } from '../../shared/uiScale';

export interface HomeResult {
  sortClasses: { id: string; name: string; flag?: string; filters?: FilterGroup[] }[];
  items: VodItem[];
  page: number;
  pagecount: number;
  total: number;
  sourceKey: string;
  /** true = 首页无推荐列表，已自动回退（homeVideoContent 或首个分类）取到内容 */
  homeFallback?: boolean;
  contentNotice?: string;
}

export interface ImportReturn {
  config: SiteConfig;
  report: ImportReport;
  warnings: string[];
  urls?: { name: string; url: string }[];
}

declare global {
  interface Window {
    api: {
      system: {
        ping: () => Promise<IpcResult<string>>;
        icon: () => Promise<IpcResult<string>>;
        quit: () => Promise<IpcResult<void>>;
        dataDir: () => Promise<IpcResult<DataDirInfo>>;
        sessionId: () => Promise<IpcResult<string>>;
        getUiPreferences: () => Promise<IpcResult<UiPreferencesSnapshot>>;
        initializeUiPreferences: (legacy: UiPreferencesPatch) => Promise<IpcResult<UiPreferencesSnapshot>>;
        updateUiPreferences: (patch: UiPreferencesPatch) => Promise<IpcResult<UiPreferencesSnapshot>>;
        onUiPreferencesChanged: (cb: (snapshot: UiPreferencesSnapshot) => void) => () => void;
      };
      config: {
        import: (a: { url?: string; json?: string }) => Promise<IpcResult<ImportReturn>>;
        listSites: () => Promise<IpcResult<SourceBean[]>>;
        diagnose: () => Promise<IpcResult<ImportReport | null>>;
        cfgGet: () => Promise<IpcResult<UserConfig>>;
        runtimeSyncStatus: () => Promise<IpcResult<ConfigRuntimeSyncStatus>>;
        retryRuntimeSync: () => Promise<IpcResult<ConfigRuntimeSyncRetryResult>>;
        addSource: (bean: SourceBean) => Promise<IpcResult<SourceBean>>;
        updateSource: (key: string, patch: SourceUpdatePatch) => Promise<IpcResult<SourceBean>>;
        deleteSource: (key: string) => Promise<IpcResult<void>>;
        deleteSources: (keys: string[], expectedProfileId?: string) => Promise<IpcResult<string[]>>;
        setGlobalSourceBlock: (keys: string[], blocked: boolean) => Promise<IpcResult<void>>;
        moveSource: (key: string, direction: SourceMoveDirection) => Promise<IpcResult<void>>;
        setActiveSource: (key: string) => Promise<IpcResult<void>>;
        setActiveLive: (index: number) => Promise<IpcResult<void>>;
        importUrl: (url: string, name?: string) => Promise<IpcResult<ImportReturn>>;
        startSubscriptionImport: (url: string, name?: string) => Promise<IpcResult<SubscriptionImportProgressEvent>>;
        cancelSubscriptionImport: (jobId: string) => Promise<IpcResult<SubscriptionImportProgressEvent>>;
        retryFailedSubscriptionImport: (jobId: string) => Promise<IpcResult<SubscriptionImportProgressEvent>>;
        continueSubscriptionImport: (jobId: string) => Promise<IpcResult<SubscriptionImportProgressEvent>>;
        getSubscriptionImport: (jobId: string) => Promise<IpcResult<SubscriptionImportProgressEvent | null>>;
        listSubscriptionImports: () => Promise<IpcResult<SubscriptionImportProgressEvent[]>>;
        resumeSubscriptionImport: (jobId: string) => Promise<IpcResult<SubscriptionImportProgressEvent>>;
        onSubscriptionImportProgress: (cb: (event: SubscriptionImportProgressEvent) => void) => () => void;
        removeSubscriptionGroupMember: (groupId: string, memberId: string) => Promise<IpcResult<void>>;
        resolveSubscriptionGroupRefresh: (groupId: string, memberId: string, resolution: SubscriptionRefreshResolution) => Promise<IpcResult<void>>;
        // ★ 2026-09-27：本地 .json 订阅文件导入（文件选择器；档案名默认取原始文件名）
        importJsonLocal: (name?: string) =>
          Promise<IpcResult<{ ok: boolean; file?: string; name?: string; error?: string; result?: ImportReturn }>>;
        /** ★ 2026-10-16：文件选择器支持多选，一次性导入多个 .py（`imported` 数量 / `failed` 明细） */
        importPyLocal: () => Promise<IpcResult<{ ok: boolean; key?: string; keys?: string[]; imported?: number; failed?: { name: string; error: string }[]; error?: string }>>;
        /**
         * ★ 2026-09-30（用户要求）：导入本地 TXT / M3U 直播源。
         * ★ 2026-10-14：两步导入 —— 首次返回 `needsName` 由渲染层弹框命名，二次带 `{ path, name }` 登记。
         */
        importLiveLocal: (args?: { name?: string; path?: string }) =>
          Promise<IpcResult<{ ok: boolean; needsName?: boolean; path?: string; name?: string; index?: number; replaced?: boolean; total?: number; error?: string }>>;
        /** ★ 2026-10-14（用户要求）：删除某条直播线路（下标） */
        deleteLive: (index: number) => Promise<IpcResult<void>>;
        /** ★ 2026-10-16（用户要求）：批量删除直播线路（下标数组） */
        deleteLives: (indices: number[]) => Promise<IpcResult<void>>;
        /** ★ 2026-10-14（用户要求）：重命名某条直播线路 */
        updateLive: (a: { index: number; name: string }) => Promise<IpcResult<void>>;
        /** ★ 2026-09-29：导入本地包（目录包：影视.json + py/js/jar/html/xbpq） */
        importPackage: (args?: { name?: string; root?: string }) =>
          Promise<IpcResult<{ ok: boolean; root?: string; rel?: string; sites?: number; name?: string; needsName?: boolean; error?: string; warnings?: string[]; result?: ImportReturn }>>;
        /** ★ 2026-09-29 本地包「网页源」：独立窗口打开 homePage html（fm 桥） */
        webHomeOpen: (init: { url: string; title?: string; site?: Record<string, string | undefined> }) =>
          Promise<IpcResult<{ ok: boolean; error?: string }>>;
        saveAsProfile: (name: string) => Promise<IpcResult<UserProfile>>;
        activateProfile: (id: string) => Promise<IpcResult<void>>;
        deleteProfile: (id: string) => Promise<IpcResult<void>>;
        updateProfileName: (a: { id: string; name: string }) => Promise<IpcResult<void>>;
        cfgProfiles: () => Promise<IpcResult<Omit<UserProfile, 'json'>[]>>;
        /** ★ 2026-09-30（用户要求）：换源弹层「左订阅 / 右源」视图 */
        profileSites: () => Promise<IpcResult<ProfileSitesView>>;
        profileSources: (profileId: string) => Promise<IpcResult<SourceBean[]>>;
        /** ★ 2026-09-30（用户要求）：一步完成「切换档案 + 选中该档案下的源」 */
        switchProfileSource: (a: { profileId: string; key: string }) => Promise<IpcResult<void>>;
        vodDebug: (key: string) => Promise<IpcResult<SourceDebugReport>>;
        audit: (expectedProfileId?: string) => Promise<IpcResult<AuditItem[]>>;
        cacheClear: () => Promise<IpcResult<{ freedBytes: number; cleared: string[]; failed: string[] }>>;
        driveBindKeys: () => Promise<IpcResult<string[]>>;
        gotoDriveBind: () => Promise<IpcResult<void>>;
        onNavDriveBind: (cb: () => void) => () => void;
      };
      vod: {
  home: (key: string, profileId?: string, requestId?: string) => Promise<IpcResult<HomeResult>>;
  cancelHome: (requestId: string) => void;
  category: (a: { key: string; tid: string; pg: string; extend?: Record<string, string>; profileId?: string; requestId?: string }) => Promise<IpcResult<HomeResult>>;
  cancelCategory: (requestId: string) => void;
  detail: (a: { key: string; ids: string[]; profileId?: string }) => Promise<IpcResult<VodDetail | null>>;
  search: (a: { key: string; wd: string; profileId?: string; requestId?: string }) => Promise<IpcResult<VodItem[]>>;
  cancelSearch: (requestId: string) => void;
        /** ★ 全源搜索：refresh=true 忽略本地缓存强制重搜（「重新搜索」按钮）；默认命中缓存即秒回 */
  searchAll: (wd: string, opts?: { refresh?: boolean; profileId?: string; profileIds?: string[] }, requestId?: string) => Promise<IpcResult<SearchAllReport>>;
  cancelSearchAll: (requestId: string) => void;
        /** ★ 聚合搜索逐源进度（边搜边出）：返回退订函数 */
        onSearchAllProgress: (cb: (ev: SearchAllProgressEvent) => void) => () => void;
  play: (a: { key: string; flag: string; id: string; profileId?: string }) => Promise<IpcResult<PlayResult>>;
        /** ★ 2026-09-30（用户要求）：点播外部播放器（与磁力分开绑定）——探测本机播放器 / 用当前地址拉起 */
        detectPlayers: () => Promise<IpcResult<Array<{ id: string; name: string; path: string }>>>;
        openExternal: (a: { url: string; path?: string; seek?: number }) => Promise<IpcResult<{ ok: boolean; player?: string; error?: string }>>;
      };
      live: {
        load: (index: number) => Promise<IpcResult<{ groups: LiveGroup[]; liveName: string }>>;
        meta: () => Promise<IpcResult<LiveBean[]>>;
        /** ★ 2026-09-29 EPG：传入该线路的频道引用，返回各键（tvg-id/tvg-name/频道名）的「当前 / 下一档」 */
        epg: (index: number, channels: EpgChannelRef[]) => Promise<IpcResult<LiveEpgResult>>;
        /** ★ 2026-10-18 直播输出模板（内置 2 个 + 插件 `contributes.live.template`） */
        templates: () => Promise<IpcResult<LiveTemplateView[]>>;
        /** ★ 2026-10-18 按模板渲染导出文本（纯本地无副作用，不弹框） */
        render: (a: { templateId: string; groups: LiveGroup[] }) =>
          Promise<IpcResult<LiveTemplateView & { content: string }>>;
        /** ★ 2026-10-18 导出直播线路：按模板渲染（纯本地）→ 主进程保存对话框 → 只写新文件 */
        export: (a: { templateId: string; groups: LiveGroup[]; defaultName?: string }) =>
          Promise<IpcResult<{ saved: boolean; path: string }>>;
      };
      /** ★ 2026-09-29 设置备份（含渲染层 localStorage） */
      backup: {
        export: (renderer: Record<string, string>) => Promise<IpcResult<BackupExportResult>>;
        import: () => Promise<IpcResult<BackupImportResult>>;
        commit: (restoreId: string) => Promise<IpcResult<void>>;
        cancel: (restoreId: string) => Promise<IpcResult<void>>;
      };
      /** ★ 2026-09-29 WebDAV 存储（只读） */
      dav: {
        list: () => Promise<IpcResult<DavServer[]>>;
        set: (s: DavServer) => Promise<IpcResult<DavServer>>;
        test: (s: DavServer) => Promise<IpcResult<DavBrowseResult>>;
        remove: (id: string) => Promise<IpcResult<void>>;
        browse: (a: { id: string; path?: string }) => Promise<IpcResult<DavBrowseResult>>;
        openExternal: (url: string) => Promise<IpcResult<{ ok: boolean; player?: string; error?: string }>>;
      };
      /** ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作） */
      dlna: {
        discover: () => Promise<IpcResult<DlnaDevice[]>>;
        cast: (a: { device: DlnaDevice; target: DlnaCastTarget }) => Promise<IpcResult<DlnaCastResult>>;
      };
      subtitle: {
        get: () => Promise<IpcResult<SubtitleSettings>>;
        set: (patch: Partial<SubtitleSettings>) => Promise<IpcResult<SubtitleSettings>>;
        /** ★ 2026-09-28：各字幕源的开关/可用状态 */
        providers: () => Promise<IpcResult<SubtitleProviderView[]>>;
        /** ★ 2026-09-28：多源聚合检索（返回 { candidates, providers }） */
        search: (name: string) => Promise<IpcResult<SubtitleSearchReport>>;
        fetch: (cand: SubtitleCandidate) => Promise<IpcResult<SubtitleFetchResult>>;
      };
      danmaku: {
        get: () => Promise<IpcResult<DanmakuSettings>>;
        set: (patch: Partial<DanmakuSettings>) => Promise<IpcResult<DanmakuSettings>>;
        search: (name: string, season?: number) => Promise<IpcResult<DanmakuAnime[]>>;
        episodes: (bangumiId: number, animeTitle: string | undefined, source: string) => Promise<IpcResult<DanmakuCandidate[]>>;
        fetch: (episodeId: number, source: string) => Promise<IpcResult<string>>;
        onRealtime?: (cb: (data: { text: string }) => void) => () => void;
      };
      meta: {
        search: (name: string, year?: string, provider?: 'tmdb' | 'douban') => Promise<IpcResult<MetaHit | null>>;
        /** ★ 详情页增强：演职员/类型/相关推荐 */
        extra: (name: string, year?: string) => Promise<IpcResult<MetaExtra | null>>;
        /** ★ 发现页榜单（无源默认主页） */
        discover: (refresh?: boolean) => Promise<IpcResult<DiscoverSection[]>>;
        boardPage: (id: string, page: number, refresh?: boolean) => Promise<IpcResult<DiscoverBoardPage>>;
        movieHot: () => Promise<IpcResult<MovieHotList>>;
        discoverImages: (name: string, mediaType: 'movie' | 'tv', year?: string, kind?: 'backdrop' | 'poster', doubanId?: string) => Promise<IpcResult<MetaImages>>;
        /** ★ 发现页「分类」：类型清单与按类型翻页 */
        genres: () => Promise<IpcResult<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>>;
        genrePage: (mediaType: 'movie' | 'tv', genreId: number, page: number) => Promise<IpcResult<DiscoverGenrePage>>;
        /** ★ 2026-10-15（级联分类）：发现页「分类浏览」取一页（豆瓣 recommend，start 偏移分页） */
        discoverQuery: (q: ExploreQuery) => Promise<IpcResult<ExplorePage>>;
        /** ★ 2026-10-15（级联分类）：级联词表（豆瓣自带的类型/地区 + 排序；发现页与点播页共用） */
        exploreVocab: () => Promise<IpcResult<ExploreVocabulary>>;
        /** ★ 2026-09-24 元数据来源配置（TMDB Key/代理/镜像 + 策略）与搜索联想 */
        getSettings: () => Promise<IpcResult<MetaSettingsView>>;
        setSettings: (patch: Partial<MetaSettings>) => Promise<IpcResult<MetaSettingsView>>;
        suggest: (q: string) => Promise<IpcResult<MetaSuggestion[]>>;
        /** ★ 发现页 Hero 轮播：某部片的横版剧照 / 竖版海报 */
        images: (mediaType: 'movie' | 'tv', tmdbId: number) => Promise<IpcResult<MetaImages>>;
      };
      drives: {
        get: () => Promise<IpcResult<Record<string, string>>>;
        set: (a: { provider: string; token: string }) => Promise<IpcResult<void>>;
        remove: (provider: string) => Promise<IpcResult<void>>;
        // ★ 2026-09-30：imageDataUrl = 图片型二维码（百度 passport 直接出图，见 main/net/qr/types.ts）
        qrCreate: (provider?: string) => Promise<IpcResult<{ provider: string; content: string; imageDataUrl?: string; sid: string }>>;
        qrPoll: (
          provider: string,
          sid: string,
        ) => Promise<
          IpcResult<{ state: number; token?: string; tokenKind?: 'refresh_token' | 'cookie' | 'access_token'; username?: string; hint?: string }>
        >;
        webLogin: (provider: string) => Promise<IpcResult<void>>;
        // ★ 2026-10-14 UC TV Token（非会员 UC 原画）扫码授权流
        ucTvStatus: () => Promise<IpcResult<{ bound: boolean }>>;
        ucTvQrCreate: () => Promise<IpcResult<{ imageDataUrl: string }>>;
        ucTvQrPoll: () => Promise<IpcResult<{ state: 'wait' | 'ok' | 'expired' | 'error'; hint?: string }>>;
        ucTvRemove: () => Promise<IpcResult<void>>;
      };
      win: {
        minimize: () => Promise<IpcResult<void>>;
        maximize: () => Promise<IpcResult<void>>;
        close: () => Promise<IpcResult<void>>;
        isMaximized: () => Promise<IpcResult<boolean>>;
        // ★ 2026-09-30（用户要求）：播放器置顶按钮
        setAlwaysOnTop: (on: boolean) => Promise<IpcResult<boolean>>;
        isAlwaysOnTop: () => Promise<IpcResult<boolean>>;
        // ★ 2026-10-08（用户要求）：详情页独立窗口（已开则复用并通知换路由）
        openDetail: (a: { key: string; id: string; query?: string }) => Promise<IpcResult<{ ok: boolean; reused: boolean }>>;
        openSearch: (args: { term: string; profileId?: string; allProfiles?: boolean }) => Promise<IpcResult<{ ok: boolean; reused: boolean }>>;
        routeReady: () => Promise<IpcResult<void>>;
        reportError: (message: string) => Promise<IpcResult<void>>;
        onNavigate: (cb: (route: string) => void) => () => void;
      };
      net: {
        onSpeed: (cb: (kbs: number) => void) => () => void;
        proxyGet: () => Promise<IpcResult<{ enabled: boolean; url: string }>>;
        proxySet: (patch: { enabled?: boolean; url?: string }) => Promise<IpcResult<{ enabled: boolean; url: string }>>;
      };
      player: {
        open: (init: unknown) => Promise<IpcResult<void>>;
        switchEp: (request: number | import('../../shared/playerEpisode').PlayerEpisodeSwitch) => Promise<IpcResult<{ switched: boolean }>>;
        /** ★ 2026-09-30：订阅就绪 → 主进程重发最新 init（新窗口首推与订阅的竞态） */
        ready: () => Promise<IpcResult<{ ok: boolean }>>;
        isOpen: () => Promise<IpcResult<{ open: boolean }>>;
        close: () => Promise<IpcResult<void>>;
        setMini: (isMini: boolean) => Promise<IpcResult<{ mini: boolean }>>;
        isMini: () => Promise<IpcResult<{ mini: boolean }>>;
        setFullscreen: (fullscreen: boolean) => Promise<IpcResult<{ fullscreen: boolean }>>;
        isFullscreen: () => Promise<IpcResult<{ fullscreen: boolean }>>;
        setResizable: (resizable: boolean) => Promise<IpcResult<{ resizable: boolean }>>;
        onInit: (cb: (init: unknown) => void) => () => void;
        onSwitchEp: (cb: (epIndex: number) => void) => () => void;
        onMini: (cb: (mini: boolean) => void) => () => void;
        onFullscreen: (cb: (fullscreen: boolean) => void) => () => void;
        /** ★ 2026-10-17（B3）：播放器窗口开/关（主窗口据此冻结/解冻隐藏页的已解码图片） */
        onWindowState: (cb: (s: { open: boolean }) => void) => () => void;
        /** ★ 2026-10-18（R10）：L4 插件 `winbox.player.*` 的转发事件（播放器窗口渲染层执行） */
        onCtl: (cb: (a: { op: string; value?: unknown }) => void) => () => void;
      };
      /**
       * ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）：播放诊断上报（渲染层 → 主进程）。
       *   fire-and-forget；主进程落盘为 `media:*` 日志，并在 GPU 崩溃那条日志里带出「当时在放什么」。
       */
      media: { report: (ev: MediaStateEvent) => void };
      boss: {
        get: () => Promise<IpcResult<BossKeySettings>>;
        set: (patch: Partial<BossKeySettings>) => Promise<IpcResult<{ settings: BossKeySettings; registered: boolean }>>;
        onEnter: (cb: () => void) => () => void;
        onExit: (cb: () => void) => () => void;
      };
      merge: {
        export: (ids: string[]) => Promise<IpcResult<{ content: string; summary: { name: string; kept: number; duplicated: number; total: number; error?: string }[] }>>;
        save: (a: { content: string; defaultName?: string }) => Promise<IpcResult<{ saved: boolean; path: string }>>;
      };
      quark: {
        cleanup: () => Promise<IpcResult<void>>;
      };
      // ★ 播放偏好（m3u8 去广告开关；改后本地中继 /play 即时生效）
      playerPrefs: {
        get: () => Promise<IpcResult<PlayerSettings>>;
        set: (patch: Partial<PlayerSettings>) => Promise<IpcResult<PlayerSettings>>;
      };
      // ★ 2026-10-08 MPV 高兼容播放内核（独立播放器窗口内嵌；状态经 MPV_STATE 事件推送）
      mpv: {
        status: () => Promise<IpcResult<MpvStatus>>;
        start: (opts: MpvStartOptions) => Promise<IpcResult<{ session: number; path: string }>>;
        cmd: (cmd: MpvCommand) => Promise<IpcResult<{ ok: boolean }>>;
        stop: () => Promise<IpcResult<{ ok: boolean }>>;
        onState: (cb: (s: MpvStateEvent) => void) => () => void;
      };
      mediaRuntime: {
        status: () => Promise<IpcResult<MediaRuntimeStatus>>;
        install: (runtime: MediaRuntimeId) => Promise<IpcResult<MediaRuntimeStatus>>;
        cancel: () => Promise<IpcResult<boolean>>;
        onProgress: (cb: (progress: MediaRuntimeProgress) => void) => () => void;
      };
      // ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`；宿主托管，插件只给描述符）
      engine: {
        /** 内置 2（html5/mpv）+ 插件 N（`engine:<contributeId>`） */
        list: () => Promise<IpcResult<PlayerEngineView[]>>;
        status: (id: string) => Promise<IpcResult<{ id: string; ready: boolean; path?: string; note?: string }>>;
        /** 写启用开关（`playerSettings.engineEnabled`；默认关） */
        setEnabled: (a: { id: string; enabled: boolean }) => Promise<IpcResult<{ ok: boolean; reason?: string }>>;
        /** 拉起会话（★ 未启用 → `{ok:false, reason}`；就绪异常 → throw） */
        start: (opts: MpvStartOptions & { engineId: string }) =>
          Promise<IpcResult<{ ok: boolean; reason?: string; session?: number }>>;
        cmd: (cmd: MpvCommand) => Promise<IpcResult<{ ok: boolean }>>;
        stop: () => Promise<IpcResult<{ ok: boolean }>>;
        onState: (cb: (s: MpvStateEvent) => void) => () => void;
      };
      // ★ 2026-10-16 插件系统（M1）：列表 / 安装（两段式）/ 卸载 / 启停 / 超分状态
      plugins: {
        dialogReady: () => void;
        replyDialog: (reply: PluginDialogReply) => void;
        onDialog: (callback: (request: PluginDialogRequest) => void) => () => void;
        onDialogCancel: (callback: (id: string) => void) => () => void;
        list: () => Promise<IpcResult<PluginView[]>>;
        /** ★ 2026-10-18（R10）第 ① 段：干跑校验，返回权限清单供确认（不落盘） */
        inspect: () => Promise<IpcResult<PluginInspectResult>>;
        /** 第 ② 段：传干跑选定的 `{path}` 安装 */
        install: (a?: { path?: string }) => Promise<IpcResult<{ ok: boolean; canceled?: boolean; reason?: string; items?: PluginView[] }>>;
        uninstall: (id: string) => Promise<IpcResult<{ ok: boolean; reason?: string; items?: PluginView[] }>>;
        setEnabled: (a: { id: string; enabled: boolean }) => Promise<IpcResult<{ ok: boolean; reason?: string; items?: PluginView[] }>>;
        sr: () => Promise<IpcResult<SrState>>;
        themes: () => Promise<IpcResult<ThemeSkinView[]>>;
        /** ★ 2026-10-18 受限动作按钮（`contributes.ui.command`）—— 主进程只装配，动作由渲染层执行 */
        commands: () => Promise<IpcResult<UiCommandView[]>>;
        /** ★ 2026-10-18 追加快捷键（`contributes.keymap`）—— 主进程只装配，分发/执行由渲染层完成 */
        keymaps: () => Promise<IpcResult<KeymapView[]>>;
        /** ★ 2026-10-18 插件设置面板（`contributes.settings.panel`）—— 主进程装配 + 代持久化 */
        settings: () => Promise<IpcResult<SettingsPanelView[]>>;
        setSetting: (a: { id: string; panelId: string; key: string; value: unknown }) =>
          Promise<IpcResult<{ ok: boolean; reason?: string; panels?: SettingsPanelView[] }>>;
        /** ★ 2026-10-18 受限 UI 槽位（`contributes.ui.slot`）—— 主进程只装配，渲染层落槽 */
        slots: () => Promise<IpcResult<UiSlotView[]>>;
      };
      // ★ 2026-09-29 磁力（BT）：本机已安装的外部播放器（MKV/HEVC 接力；只探测不启动）
      bt: {
        detectPlayers: () => Promise<IpcResult<Array<{ id: string; name: string; path: string }>>>;
      };
      /** 启动可选更新 */
      update: {
        check: () => Promise<IpcResult<UpdateCheckResult>>;
        download: () => Promise<IpcResult<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>>;
        cancel: () => Promise<IpcResult<boolean>>;
        install: () => Promise<IpcResult<{ ok: boolean; path: string }>>;
        onProgress: (cb: (p: UpdateProgress) => void) => () => void;
      };
      /** ★ 2026-10-16（用户要求）：界面缩放（跟随屏幕 / 指定档位） */
      ui: {
        getScale: () => Promise<IpcResult<UiScaleState>>;
        setScale: (v: UiScalePref) => Promise<IpcResult<UiScaleState>>;
        onScaleChanged?: (cb: (state: UiScaleState) => void) => () => void;
      };
    };
  }
}
