// Coordinates playback feature hooks and maps their state to grouped presentation state and actions.
import { formatPlaybackTime, formatNetworkSpeed } from './formatting';
import { usePlayerAudioTracks } from './usePlayerAudioTracks';
import { useSuperResolution } from './useSuperResolution';
import { usePlaybackBoost } from './usePlaybackBoost';
import { usePlayerContextMenu } from './usePlayerContextMenu';
import { openConfiguredExternalFallback, type ExternalPlaybackFallbackPort } from './externalPlayback';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { playbackProgressKey, type PlaybackSourceRef } from '../../lib/playbackProgress';
// ★ 2026-09-30（用户要求）：图片/音乐分流 + 直播态判定（纯函数，见 lib/mediaKind.ts）
import { detectMediaKind, isLikelyLive } from '../../lib/mediaKind';
// 跳过判据由 application 策略维护；浏览器能力通过控制器端口注入。
// ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作；对位 CatClaw Dlna.cs）
// ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核 —— 双内核选择纯函数
import type { Kernel } from '../../lib/kernel';
import { emptyMpvKernelState, normalizeSpdif, type MpvCommand, type MpvKernelState } from '../../../shared/player';
import { useSubtitlePlayback } from './useSubtitlePlayback';
import { useDanmakuController } from './useDanmakuController';
import { usePlayerKeyboardShortcuts } from './usePlayerKeyboardShortcuts';
import { useAutoNextEpisode } from './useAutoNextEpisode';
import { createPlayerKernelAdapter } from './playerKernelAdapter';
import { usePlayerFullscreen } from './usePlayerFullscreen';
import { useSkipSegmentsController } from './useSkipSegmentsController';
import { usePlayerVolumeController } from './usePlayerVolumeController';
import { usePlayerPlaybackSessions } from './usePlayerPlaybackSessions';
import { useDriveBindingPrompt } from './useDriveBindingPrompt';
import { useHtmlMediaSource } from './useHtmlMediaSource';
import { usePlayerResolution } from './usePlayerResolution';
import { useMpvTechnicalState } from './useMpvTechnicalState';
import type { PlayerControlsViewModel } from './presentation/PlayerControlsViewModel';
import { resolvePlayerControlAvailability } from './presentation/playerControlAvailability';
import { usePlayerPreferencePersistence, usePlayerPreferences } from './usePlayerPreferences';
import { usePlayerPanelSession } from './usePlayerPanelSession';
import { usePlayerEpisodePanelPresenter } from './usePlayerEpisodePanelPresenter';
import { usePlayerKernelTransitions } from './usePlayerKernelTransitions';
import type { BossKeyPlaybackPort } from './application/bossKeyPlaybackSession';
import { useBossKeyPlaybackEvents } from './useBossKeyPlaybackEvents';
import { useRelaySpeedSubscription } from './useRelaySpeedSubscription';
import { createPlaybackHandoffPort } from './application/playbackHandoff';
import { createPlaybackSessionStatePort } from './application/playbackSessionState';
import { usePlayerSurfaceGesture } from './usePlayerSurfaceGesture';
import { usePlayerSurfaceAttributes } from './usePlayerSurfaceAttributes';
import { usePlayerPlaybackPresentation } from './usePlayerPlaybackPresentation';
import { usePlayerKernelSelection } from './usePlayerKernelSelection';
import { resolveProgressMenuPosition } from './application/playerWindow';
import { usePlayerPluginCommands } from './usePlayerPluginCommands';
import { formatDanmakuCandidateLabel } from './presentation/formatDanmakuCandidateLabel';
import type { SubtitleSearchDependencies } from './application/subtitleSearchPorts';
import type { SubtitlePlaybackPort } from './application/subtitlePlaybackPort';
import type { SuperResolutionPort } from './application/superResolutionPort';
import type { PlayerPreferencesPort } from './application/playerPreferences';
import type { PlayerAudioTracksPort } from './application/playerAudioTracks';
import type { AdaptiveAudioTrackController } from './application/playerAudioTracks';
import type { SessionAudioPreferencePort } from './application/sessionAudioPreference';
import type { HtmlMediaSourcePort } from './application/htmlMediaSource';
import type { PlayerKernelCommandPort } from './application/playerKernelCommandPort';
import type { BossKeyPlaybackEventsPort, RelaySpeedEventsPort } from './application/playerRuntimeEventsPorts';
import type { DriveBindingNavigationPort, DriveBindingPromptPort } from './application/driveBindingPorts';
import type { PlaybackKernelSessionPort, MpvStatusQueryPort } from './application/mpvPlaybackPorts';
import type { PlayerKernelWindowPort } from './application/playerKernelTransitions';
import type { PlayerViewportPort, PlayerWindowReloadPort } from './application/playerWindow';
import type { DanmakuControllerPorts } from './application/danmakuControllerPorts';
import type { DlnaCastingPort } from './application/dlnaCasting';
import type { MediaDiagnosticsPort } from './application/mediaDiagnostics';
import type { PlayerFullscreenPort } from './application/playerFullscreen';
import type { PlayerClipboardPort } from './application/playerClipboard';
import type { PlayerKeyboardShortcutsPorts } from './application/playerKeyboardShortcuts';
import type { SkipSegmentsControllerPorts } from './application/skipSegmentsControllerPorts';
import type { PluginPlaybackEnginesPort } from './application/pluginPlaybackEngines';
import type { PlaybackPositionMemoryPort, PlaybackRuntimePort } from './application/playbackSessionPorts';
import { useDlnaCastPresenter } from './useDlnaCastPresenter';
import { usePlayerCommandFeedback } from './usePlayerCommandFeedback';
import { usePlayerKernelFitSync } from './usePlayerKernelFitSync';
import { runPlayerKernelCommandWithFeedback } from './application/runPlayerKernelCommandWithFeedback';
import { cyclePlayerFit } from './application/playerFitCycle';
import { reportPlaybackFailure } from './application/reportPlaybackFailure';

export interface VideoPlayerProps {
  url: string;
  /** Source identity for profile-scoped playback progress. */
  playbackSource?: PlaybackSourceRef;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  /** 当前资源名（剧名+集号），用于外挂字幕检索。缺省则不显示字幕搜索。 */
  resourceName?: string;
  playTitle?: string;
  episodes?: { name: string; url: string }[];
  onPickEpisode?: (index: number) => void;
  /** ★ 2026-10-25（自动切源容错机制 AutoChangeParse）：流异常/超时时自动切换下一解析线路 */
  onAutoChangeParse?: (currentTime: number) => Promise<boolean> | boolean;
  /** ★ 2026-10-25（播放故障回调）：供外层（如直播切备用线）接管流异常 */
  onPlaybackFailure?: (time: number, reason: string) => void;
  /** 当前解析线路名称（展示在 HUD 提示中） */
  parseName?: string;
  /** 视频分辨率回传到窗口标题；未知/换源时为空。 */
  onResolutionChange?: (resolution: string) => void;
  /** 可搜索的剧名副名（用于弹幕匹配）。缺省（如直播/无集数源）则不显示弹幕按钮。 */
  danmakuTitle?: string;
  /** 小窗口模式：控制条只保留 上/下集 + 播放暂停；全屏等功能消失 */
  mini?: boolean;
  /** 切换画中画小窗口模式 */
  onToggleMini?: () => void;
  /** ★ 播放地址属于「cookie 型」网盘且未绑定 → 提示去配置页绑定（值为网盘 provider，如 quark/uc/baidu/115） */
  driveBindProvider?: string | null;
  /** ★ 2026-09-29：在播放器里完成网盘绑定后回调外层（重新解析当前集，不用手动重开） */
  onDriveBound?: () => void;
   /** 续播起始时间（秒）：历史记录点开时由外层传入，优先于档案和源范围内的进度。 */
  startTime?: number;
  /** ★ 2026-09-30：当前是第几「集」（图集源里就是第几张图）——图片/音乐播放器显示页码用 */
  epIndex?: number;
  /** 共几集（图集/歌单总数） */
  epTotal?: number;
  /** ★ 2026-09-30：音乐播放器封面（详情页海报） */
  cover?: string;
  /**
   * ★ 2026-10-08（用户要求「跳过片头片尾，同一个资源每一集都应该保存记录」）：
   * 资源键（与历史分组同口径：`historyGroupKey`）；**缺省 = 不显示该功能**（直播 / 本地文件 / 无集概念）。
   */
  skipResourceKey?: string;
  /** ★ 本集键（原始 episode url 优先；同一资源的每一集各记一条记录） */
  skipEpisodeKey?: string;
  /** ★ 本集展示名（如「第12集」）—— 面板提示「沿用 X 的设置」用 */
  skipEpisodeLabel?: string;
  /**
   * ★ 2026-10-08（用户拍板「内置官方构建」）：允许 MPV 高兼容内核。
   *   **仅独立播放器窗口传 true**（`#/player` 窗口 transparent，mpv 画面才能嵌入透出；
   *   主窗口里的直播/WebDAV 播放保持纯 HTML5，不显示内核切换入口）。
   */
  allowMpv?: boolean;
}

export interface VideoPlayerPresenterDependencies {
  subtitleSearch: SubtitleSearchDependencies;
  subtitlePlayback: SubtitlePlaybackPort;
  superResolution: SuperResolutionPort;
  externalPlayback: ExternalPlaybackFallbackPort;
  playerPreferences: PlayerPreferencesPort;
  sessionAudioPreference: SessionAudioPreferencePort;
  createAudioTracksPort: (adaptiveTracksRef: RefObject<AdaptiveAudioTrackController | null>) => PlayerAudioTracksPort;
  htmlMediaSource: HtmlMediaSourcePort;
  playerKernelCommands: PlayerKernelCommandPort;
  relaySpeedEvents: RelaySpeedEventsPort;
  bossKeyPlaybackEvents: BossKeyPlaybackEventsPort;
  driveBindingPrompt: DriveBindingPromptPort;
  driveBindingNavigation: DriveBindingNavigationPort;
  mpvPlaybackSession: PlaybackKernelSessionPort;
  mpvStatusQuery: MpvStatusQueryPort;
  playerKernelWindow: PlayerKernelWindowPort;
  playerViewport: PlayerViewportPort;
  playerWindowReload: PlayerWindowReloadPort;
  danmakuController: DanmakuControllerPorts;
  dlnaCasting: DlnaCastingPort;
  mediaDiagnostics: MediaDiagnosticsPort;
  playbackPositionMemory: PlaybackPositionMemoryPort;
  playbackRuntime: PlaybackRuntimePort;
  playerFullscreen: PlayerFullscreenPort;
  pluginPlaybackEngines: PluginPlaybackEnginesPort;
  clipboard: PlayerClipboardPort;
  keyboardShortcuts: PlayerKeyboardShortcutsPorts;
  skipSegments: SkipSegmentsControllerPorts;
}

export function useVideoPlayerPresenter(props: VideoPlayerProps, dependencies: VideoPlayerPresenterDependencies) {
  const { url, canPrev, canNext, onPrev, onNext, resourceName, danmakuTitle, mini = false, driveBindProvider = null, playTitle = '' } = props;
  /**
   * ★ 2026-09-30（用户要求「图片和音乐要有独立的播放器」）：先判型再分流 ——
   *   图片（图集源的每一「集」= 一张图）与音频（mp3/flac…）分别由 ImageViewer / AudioPlayer 接管，
   *   不再喂给 `<video>`（此前图片必黑屏、音频只闻其声不见其形）。
   *   判定见 lib/mediaKind.ts（只认协议/扩展名，判不准仍回落视频，不臆造）。
   */
  const mediaKind = detectMediaKind(url);
  const isImage = mediaKind === 'image';
  const isAudio = mediaKind === 'audio';
  const liveHint = isLikelyLive(url);
  const progressKey = playbackProgressKey(url, props.playbackSource);
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const adaptiveAudioTracksRef = useRef<AdaptiveAudioTrackController | null>(null);
  // ---- ★ 2026-09-24：播放器设置记忆（音量 / 倍速 / 字幕时间偏移）----
  //   挂载时一次性读取（localStorage，主窗口与独立播放器窗口同源共享），
  //   变更时由下方 persist effect 落盘 → 下次打开播放器保持上次的设置。
  const {
    preferencesRef: prefsRef,
    initialSubtitleOffset,
    volumeRef: volRef,
    bossKeyActiveRef: bossActiveRef,
    syncPreferences,
    volume: vol,
    setVolume: setVol,
    rate,
    setRate,
    fit,
    setFit,
    kernelPreference: kernelPref,
    rememberKernelPreference,
    spdif,
    setSpdif,
  } = usePlayerPreferences(dependencies.playerPreferences);

  const { state: playbackStatus, update: updatePlaybackStatus } = usePlayerPlaybackPresentation();
  const { paused, currentTime: cur, duration: dur, buffered, error: err, mpvError: mpvErr, loading, isLive, netSpeed, relaySpeed, buffering } = playbackStatus;
  const { message: commandError, report: reportCommandError } = usePlayerCommandFeedback();
  const updateCurrentTime = useCallback((currentTime: number) => updatePlaybackStatus({ currentTime }), [updatePlaybackStatus]);
  /**
   * ★ 2026-09-30：**当前流的直播结论**（由引擎给出，不是靠时长猜）——
   *   HLS 由 `LEVEL_LOADED.details.live` 写、flv/ts 在建播放器时按形态写（天生直播）；
   *   `onDuration` 只读它（+ 原生直连的 Infinity 兜底），避免被 hls 直播的有限时长纠正成点播。
   */

  // ---- ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核（双内核：默认 HTML5，mpv 为一键/自动备选）----
  //   仅独立播放器窗口（allowMpv=true）启用：该窗口 transparent，mpv 画面从播放区透明处透出，
  //   HTML 控制条/弹幕仍绘制在 mpv 之上且点击归 HTML（PoC 实测；地址链路不变，mpv 直接吃既有 /play 中继）。
  const allowMpv = !!props.allowMpv && !isImage && !isAudio && mediaKind !== 'unsupported';
  const kernelSelection = usePlayerKernelSelection(
    { allowMpv, preference: kernelPref, url, progressKey },
    dependencies.mpvStatusQuery,
    dependencies.pluginPlaybackEngines,
  );
  const { mpvInfo, kernel, setKernel, kernelRef, engines, htmlPlaybackReady: htmlKernelReady, resolvePreference, setCompatibilitySource } = kernelSelection;
  const technical = useMpvTechnicalState(url, kernel);
  const createAudioTracksPort = dependencies.createAudioTracksPort;
  // oxlint-disable-next-line react/refs -- The adapter reads the current session's narrow audio-track capability only when a user action runs.
  const audioPort = useMemo(() => createAudioTracksPort(adaptiveAudioTracksRef), [adaptiveAudioTracksRef, createAudioTracksPort]);
  const audio = usePlayerAudioTracks(url, kernel, audioPort, dependencies.sessionAudioPreference);
  const superResolution = useSuperResolution(allowMpv && kernel === 'mpv', dependencies.superResolution);
  const controlsRevealRef = useRef<() => void>(() => undefined);
  const revealControls = useCallback(() => controlsRevealRef.current(), []);
  const playbackHandoff = useMemo(() => createPlaybackHandoffPort(), []);
  const { full, fullRef, setFull, toggleFull, exitMpvFullscreen } = usePlayerFullscreen({
    allowMpv,
    port: dependencies.playerFullscreen,
    nativeWindow: !!props.allowMpv,
    kernel,
    mini,
    containerRef: wrapRef,
    revealControls,
  });
  const recoverHtmlPlaybackRef = useRef<() => boolean>(() => false);
  const htmlSource = useHtmlMediaSource({
    url, progressKey, enabled: kernel === 'html5' && htmlKernelReady && !isAudio && !isImage,
    port: dependencies.htmlMediaSource,
    nativePlayback: { allowed: allowMpv, available: !!mpvInfo?.available, preference: kernelPref },
    onCompatibilityDetected: setCompatibilitySource,
    onNativeHandoff: playbackHandoff.stage,
    updatePlaybackStatus,
    recoverHtmlPlayback: () => recoverHtmlPlaybackRef.current(),
  });
  const htmlUrl = htmlSource?.source === url ? htmlSource.url : '';
  const { resolution: resText, reportResolution } = usePlayerResolution({
    url, progressKey, kernel, videoRef: ref, htmlUrl, htmlEnabled: !isImage && !isAudio,
    sourceWidth: htmlSource?.width, sourceHeight: htmlSource?.height,
    onResolutionChange: props.onResolutionChange,
  });
  /** mpv 内核状态镜像（主进程 200ms 节流推送；进度条/弹幕/跳过片头片尾都读它） */
  const mpvStateRef = useRef<MpvKernelState>(emptyMpvKernelState());
  const mpvTimeRef = useRef(0); // 弹幕时间源（number）
  const mpvSizeRef = useRef({ w: 0, h: 0 }); // 弹幕绘制区（画面物理像素）
  const playerKernelCommands = dependencies.playerKernelCommands;

  const playbackKernel = useMemo(
    // oxlint-disable-next-line react/refs -- The adapter stores lazy ports; the ref getters run only from player actions after render.
    () => createPlayerKernelAdapter({
      // oxlint-disable-next-line react/refs -- This getter is invoked by player commands after render to sample the active kernel.
      getKernel: () => kernelRef.current,
      getVideo: () => ref.current,
      getMpvState: () => mpvStateRef.current,
      commands: playerKernelCommands,
       onCommandError: reportCommandError,
      setCurrentTime: updateCurrentTime,
      setVolume: setVol,
      setRate,
      volumeRef: volRef,
    }),
     [kernelRef, playerKernelCommands, reportCommandError, setVol, setRate, updateCurrentTime, volRef],
  );
  const {
    isManaged: kIsChild,
    sendCommand: kCmd,
    getTime: kTime,
    getDuration: kDur,
    isPaused: kPaused,
    play: kPlay,
    pause: kPause,
    seek: kSeek,
    setVolume: kSetVol,
    setRate: kSetRate,
    setTemporaryRate,
  } = playbackKernel;
  const sendKernelCommandWithFeedback = useCallback((command: MpvCommand) => (
    runPlayerKernelCommandWithFeedback(command, kCmd, reportCommandError)
  ), [kCmd, reportCommandError]);

  const boost = usePlaybackBoost(rate, setTemporaryRate, mini, url);

  const tryConfiguredExternalFallback = useCallback(async (sourceUrl: string, position: number) => {
    return openConfiguredExternalFallback(sourceUrl, position, dependencies.externalPlayback);
  }, [dependencies.externalPlayback]);

  const {
    segments: skipSeg,
    inheritedFrom: skipInheritFrom,
    panelOpen: skipPanel,
    setPanelOpen: setSkipPanel,
    menu: skipMenu,
    setMenu: setSkipMenu,
    toast: skipToast,
    draft: skipDraft,
    dispatchDraftCommand: dispatchSkipDraftCommand,
    playbackMarkers: skipPlaybackMarkers,
    menuElementRef: skipMenuRef,
    usable: skipUsable,
    showToast: showSkipToast,
    saveDraft: saveSkipDraft,
    captureIntroFromMenu,
    captureOutroFromMenu,
    clearSegments: clearSkipSegments,
    clearFromMenu: clearSkipFromMenu,
    dismissMenu: dismissSkipMenu,
  } = useSkipSegmentsController({
    resourceKey: props.skipResourceKey,
    episodeKey: props.skipEpisodeKey,
    episodeLabel: props.skipEpisodeLabel,
    resourceName,
    isLive,
  }, dependencies.skipSegments);
  // oxlint-disable-next-line react/refs -- The application port reads the latest skip configuration only when a session requests it.
  const playbackSessionState = useMemo(
    () => createPlaybackSessionStatePort(skipPlaybackMarkers.getSkipSegments, skipPlaybackMarkers),
    [skipPlaybackMarkers],
  );
  const { pluginKeys } = usePlayerPluginCommands(showSkipToast);
  const contextMenu = usePlayerContextMenu(mini, url, props.skipEpisodeKey, showSkipToast, dependencies.clipboard);
  // ---- 实时网速（加载/缓冲时显示；不加载时不显示）----
  // 中继层真实转发测速（主进程 /play 统计字节推过来，最可靠；普通直连/hls/flv 用 netSpeed）
  const onRelaySpeed = useCallback((relaySpeed: number) => updatePlaybackStatus({ relaySpeed }), [updatePlaybackStatus]);
  useRelaySpeedSubscription(dependencies.relaySpeedEvents, onRelaySpeed);
  // ---- 网盘 cookie 未绑定提示：播放网盘资源但配置页未绑定对应网盘凭据 → 提示去配置页绑定 ----
  const driveBinding = useDriveBindingPrompt({
    url,
    providerOverride: driveBindProvider,
    port: dependencies.driveBindingPrompt,
    onBound: props.onDriveBound,
  });
  const volumeUi = usePlayerVolumeController();
  const dlna = useDlnaCastPresenter(url, resourceName, kTime, dependencies.dlnaCasting);

  // ---- 自动下一集（播完 → 5 秒倒计时可取消；默认开启）----
  const autoNext = useAutoNextEpisode({ canNext: !!canNext, onPrev, onNext, isPaused: kPaused, pause: kPause, immediate: true });
  const {
    endAll,
    clear: clearAuto,
    handlePlaybackEnd,
    handlePrev,
    handleNext,
    canAdvance,
    advance,
  } = autoNext;

  const { switchKernel, recoverWithKernel, recoverHtmlPlayback } = usePlayerKernelTransitions(url, progressKey, {
    window: dependencies.playerKernelWindow,
    snapshot: () => ({
      url, progressKey, kernel: kernelRef.current, preference: kernelPref,
      allowMpv, mpvAvailable: !!mpvInfo?.available, live: playbackSessionState.getLivePlaybackKind(),
      nativeWindow: !!props.allowMpv, fullscreen: fullRef.current,
      position: kTime(), paused: kPaused(), hasPlaybackError: !!err || !!mpvErr,
      htmlSettings: !kIsChild() && ref.current ? { volume: ref.current.volume, rate: ref.current.playbackRate } : null,
    }),
    releaseTemporaryRate: boost.release,
    clearAutoNext: clearAuto,
    retryPluginEngine: engines.retry,
    stageHandoff: (handoff, settings) => {
      playbackHandoff.stage(handoff);
      if (settings) { volRef.current = settings.volume; setVol(settings.volume); setRate(settings.rate); }
    },
    activateKernel: (target) => { setFull(false); setKernel(target); },
    rememberPreference: rememberKernelPreference,
  });
  useLayoutEffect(() => { recoverHtmlPlaybackRef.current = recoverHtmlPlayback; }, [recoverHtmlPlayback]);

  // ---- 外挂字幕 ----
  // ★ 2026-09-26：画面比例（播放器设置记忆；见 lib/playerPrefs.ts 的 PlayerFit）
  // ★ 2026-09-28（用户要求）：图标「左键开关 / 右键或长按开调整框」的手势状态（字幕、弹幕各一份）
  const subtitle = useSubtitlePlayback({
    // oxlint-disable-next-line react/refs -- The subtitle hook performs DOM media access from effects and user actions through this stable React ref.
    videoRef: ref,
    url,
    resourceName,
    allowMpv,
    kernel,
    initialOffset: initialSubtitleOffset,
    searchDependencies: dependencies.subtitleSearch,
    playbackPort: dependencies.subtitlePlayback,
  });
  const {
    enabled: subEnabled,
    offset: subOffset,
    fontSize: subFont,
    bottom: subBottom,
    onAppearanceCommand: subtitleAppearanceCommand,
    panelOpen: subPanel,
    setPanelOpen: setSubPanel,
    query: subQuery,
    setQuery: setSubQuery,
    candidates: subCands,
    searching: subSearching,
    message: subMsg,
    activeSubtitle: subActive,
    tokenHint: subTokenHint,
    restoreSuggestedQuery: restoreSubtitleQuery,
    search: doSearch,
    selectCandidate: selectSub,
    toggle: toggleSub,
  } = subtitle;

  // Danmaku state and operations.
  const {
    enabled: dmEnabled,
    settings: dmCfg,
    onSettingsCommand: dispatchDanmakuSettings,
    items: dmItems,
    candidates: dmCands,
    searching: dmSearching,
    message: dmMsg,
    activeEpisodeId: dmActiveEp,
    sourcesOpen: dmSrcPanel,
    onToggleSources: toggleDanmakuSources,
    customText: dmCustomText,
    setCustomText: setDmCustomText,
    query: dmQuery,
    updateQuery: setDmQuery,
    episode: dmEp,
    setEpisode: setDmEp,
    matchDanmaku,
    applyCandidate: applyDanmaku,
    toggle: toggleDanmaku,
  } = useDanmakuController({
    url,
    resourceName,
    danmakuTitle,
    autoMatch: true,
    formatTime: formatPlaybackTime,
    formatCandidateLabel: formatDanmakuCandidateLabel,
    ports: dependencies.danmakuController,
  });
  const panelSession = usePlayerPanelSession({
    isPaused: kPaused,
    containerRef: wrapRef,
    revealControls,
    subtitle: { open: subPanel, setOpen: setSubPanel },
    skip: { open: skipPanel, setOpen: setSkipPanel },
    audio: { open: audio.open, setOpen: audio.setOpen },
    superResolution: { open: superResolution.open, setOpen: superResolution.setOpen },
    volume: { isOpen: volumeUi.isOpen, setHovered: volumeUi.setHovered, clearFlash: volumeUi.clearFlash },
  });
  const {
    danmakuOpen: dmPanel,
    setDanmakuOpen: setDmPanel,
    fitOpen: fitPanel,
    setFitOpen: setFitPanel,
    episodesOpen: epPanel,
    setEpisodesOpen: setEpPanel,
    statsOpen,
    setStatsOpen,
    keysOpen,
    setKeysOpen,
    volumeOpen: volOpen,
    controls,
    coordinator: panelCoordinator,
    hover: { subtitle: subHover, danmaku: dmHover, volume: volumeHover },
    panelHosts: { subtitle: subPanelHost, danmaku: dmPanelHost },
  } = panelSession;
  const { visible: ui, reveal: poke, hideIfNoPanel } = controls;
  const episodePanel = usePlayerEpisodePanelPresenter({
    current: props.epIndex ?? -1,
    episodeCount: props.episodes?.length ?? 0,
    open: epPanel,
    setOpen: setEpPanel,
    onSelect: index => props.onPickEpisode?.(index),
  });
  usePlayerSurfaceAttributes(kernel !== 'html5', ui, !!props.allowMpv);
  useLayoutEffect(() => { controlsRevealRef.current = poke; }, [poke]);
  const {
    openPanel,
    toggleSkipPanel,
    toggleEpisodesPanel,
    openKernelPanel,
    flashVolume: coordinateVolumeFlash,
    toggleStats,
    toggleKeys,
  } = panelCoordinator;
  // 切换集时清除旧字幕内容；搜索候选与请求代际由 useSubtitleSearch 管理。

  // 应用字幕到 TextTrack（每次 cues/offset/enabled 变化重建）

  // ★ 2026-10-08 MPV 内核：外挂字幕改走 mpv（`sub-add` 读 SRT 文件；字号/位置换算见 shared/player.mpvFontSize/mpvSubPos）

  // ★ 2026-10-08 MPV 内核：画面比例改走 mpv 属性（keepaspect / panscan / video-aspect-override）
  usePlayerKernelFitSync({ enabled: allowMpv, kernel, fit, sendCommand: kCmd });

  // 字号/位置变化时保存偏好

  // Preference persistence and its imperative volume mirror belong to the preference feature.
  usePlayerPreferencePersistence({
    volume: vol,
    rate,
    subtitleOffset: subOffset,
    fit,
    spdif,
    volumeRef: volRef,
    syncPreferences,
  });


  const toggleEpPanel = toggleEpisodesPanel;

  // 键盘 ↑/↓ 调节音量时，短暂展开音量面板（1s 后自动淡出）
  const flashVolume = volumeUi.flash;
  const flashVol = useCallback(() => {
    coordinateVolumeFlash(flashVolume);
  }, [coordinateVolumeFlash, flashVolume]);

  const onAutoChangeParse = props.onAutoChangeParse;
  const onPlaybackFailure = props.onPlaybackFailure;
  const handlePlaybackFailure = useCallback((time: number, reason: string) => {
    void reportPlaybackFailure(time, reason, {
      autoChangeParse: onAutoChangeParse,
      onPlaybackFailure,
      notify: showSkipToast,
    });
  }, [onAutoChangeParse, onPlaybackFailure, showSkipToast]);

  const parseName = props.parseName;
  useEffect(() => {
    if (parseName) {
      showSkipToast(`已自动切换至解析线路：${parseName}`);
    }
  }, [parseName, showSkipToast]);

  usePlayerPlaybackSessions({
    html5: {
      videoRef: ref,
      adaptiveAudioTracksRef,
      resourceName,
      onAudioTracks: audio.syncAdaptive,
      url,
      htmlUrl,
      progressKey,
      kernel,
      isImage,
      isAudio,
      liveHint,
      playbackSource: props.playbackSource,
      positionMemory: dependencies.playbackPositionMemory,
      runtime: dependencies.playbackRuntime,
      startTime: props.startTime,
      prefsRef,
      bossActiveRef,
      sessionState: playbackSessionState,
      handoff: playbackHandoff,
      updatePlaybackStatus,
      clearAuto,
      revealControls: poke,
      recoverHtmlPlayback,
      tryExternalFallback: tryConfiguredExternalFallback,
      handlePlaybackEnd,
      canAdvance,
      advance,
      showSkipToast,
      formatTime: formatPlaybackTime,
    },
    diagnostics: {
      videoRef: ref,
      active: kernel === 'html5' && !isImage && !isAudio,
      url: htmlUrl,
      title: resourceName,
      port: dependencies.mediaDiagnostics,
    },
    mpv: {
      port: dependencies.mpvPlaybackSession,
      spdif,
      onState: technical.onState,
      onEngineFailure: (failed, reason) => { engines.markFailure(failed, reason); recoverWithKernel('html5'); },
      onPlaybackFailure: handlePlaybackFailure,
      onAudioTracks: audio.sync,
      allowMpv,
      kernel,
      url,
      progressKey,
      playbackSource: props.playbackSource,
      positionMemory: dependencies.playbackPositionMemory,
      startTime: props.startTime,
      liveHint,
      rate,
      fit,
      stateRef: mpvStateRef,
      sessionState: playbackSessionState,
      timeRef: mpvTimeRef,
      sizeRef: mpvSizeRef,
      volumeRef: volRef,
      handoff: playbackHandoff,
      updatePlaybackStatus,
      reportResolution,
      canAdvance,
      advance,
      seek: kSeek,
      showSkipToast,
      clearAuto,
      handlePlaybackEnd,
    },
  });

  const togglePlay = () => {
    if (kPaused()) kPlay();
    else kPause();
  };

  const toggleMiniMode = useCallback(() => {
    props.onToggleMini?.();
  }, [props]);

  const cycleFitMode = useCallback(() => {
    const next = cyclePlayerFit(fit);
    setFit(next.fit);
    showSkipToast(next.notice);
  }, [fit, setFit, showSkipToast]);

  const onSurfaceClick = usePlayerSurfaceGesture({
    mini,
    onTogglePlayback: togglePlay,
    shouldIgnoreClick: boost.consumeClick,
  });

  // ★ 播放器键盘（参照用户期望 / Playhub 快捷键）：
  //   空格：播放/暂停；
  //   ←/→ 单击：±5s；长按(>500ms 仍按住)：每 40ms 持续 ±2s（连续快退/快进）；
  //   ↑/↓：音量 +/− 5%（0..1）。
  //   P：画中画小窗置顶切换；A：画面比例切换；F：全屏切换；D：弹幕开关；[ / ]：字幕微调。
  //   用 window 级监听（video 元素不可聚焦）；输入框内不拦截；返回键(Backspace/Alt+←)仍在 App 全局处理。
  usePlayerKeyboardShortcuts({
    videoRef: ref,
    isMpv: kIsChild,
    isPaused: kPaused,
    play: kPlay,
    pause: kPause,
    getTime: kTime,
    getDuration: kDur,
    seek: kSeek,
    getVolume: () => volRef.current,
    setVolume: kSetVol,
    showVolume: flashVol,
    revealControls: poke,
    exitMpvFullscreen,
    shouldExitFullscreen: () => !!props.allowMpv && fullRef.current,
    setBoost: boost.setBoost,
    onStepSubtitleOffset: (delta: -0.5 | 0.5) => subtitle.onAppearanceCommand({ type: 'step-offset', delta }),
    onToggleDanmaku: toggleDanmaku,
    onToggleMini: toggleMiniMode,
    onCycleFit: cycleFitMode,
    onToggleFullscreen: () => { if (!mini) void toggleFull(); },
  }, dependencies.keyboardShortcuts);

  // ---- 老板键：进入 → 暂停 + 静音（窗口被主进程隐藏）；退出 → 恢复原音量与原播放状态 ----
  const bossKeyPlaybackPort = useMemo<BossKeyPlaybackPort>(() => ({
      hasPlaybackSurface: () => !!ref.current || kIsChild(),
      isPaused: kPaused,
      volume: () => volRef.current,
      setActive: (active: boolean) => { bossActiveRef.current = active; },
      pause: kPause,
      play: kPlay,
      setVolume: kSetVol,
      publishPaused: (paused: boolean) => updatePlaybackStatus({ paused }),
  }), [kIsChild, kPause, kPaused, kPlay, kSetVol, bossActiveRef, updatePlaybackStatus, volRef]);
  useBossKeyPlaybackEvents(dependencies.bossKeyPlaybackEvents, bossKeyPlaybackPort);

  // ★ 2026-09-28（用户要求）：字幕/弹幕图标手势 —— 左键单击=开关，右键或长按=打开调整框（三者互斥）
  // ★ 2026-09-30（用户要求）：外部播放器**不再由内置播放器跳转** —— 设置里勾选「启用点播外部播放器」
  //   且填了路径后，点播直接由外部播放器播放（见 renderer/lib/externalPlay.ts），故此处无「外部播放器」按钮/面板。
  //   ★ 2026-10-08：总开关 = 配置页勾选项（未勾选时即使有路径也走内置播放器）。
  //   地址解析（client.play）与历史记录都在 externalPlay 里完成，播放器窗口根本不会打开。

  const controlAvailability = resolvePlayerControlAvailability({
    live: isLive,
    skipSegmentsUsable: skipUsable,
    allowMpv,
    kernel,
    episodeCount: props.episodes?.length ?? 0,
  });
  const playerControlsModel: PlayerControlsViewModel = {
    mini, isLive, currentTime: cur, duration: dur, formatPlaybackTime,
    transport: { paused, canPrev, canNext, onPrev: handlePrev, onNext: handleNext, onToggle: togglePlay },
    technicalBar: { active: kernel === 'mpv', error: mpvErr, mpvTech: technical.tech, fmtNet: formatNetworkSpeed },
    progressBar: controlAvailability.progressVisible ? {
      currentTime: cur, duration: dur, buffered, canSeek: () => !!ref.current || kIsChild(), getCurrentTime: kTime, seekTo: kSeek, formatTime: formatPlaybackTime,
      onContextMenu: (position, time) => {
        if (!skipUsable || !dur || time == null) return false;
        const point = resolveProgressMenuPosition(position, dependencies.playerViewport.viewport(), { width: 248, height: 196 });
        setSkipMenu({ x: point.clientX, y: point.clientY, t: time });
        return true;
      },
    } : null,
    skipMenu, skipMenuRef, hasSkipSegments: skipSeg.intro > 0 || skipSeg.outro > 0,
    skipMenuActions: {
      setIntro: () => { const intro = captureIntroFromMenu(); if (intro !== undefined) showSkipToast('片头结束点设为 ' + formatPlaybackTime(intro)); },
      setOutro: () => { const outro = captureOutroFromMenu(dur); if (outro !== undefined) showSkipToast('片尾起点设为剩 ' + formatPlaybackTime(outro)); },
      clear: () => { clearSkipFromMenu(); showSkipToast('已清除本集跳过点'); },
      cancel: dismissSkipMenu,
    },
    volume: { volume: vol, open: volOpen, hidden: subPanel || dmPanel, inputRef: volumeUi.inputRef, onFocusChange: volumeUi.setFocused, onPointerEnter: () => volumeHover.enter(), onPointerLeave: () => volumeHover.leave(), onChange: kSetVol, onPointerStart: volumeUi.beginDrag, onPointerEnd: volumeUi.endDrag, onToggleMute: () => { kSetVol(volRef.current > 0 ? 0 : vol || 1); flashVol(); } },
    dlna: { ...dlna.model, onToggle: dlna.actions.toggle, onRefresh: dlna.actions.searchDevices, onCast: dlna.actions.castTo },
    subtitle: { embeddedTracks: technical.subtitles, sid: technical.sid, onSelectTrack: kernel !== 'html5' ? id => { void sendKernelCommandWithFeedback({ type: 'sid', value: id }); } : undefined, enabled: subEnabled, open: subPanel, activeSubtitle: subActive, fontSize: subFont, bottom: subBottom, offset: subOffset, query: subQuery, searching: subSearching, tokenHint: subTokenHint, message: subMsg, candidates: subCands, resourceName, panelRef: subPanelHost, onAnchorPointerEnter: () => subHover.enter(), onAnchorPointerLeave: () => subHover.leave(), onClose: () => { subHover.cancel(); setSubPanel(false); }, onPanelPointerEnter: () => subHover.enter(true), onPanelPointerLeave: () => subHover.leave(), onToggle: toggleSub, onAppearanceCommand: subtitleAppearanceCommand, onQueryChange: setSubQuery, onRestoreQuery: restoreSubtitleQuery, onSearch: () => { void doSearch(); }, onSelectCandidate: selectSub },
    danmaku: { enabled: dmEnabled, enabledSourceCount: dmCfg.endpoints.filter((endpoint) => endpoint.enabled !== false).length, open: dmPanel, activeEpisodeId: dmActiveEp, message: dmMsg, settings: dmCfg, candidates: dmCands, searching: dmSearching, query: dmQuery, episode: dmEp, sourcesOpen: dmSrcPanel, customText: dmCustomText, panelRef: dmPanelHost, onAnchorPointerEnter: () => dmHover.enter(), onAnchorPointerLeave: () => dmHover.leave(), onClose: () => { dmHover.cancel(); setDmPanel(false); }, onPanelPointerEnter: () => dmHover.enter(true), onPanelPointerLeave: () => dmHover.leave(), onToggle: toggleDanmaku, onSettingsCommand: dispatchDanmakuSettings, onQueryChange: setDmQuery, onEpisodeChange: setDmEp, onToggleSources: toggleDanmakuSources, onCustomEndpointsTextChange: setDmCustomText, onSearch: () => { void matchDanmaku(dmQuery, dmEp, { fresh: true }); }, onCandidateSelect: applyDanmaku },
    skipSegments: controlAvailability.skipSegmentsVisible ? { segments: skipSeg, hasSegments: skipSeg.intro > 0 || skipSeg.outro > 0, inheritedFrom: skipInheritFrom, draft: skipDraft, open: skipPanel, onDraftCommand: dispatchSkipDraftCommand, onToggle: toggleSkipPanel, onSave: saveSkipDraft, onClear: () => { clearSkipSegments(); showSkipToast('已清除本集跳过点'); } } : null,
    rate: { rate, onRateChange: kSetRate },
    kernel: controlAvailability.kernelSelectorVisible ? { kernel, preference: kernelPref, choices: engines.choices, containerRef: wrapRef, onSelect: preference => switchKernel(resolvePreference(preference), true, preference), onOpen: openKernelPanel } : null,
    kernelTools: controlAvailability.kernelToolsVisible ? { statsOpen, onToggleStats: toggleStats, keysOpen, onToggleKeys: toggleKeys } : null,
    superResolution: { visible: controlAvailability.superResolutionVisible, active: controlAvailability.superResolutionActive, info: superResolution.info, mode: superResolution.mode, feedback: superResolution.feedback, open: superResolution.open, containerRef: wrapRef, onOpen: () => openPanel('superResolution'), onClose: () => superResolution.setOpen(false), onSelect: value => { void superResolution.apply(value); poke(); } },
    audio: { spdif, effectiveSpdif: technical.tech?.spdif, onSpdifChange: value => { const next = normalizeSpdif(value); setSpdif(next); if (kernel === 'mpv') void sendKernelCommandWithFeedback({ type: 'audio-spdif', value: next }); }, open: audio.open, tracks: audio.tracks, aid: audio.aid, isMpv: kernel === 'mpv', containerRef: wrapRef, onOpen: () => openPanel('audio'), onClose: () => audio.setOpen(false), onSelect: audio.apply },
    fit: { fit, open: fitPanel, onFitSelect: setFit, onFitOpen: () => openPanel('fit'), onFitPointerEnter: () => openPanel('fit'), onFitPointerLeave: () => setFitPanel(false) },
    episodes: controlAvailability.episodeSelectorVisible ? { open: epPanel, onToggle: toggleEpPanel } : null,
    fullscreen: { active: full, onToggle: toggleFull },
  };
  const onSurfaceDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (mini || (event.target as HTMLElement).closest('.vp-eppanel')) return;
    toggleFull();
  }, [mini, toggleFull]);
  const contextActions = {
    onInfo: () => { contextMenu.toggleInfo(); contextMenu.closeMenu(); },
    onCopy: () => { void contextMenu.copyAddress(); contextMenu.closeMenu(); },
  };
  const onGoToBind = useCallback(() => { void dependencies.driveBindingNavigation.openBindingSettings(); }, [dependencies.driveBindingNavigation]);
  const onRetry = useCallback(() => dependencies.playerWindowReload.reload(), [dependencies.playerWindowReload]);
  return {
    identity: { url, resourceName, danmakuTitle, playTitle, mini },
    media: {
      kind: mediaKind,
      playbackSource: props.playbackSource,
      cover: props.cover,
      episodeNumber: (props.epIndex ?? 0) + 1,
      episodeCount: props.epTotal,
      startTime: props.startTime,
    },
    navigation: { canPrev, canNext, onPrev, onNext },
    surface: {
      videoRef: ref, containerRef: wrapRef, controlsVisible: ui, full, toggleFull, fit, subFont, subBottom,
      onPointerActivity: poke, onPointerLeave: hideIfNoPanel, onDoubleClick: onSurfaceDoubleClick,
      onContextMenu: contextMenu.handleContextMenu, onTogglePlayback: onSurfaceClick, onBoostMouseDown: boost.onMouseDown,
    },
    playback: {
      kernel, mpvTimeRef, mpvSizeRef, paused, currentTime: cur, duration: dur, resolution: resText,
      loading, buffering, relaySpeed, netSpeed, error: err, mpvError: mpvErr, isLive,
    },
    danmaku: { items: dmItems, enabled: dmEnabled, settings: dmCfg },
    contextMenu: { position: contextMenu.position, menuRef: contextMenu.menuRef, infoOpen: contextMenu.infoOpen, actions: contextActions },
    episodes: {
      items: props.episodes,
      current: props.epIndex ?? -1,
      open: epPanel,
      title: playTitle || resourceName || '选集',
      page: episodePanel.page,
      onPageChange: episodePanel.setPage,
      onClose: episodePanel.close,
      onSelect: episodePanel.selectEpisode,
    },
    technicalPanels: { audioTracks: audio.tracks, subtitles: technical.subtitles, pluginKeys, active: kernel === 'mpv', statsOpen, keysOpen, mini, mpvTech: technical.tech, formatNetworkSpeed, onStatsClose: () => setStatsOpen(false), onKeysClose: () => setKeysOpen(false) },
    info: { title: playTitle, currentTime: cur, duration: dur, resolution: resText },
    toast: { skip: skipToast, boost: boost.tip, commandError },
    status: {
      loading, buffering, loadingSpeed: formatNetworkSpeed(relaySpeed && relaySpeed > 0 ? relaySpeed : netSpeed && netSpeed > 0 ? netSpeed : 0),
      error: err, mpvError: mpvErr, paused, mini, episodePanelOpen: epPanel, driveProvider: driveBinding.provider,
      bindModalOpen: driveBinding.modalOpen, resourceName, allowMpv, mpvAvailable: !!mpvInfo?.available, kernel,
      endAll, formatBadges: technical.badges, kernelNotice: engines.notice,
      onPlay: onSurfaceClick, onPlayMouseDown: boost.onMouseDown, onGoToBind, onOpenBindModal: driveBinding.openModal,
      onDismissBindNotice: driveBinding.dismissNotice, onCloseBindModal: driveBinding.closeModal, onBindSaved: driveBinding.onSaved,
      onSwitchKernel: (nextKernel: Kernel) => switchKernel(nextKernel), onRetry,
    },
    controls: playerControlsModel,
  };
}

export type VideoPlayerPresenterModel = ReturnType<typeof useVideoPlayerPresenter>;
