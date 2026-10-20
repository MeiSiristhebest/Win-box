// src/renderer/components/VideoPlayer.tsx
// 现代化播放器：hls.js(m3u8) + mpegts.js(flv) + 原生(其它)。
// 自定义控制层：播放/暂停、进度条(可拖)、时间、音量、倍速、全屏、
// 大播放键、加载态、错误提示+重试、闲置自动隐藏、直播标识。
import type HlsInstance from 'hls.js';
import { usePlayerAudioTracks } from '../features/playback/usePlayerAudioTracks';
import { PlayerAudioControl } from '../features/playback/PlayerAudioControl';
import { useSuperResolution } from '../features/playback/useSuperResolution';
import { PlayerSuperResolutionControl } from '../features/playback/PlayerSuperResolutionControl';
import { PlayerEpisodePanel } from '../features/playback/PlayerEpisodePanel';
import { usePlaybackBoost } from '../features/playback/usePlaybackBoost';
import { PlayerContextMenu, usePlayerContextMenu } from '../features/playback/PlayerContextMenu';
import { PlayerInfoOverlay } from '../features/playback/PlayerInfoOverlay';
import { useMediaDiagnostics } from '../features/playback/useMediaDiagnostics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useHoverDelay } from '../lib/useHoverDelay';
import { usePlayerPanelPosition } from '../lib/usePlayerPanelPosition';
import { playbackProgressKey, type PlaybackSourceRef } from '../lib/playbackProgress';
import { client } from '../api/client';
import { resolvePlayTarget } from '../lib/playTarget';
import { formatVideoResolution } from '../lib/videoResolution';
// ★ 2026-09-30（用户要求）：图片/音乐分流 + 直播态判定（纯函数，见 lib/mediaKind.ts）
import { detectMediaKind, isLikelyLive } from '../lib/mediaKind';
// 跳过判据位于 lib/skipSegments.ts，编辑与存储状态由 useSkipSegmentsController 管理。
import ImageViewer from './ImageViewer';
import AudioPlayer from './AudioPlayer';
// ★ 2026-09-29 DLNA 投屏（SSDP 发现 + AVTransport 三动作；对位 CatClaw Dlna.cs）
import { loadPlayerPrefs, savePlayerPrefs, type PlayerPrefs, type PlayerFit } from '../lib/playerPrefs';
// ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核 —— 双内核选择纯函数
import { isEngineKernel, resolveKernel, type Kernel, type KernelPref } from '../lib/kernel';
import { emptyMpvKernelState, normalizeSpdif, type MpvKernelState, type MpvStatus } from '../../shared/player';
import DriveBindModal from './DriveBindModal';
import { driveProviderFromUrl, driveProviderLabel } from '../../shared/driveProvider';
import DanmakuOverlay from './DanmakuOverlay';
import { DanmakuPanel } from '../features/playback/DanmakuPanel';
import { SubtitlePanel } from '../features/playback/SubtitlePanel';
import { SkipSegmentsControl } from '../features/playback/SkipSegmentsControl';
import { DlnaCastControl } from '../features/playback/DlnaCastControl';
import { useSubtitlePlayback } from '../features/playback/useSubtitlePlayback';
import { useDanmakuController } from '../features/playback/useDanmakuController';
import { usePlayerKeyboardShortcuts } from '../features/playback/usePlayerKeyboardShortcuts';
import { useAutoNextEpisode } from '../features/playback/useAutoNextEpisode';
import { PlayerProgressBar } from '../features/playback/PlayerProgressBar';
import { PlayerTransportControls } from '../features/playback/PlayerTransportControls';
import { PlayerVolumeControl } from '../features/playback/PlayerVolumeControl';
import { PlayerRateControl, PlayerFitControl } from '../features/playback/PlayerPlaybackOptions';
import { createPlayerKernelAdapter } from '../features/playback/playerKernelAdapter';
import { usePlayerControlsVisibility } from '../features/playback/usePlayerControlsVisibility';
import { usePlayerFullscreen } from '../features/playback/usePlayerFullscreen';
import { useSkipSegmentsController } from '../features/playback/useSkipSegmentsController';
import { usePlayerVolumeController } from '../features/playback/usePlayerVolumeController';
import { useMpvPlaybackSession } from '../features/playback/useMpvPlaybackSession';
import { useHtml5PlaybackSession } from '../features/playback/useHtml5PlaybackSession';
import { usePluginKeymaps } from '../lib/pluginKeymaps';
import { runPluginCommand } from '../lib/pluginCommands';
import { useAppDialog } from './AppDialog';
import { usePluginPlaybackEngines } from '../features/playback/usePluginPlaybackEngines';
import { PlayerKernelControl } from '../features/playback/PlayerKernelControl';
import { useMpvTechnicalState } from '../features/playback/useMpvTechnicalState';
import { PlayerTechnicalPanels } from '../features/playback/PlayerTechnicalPanels';
import { PlayerTechnicalBar } from '../features/playback/PlayerTechnicalBar';

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** 实时网速格式化（入参 KB/s），统一以 M/S 形式显示 */
function fmtNet(kbs: number): string {
  if (!Number.isFinite(kbs) || kbs <= 0) return '';
  return kbs >= 1024 ? `${(kbs / 1024).toFixed(2).replace(/\.?0+$/, '')} M/S` : `${Math.round(kbs)} K/S`;
}

// 可选换集导航：由外层（PlayPage）传入当前集可否切换与回调。
// 不传 props 时（如直播/无集数源）不渲染换集按钮，保持播放器纯净。
interface VideoPlayerProps {
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
  /** 视频分辨率回传到窗口标题；未知/换源时为空。 */
  onResolutionChange?: (resolution: string) => void;
  /** 可搜索的剧名副名（用于弹幕匹配）。缺省（如直播/无集数源）则不显示弹幕按钮。 */
  danmakuTitle?: string;
  /** 小窗口模式：控制条只保留 上/下集 + 播放暂停；全屏等功能消失 */
  mini?: boolean;
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

/** ★ 2026-09-28（用户要求）：控制条图标的「长按开面板」手势状态 */
/** 长按判定阈值（ms）：与右键同为「打开调整框」 */

export default function VideoPlayer(props: VideoPlayerProps) {
  const { url, canPrev, canNext, onPrev, onNext, resourceName, danmakuTitle, mini = false, driveBindProvider = null, playTitle = '' } = props;
  /**
   * ★ 2026-09-30（用户要求「图片和音乐要有独立的播放器」）：先判型再分流 ——
   *   图片（图集源的每一「集」= 一张图）与音频（mp3/flac…）分别由 ImageViewer / AudioPlayer 接管，
   *   不再喂给 `<video>`（此前图片必黑屏、音频只闻其声不见其形）。
   *   判定见 lib/mediaKind.ts（只认协议/扩展名，判不准仍回落视频，不臆造）。
   */
  const dialog = useAppDialog();
  const pluginKeys = usePluginKeymaps('player', command => { void runPluginCommand(command, message => dialog.confirm(message, { title: command.label })).then(result => showSkipToast(result.message)); });
  const mediaKind = detectMediaKind(url);
  const isImage = mediaKind === 'image';
  const isAudio = mediaKind === 'audio';
  const liveHint = isLikelyLive(url);
  const progressKey = playbackProgressKey(url, props.playbackSource);
  const ref = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  /** ★ 单击/双击判别：双击窗口内到达第二击 → 取消待执行的单击暂停（见 onSurfaceClick） */
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- ★ 2026-09-24：播放器设置记忆（音量 / 倍速 / 字幕时间偏移）----
  //   挂载时一次性读取（localStorage，主窗口与独立播放器窗口同源共享），
  //   变更时由下方 persist effect 落盘 → 下次打开播放器保持上次的设置。
  const prefsRef = useRef<PlayerPrefs | null>(null);
  if (!prefsRef.current) prefsRef.current = loadPlayerPrefs();
  /** 老板键（暂停+静音）期间不改写记忆：临时把音量压到 0 不应污染「上次音量」 */
  const bossActiveRef = useRef(false);

  const [paused, setPaused] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [resText, setResText] = useState('');
  // ★ 2026-09-29 DLNA 投屏：设备弹层状态
  const [buffered, setBuffered] = useState(0);
  const [vol, setVol] = useState(() => prefsRef.current!.vol);
  const [rate, setRate] = useState(() => prefsRef.current!.rate);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  /**
   * ★ 2026-09-30：**当前流的直播结论**（由引擎给出，不是靠时长猜）——
   *   HLS 由 `LEVEL_LOADED.details.live` 写、flv/ts 在建播放器时按形态写（天生直播）；
   *   `onDuration` 只读它（+ 原生直连的 Infinity 兜底），避免被 hls 直播的有限时长纠正成点播。
   */
  const liveKindRef = useRef(false);

  // ---- ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核（双内核：默认 HTML5，mpv 为一键/自动备选）----
  //   仅独立播放器窗口（allowMpv=true）启用：该窗口 transparent，mpv 画面从播放区透明处透出，
  //   HTML 控制条/弹幕仍绘制在 mpv 之上且点击归 HTML（PoC 实测；地址链路不变，mpv 直接吃既有 /play 中继）。
  const allowMpv = !!props.allowMpv && !isImage && !isAudio && mediaKind !== 'unsupported';
  const [mpvInfo, setMpvInfo] = useState<MpvStatus | null>(null);
  const [kernelPref, setKernelPref] = useState<KernelPref>(() => prefsRef.current!.kernel);
  const [kernel, setKernel] = useState<Kernel>('html5');
  const [spdif, setSpdif] = useState(() => normalizeSpdif(prefsRef.current!.spdif));
  const engines = usePluginPlaybackEngines(allowMpv, url, mpvInfo);
  const technical = useMpvTechnicalState(url, kernel);
  const [statsOpen, setStatsOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const kernelRef = useRef<Kernel>('html5');
  kernelRef.current = kernel;
  /** 防止连续点击在原生全屏退出完成前排入多个相反的内核切换。 */
  const kernelSwitchRef = useRef<Kernel | null>(null);
  const kernelPrefRef = useRef<KernelPref>(kernelPref);
  kernelPrefRef.current = kernelPref;
  const audio = usePlayerAudioTracks(url, kernel, hlsRef);
  const superResolution = useSuperResolution(allowMpv && kernel === 'mpv');
  const [epPanel, setEpPanel] = useState(false);
  const controlsRevealRef = useRef<() => void>(() => undefined);
  const revealControls = useCallback(() => controlsRevealRef.current(), []);
  const { full, fullRef, setFull, toggleFull, exitMpvFullscreen } = usePlayerFullscreen({
    allowMpv,
    nativeWindow: !!props.allowMpv,
    kernel,
    mini,
    containerRef: wrapRef,
    revealControls,
  });
  const [htmlSource, setHtmlSource] = useState<{ source: string; url: string; width?: number; height?: number } | null>(null);
  const htmlUrl = htmlSource?.source === url ? htmlSource.url : '';
  const resolutionCallbackRef = useRef(props.onResolutionChange);
  resolutionCallbackRef.current = props.onResolutionChange;
  const resolutionRef = useRef('');
  const reportResolution = useCallback((width: unknown, height: unknown) => {
    const next = formatVideoResolution(width, height);
    if (resolutionRef.current === next) return;
    resolutionRef.current = next;
    setResText(next);
    resolutionCallbackRef.current?.(next);
  }, []);
  useEffect(() => {
    reportResolution(0, 0);
  }, [url, kernel, reportResolution]);
  const sourceResolution = htmlSource?.source === url ? formatVideoResolution(htmlSource.width, htmlSource.height) : '';
  useEffect(() => {
    if (kernel !== 'html5' || !htmlUrl || isImage || isAudio) return;
    const v = ref.current;
    if (!v) return;
    const update = () => {
      // 兼容流可能降采样至 1080p；标题优先显示 ffprobe 得到的原资源尺寸。
      if (sourceResolution) reportResolution(htmlSource?.width, htmlSource?.height);
      else reportResolution(v.videoWidth, v.videoHeight);
    };
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update); // HLS 自适应清晰度切换也会更新
    v.addEventListener('canplay', update);
    if (sourceResolution) update();
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
      v.removeEventListener('canplay', update);
    };
  }, [url, htmlUrl, htmlSource, sourceResolution, kernel, isImage, isAudio, reportResolution]);
  useEffect(() => {
    if (kernel !== 'html5' || !url || isAudio || isImage) return;
    setHtmlSource(null);
    let alive = true;
    let sessionUrl = '';
    const controller = new AbortController();
    const target = resolvePlayTarget(url);
    const needsProbe = /^http:\/\/127\.0\.0\.1:\d+\/play\?/.test(url) && /(?:baidu\.com|baidupcs\.com|quark\.cn|pds\.uc\.cn)/i.test(target) && !/\.m3u8(?:[?#]|$)/i.test(target);
    if (!needsProbe) { setHtmlSource({ source: url, url }); return; }
    setLoading(true); setErr('');
    const endpoint = new URL('/html/prepare', url);
    endpoint.searchParams.set('url', url);
    void fetch(endpoint, { signal: controller.signal }).then(async r => {
      const result = await r.json();
      if (!r.ok || !result.url) throw new Error(result.error || '媒体兼容处理失败');
      if (result.session) sessionUrl = new URL(`/html/${result.session}/release`, url).href;
      if (alive) setHtmlSource({ source: url, url: result.url, width: result.width, height: result.height });
      else if (sessionUrl) void fetch(sessionUrl).catch(() => undefined);
    }).catch(e => { if (alive) { setLoading(false); setErr(`HTML 播放准备失败：${e.message}`); } });
    return () => { alive = false; controller.abort(); if (sessionUrl) void fetch(sessionUrl).catch(() => undefined); };
  }, [url, kernel, isAudio, isImage]);
  /** mpv 内核状态镜像（主进程 200ms 节流推送；进度条/弹幕/跳过片头片尾都读它） */
  const mpvStateRef = useRef<MpvKernelState>(emptyMpvKernelState());
  const mpvTimeRef = useRef(0); // 弹幕时间源（number）
  const mpvSizeRef = useRef({ w: 0, h: 0 }); // 弹幕绘制区（画面物理像素）
  /** 内核切换时的续播位置（html5→mpv / mpv→html5 都不断点） */
  const mpvResumeRef = useRef(0);
  const html5ResumeRef = useRef(0);
  const handoffRef = useRef<{ url: string; paused: boolean } | null>(null);
  const volRef = useRef(prefsRef.current!.vol);
  const [mpvErr, setMpvErr] = useState('');

  const playbackKernel = useMemo(
    () => createPlayerKernelAdapter({
      getKernel: () => kernelRef.current,
      getVideo: () => ref.current,
      getMpvState: () => mpvStateRef.current,
      sendMpvCommand: (command) => client.mpvCmd(command),
      sendEngineCommand: (command) => client.engineCmd(command),
      setCurrentTime: setCur,
      setVolume: setVol,
      setRate,
      volumeRef: volRef,
    }),
    [],
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
  const boost = usePlaybackBoost(rate, setTemporaryRate, mini, url);

  // MPV 可用性（仅播放器窗口需要；一处探活供切换按钮/自动选择用）
  useEffect(() => {
    if (!allowMpv) return;
    void client
      .mpvStatus()
      .then((s) => setMpvInfo(s))
      .catch(() => setMpvInfo(null));
  }, [allowMpv]);

  // 本次生效内核（显式偏好优先；auto 按资源形态；mpv 不可用一律回落 html5）
  useEffect(() => {
    if (!allowMpv) {
      setKernel('html5');
      return;
    }
    setKernel(resolveKernel(kernelPref, url, { mpvAvailable: !!mpvInfo?.available, engines: engines.usable }));
  }, [allowMpv, mpvInfo, kernelPref, url, engines.usable]);

  // mpv 激活时给页面打标（global.css 据此把播放区整链透明化，让 mpv 子窗口透出）
  useEffect(() => {
    const root = document.documentElement;
    if (kernel !== 'html5') root.dataset.mpv = '1';
    else delete root.dataset.mpv;
    return () => {
      delete root.dataset.mpv;
    };
  }, [kernel]);

  /** 手动切换内核（记住选择；mpv 侧/HTML5 侧都从当前位置续播） */
  const switchKernel = (k: Kernel, persist = true, preference: KernelPref = k) => {
    if (kernelSwitchRef.current) return;
    if (k === kernelRef.current) {
      if (persist) { setKernelPref(preference); savePlayerPrefs({ kernel: preference }); }
      return;
    }
    kernelSwitchRef.current = k;
    boost.release();
    if (isEngineKernel(k)) engines.retry();
    const t = kTime();
    handoffRef.current = { url, paused: kPaused() && !err && !mpvErr };
    if (!kIsChild() && ref.current) {
      volRef.current = ref.current.volume;
      setVol(ref.current.volume);
      setRate(ref.current.playbackRate);
    }
    clearAuto();
    if (k !== 'html5') mpvResumeRef.current = t;
    else html5ResumeRef.current = t;
    // MPV fullscreen is a native BrowserWindow state, while HTML5 fullscreen
    // belongs to the document.  Do not carry one mechanism into the other:
    // leave the current fullscreen mode first, then switch the kernel.  This
    // also guarantees the native player bounds are restored before HTML5 takes
    // over the same window.
    const finish = () => {
      if (kernelSwitchRef.current !== k) return;
      kernelSwitchRef.current = null;
      setFull(false);
      setKernel(k);
      // Update the preference only after the fullscreen transition has
      // completed; otherwise the kernel effect can race bounds restoration.
      if (persist) {
        setKernelPref(preference);
        savePlayerPrefs({ kernel: preference });
      }
    };
    if ((props.allowMpv && fullRef.current) || kernelRef.current !== 'html5') {
      void client.playerSetFullscreen(false).then(finish).catch(finish);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().then(finish).catch(finish);
    } else {
      finish();
    }
  };

  /** mpv 可用性镜像（供 effect 内闭包读最新值） */
  const mpvAvailRef = useRef(false);
  mpvAvailRef.current = !!mpvInfo?.available;
  /**
   * ★ 2026-10-08 HTML5 内核失败时的兜底：偏好为「自动」且 mpv 可用 → 直接改走 mpv
   *   （4K / HEVC / HDR 这类「只有解了才知道播不动」的常见救法；显式选了 HTML5 的用户只提示、不强切）。
   * 返回是否已改道（true = 调用方不要再上屏 HTML5 错误）。
   */
  const tryMpvFallback = () => {
    if (!allowMpv || !mpvAvailRef.current) return false;
    if (kernelRef.current !== 'html5' || kernelPrefRef.current !== 'auto') return false;
    if (liveKindRef.current) return false;
    switchKernel('mpv', false);
    return true;
  };

  const {
    segments: skipSeg,
    inheritedFrom: skipInheritFrom,
    panelOpen: skipPanel,
    setPanelOpen: setSkipPanel,
    menu: skipMenu,
    setMenu: setSkipMenu,
    toast: skipToast,
    draft: skipDraft,
    setDraft: setSkipDraft,
    segmentsRef: skipSegRef,
    introFiredRef: skipInFiredRef,
    outroFiredRef: skipOutFiredRef,
    menuElementRef: skipMenuRef,
    usable: skipUsable,
    showToast: showSkipToast,
    commit: commitSkip,
    saveDraft: saveSkipDraft,
  } = useSkipSegmentsController({
    resourceKey: props.skipResourceKey,
    episodeKey: props.skipEpisodeKey,
    episodeLabel: props.skipEpisodeLabel,
    resourceName,
    isLive,
  });
  const contextMenu = usePlayerContextMenu(mini, url, props.skipEpisodeKey, showSkipToast);
  // ---- 实时网速（加载/缓冲时显示；不加载时不显示）----
  const [netSpeed, setNetSpeed] = useState<number | null>(null);
  // 中继层真实转发测速（主进程 /play 统计字节推过来，最可靠；普通直连/hls/flv 用 netSpeed）
  const [relaySpeed, setRelaySpeed] = useState<number | null>(null);
  useEffect(() => client.netSpeed((v) => setRelaySpeed(v)), []);
  // ---- 网盘 cookie 未绑定提示：播放网盘资源但配置页未绑定对应网盘凭据 → 提示去配置页绑定 ----
  const [needBind, setNeedBind] = useState<string | null>(null);
  const bindDismissedRef = useRef(false); // 本次播放会话内已点「知道了」→ 不再打扰（重新进入播放页会重新检测）
  /**
   * ★ 2026-09-29（用户要求「解析到网盘资源播放时，若未绑定就弹出绑定窗口」）：
   *   检出未绑定后**自动打开绑定弹窗**（预选该网盘）。
   *   ★ 用户口径（2026-09-29 追加）：「原版点播页检测的绑定条不要取消，只是**新增**一个播放时检测弹窗」——
   *     因此点播页的横幅/入口、本提示条与原「去点播页绑定」按钮**全部保留**，弹窗只作新增路径。
   */
  const [bindOpen, setBindOpen] = useState(false);
  useEffect(() => {
    // provider 来源：主进程 play 检出（首选）→ URL 兜底（历史直连等未走 play 解析的路径，解析 /play?ck=）
    const prov = (driveBindProvider && String(driveBindProvider).trim()) || driveProviderFromUrl(url) || '';
    if (!prov) { setNeedBind(null); return; }
    if (bindDismissedRef.current) return;
    let alive = true;
    void client
      .driveGet()
      .then((tokens) => {
        if (!alive || tokens[prov]) return; // 未绑定才提示；已绑定不打扰
        setNeedBind(prov);
        setBindOpen(true); // ★ 自动弹绑定窗口
      })
      .catch(() => {
        if (!alive) return;
        setNeedBind(prov); // 查询失败也提示（宁可提示也别静默卡死）
        setBindOpen(true);
      });
    return () => { alive = false; };
  }, [url, driveBindProvider]);
  const [buffering, setBuffering] = useState(false);
  const volumeUi = usePlayerVolumeController();

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

  // ---- 外挂字幕 ----
  // ★ 2026-09-26：画面比例（播放器设置记忆；见 lib/playerPrefs.ts 的 PlayerFit）
  const [fit, setFit] = useState<PlayerFit>(() => prefsRef.current!.fit);
  const [fitPanel, setFitPanel] = useState(false);
  // ★ 2026-09-28（用户要求）：图标「左键开关 / 右键或长按开调整框」的手势状态（字幕、弹幕各一份）
  const subtitle = useSubtitlePlayback({
    videoRef: ref,
    url,
    resourceName,
    allowMpv,
    kernel,
    initialOffset: prefsRef.current!.subOffset,
  });
  const {
    enabled: subEnabled,
    offset: subOffset,
    setOffset: setSubOffset,
    fontSize: subFont,
    setFontSize: setSubFont,
    bottom: subBottom,
    setBottom: setSubBottom,
    panelOpen: subPanel,
    setPanelOpen: setSubPanel,
    query: subQuery,
    setQuery: setSubQuery,
    candidates: subCands,
    searching: subSearching,
    message: subMsg,
    activeSubtitle: subActive,
    tokenHint: subTokenHint,
    search: doSearch,
    selectCandidate: selectSub,
    toggle: toggleSub,
  } = subtitle;

  // Danmaku state and operations.
  const {
    enabled: dmEnabled,
    settings: dmCfg,
    setSettings: setDmCfg,
    items: dmItems,
    candidates: dmCands,
    searching: dmSearching,
    message: dmMsg,
    activeEpisodeId: dmActiveEp,
    sourcesOpen: dmSrcPanel,
    setSourcesOpen: setDmSrcPanel,
    customText: dmCustomText,
    setCustomText: setDmCustomText,
    query: dmQuery,
    updateQuery: setDmQuery,
    episode: dmEp,
    setEpisode: setDmEp,
    matchDanmaku,
    applyCandidate: applyDanmaku,
    toggle: toggleDanmaku,
  } = useDanmakuController({ url, resourceName, danmakuTitle, formatTime: fmt });
  const [dmPanel, setDmPanel] = useState(false);
  const volOpen = volumeUi.isOpen(subPanel || dmPanel);
  const { visible: ui, reveal: poke, hideIfNoPanel } = usePlayerControlsVisibility({
    isPaused: kPaused,
    panelOpen: subPanel || dmPanel || fitPanel || skipPanel || volOpen || audio.open || superResolution.open || epPanel || statsOpen || keysOpen,
  });
  controlsRevealRef.current = poke;
  useEffect(() => {
    const root = document.documentElement;
    if (ui || !props.allowMpv) delete root.dataset.pwinUi; else root.dataset.pwinUi = '0';
    return () => { delete root.dataset.pwinUi; };
  }, [ui, props.allowMpv]);

  // 切换集时清除旧字幕内容；搜索候选与请求代际由 useSubtitleSearch 管理。

  // 应用字幕到 TextTrack（每次 cues/offset/enabled 变化重建）

  // ★ 2026-10-08 MPV 内核：外挂字幕改走 mpv（`sub-add` 读 SRT 文件；字号/位置换算见 shared/player.mpvFontSize/mpvSubPos）

  // ★ 2026-10-08 MPV 内核：画面比例改走 mpv 属性（keepaspect / panscan / video-aspect-override）
  useEffect(() => {
    if (!allowMpv || kernel === 'html5') return;
    void kCmd({ type: 'fit', value: fit }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowMpv, kernel, fit]);

  // 字号/位置变化时保存偏好

  // ★ 2026-09-24：播放器设置记忆落盘（音量 / 倍速 / 字幕时间偏移）。
  //   prefsRef 同步指向最新值，供 url effect / onCanPlay 等闭包读取（避免闭包读到旧 state）。
  //   老板键（暂停+静音）期间只更新 ref、不写盘 —— 临时静音不该覆盖用户的上次音量。
  useEffect(() => {
    prefsRef.current = { vol, rate, subOffset, fit, kernel: kernelPrefRef.current, spdif };
    volRef.current = vol; // ★ 2026-10-08：适配层（kSetVol/键盘/老板键）读它
    if (bossActiveRef.current) return;
    savePlayerPrefs({ vol, rate, subOffset, fit, spdif });
  }, [vol, rate, subOffset, fit, spdif]);


  /** 开/关跳过设置面板（与字幕/弹幕/比例面板互斥） */
  const toggleSkipPanel = () => {
    setSubPanel(false);
    setDmPanel(false);
    setFitPanel(false);
    audio.setOpen(false);
    superResolution.setOpen(false);
    setEpPanel(false);
    setSkipPanel((p) => !p);
    poke();
  };

  const toggleEpPanel = () => {
    setSubPanel(false); setDmPanel(false); setFitPanel(false); setSkipPanel(false);
    audio.setOpen(false); superResolution.setOpen(false); setEpPanel(value => !value); poke();
  };

  // 键盘 ↑/↓ 调节音量时，短暂展开音量面板（1s 后自动淡出）
  const cancelPanelHoverRef = useRef<() => void>(() => undefined);
  const flashVolume = volumeUi.flash;
  const flashVol = useCallback(() => {
    cancelPanelHoverRef.current();
    setSubPanel(false);
    setDmPanel(false);
    flashVolume();
  }, [setSubPanel, setDmPanel, flashVolume]);

  useHtml5PlaybackSession({
    videoRef: ref,
    hlsRef,
    resourceName,
    onAudioTracks: audio.syncHls,
    url,
    htmlUrl,
    progressKey,
    kernel,
    isImage,
    isAudio,
    liveHint,
    playbackSource: props.playbackSource,
    startTime: props.startTime,
    prefsRef,
    bossActiveRef,
    liveKindRef,
    resumeRef: html5ResumeRef,
    volumeHandoffRef: handoffRef,
    skipSegmentsRef: skipSegRef,
    introFiredRef: skipInFiredRef,
    outroFiredRef: skipOutFiredRef,
    setError: setErr,
    setMpvError: setMpvErr,
    setLoading,
    setPaused,
    setCurrentTime: setCur,
    setDuration: setDur,
    setIsLive,
    setNetSpeed,
    setRelaySpeed,
    setBuffering,
    clearAuto,
    revealControls: poke,
    tryMpvFallback,
    handlePlaybackEnd,
    canAdvance,
    advance,
    showSkipToast,
    formatTime: fmt,
  });
  useMediaDiagnostics(ref, kernel === 'html5' && !isImage && !isAudio, htmlUrl, resourceName);

  /**
   * ★ 2026-10-08 MPV 内核会话：url/内核变化即重启（换集 = stop + start 新进程）；
   *   状态由主进程 MPV_STATE 事件驱动（进度条/弹幕/自动下一集/跳过片头片尾都据此推进）。
   */
  useMpvPlaybackSession({
    client,
    spdif,
    onState: technical.onState,
    onEngineFailure: (failed, reason) => { engines.markFailure(failed, reason); switchKernel('html5', false); },
    onAudioTracks: audio.sync,
    allowMpv,
    kernel,
    url,
    progressKey,
    playbackSource: props.playbackSource,
    startTime: props.startTime,
    liveHint,
    rate,
    fit,
    stateRef: mpvStateRef,
    liveKindRef,
    timeRef: mpvTimeRef,
    sizeRef: mpvSizeRef,
    resumeRef: mpvResumeRef,
    volumeRef: volRef,
    handoffRef,
    skipSegmentsRef: skipSegRef,
    setMpvError: setMpvErr,
    setLoading,
    setPaused,
    setCurrentTime: setCur,
    setDuration: setDur,
    setBuffered,
    setIsLive,
    setNetSpeed,
    setRelaySpeed,
    setBuffering,
    setPlaybackError: setErr,
    reportResolution,
    canAdvance,
    advance,
    seek: kSeek,
    showSkipToast,
    clearAuto,
    handlePlaybackEnd,
  });

  const togglePlay = () => {
    if (kPaused()) kPlay();
    else kPause();
  };

  /**
   * ★ 2026-09-26（用户要求）：**单击暂停 / 双击全屏的判别**。
   *   浏览器总在 dblclick 之前先派发两轮 click → 旧实现下「双击全屏」必然先暂停再播（观感：全屏前老要暂停一下）。
   *   修复：单击动作延迟到双击窗口（280ms，与系统双击间隔阈值一致）后再执行；
   *   第二击到达即取消待执行的单击动作 → 双击只切全屏、画面不闪暂停。
   *   小窗口模式没有双击全屏，单击立即生效（否则暂停有可感知的延迟）。
   */
  const onSurfaceClick = () => {
    if (boost.consumeClick()) return;
    if (mini) {
      togglePlay();
      return;
    }
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current); // 第二击 = 双击（交由 onDoubleClick 切全屏）→ 撤销这次暂停/播放
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      togglePlay();
    }, 280);
  };
  // 卸载时清掉未决的单击动作（避免对已销毁的 video 执行 play/pause）
  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  // ★ 播放器键盘（参照用户期望 / Playhub 快捷键）：
  //   空格：播放/暂停；
  //   ←/→ 单击：±5s；长按(>500ms 仍按住)：每 40ms 持续 ±2s（连续快退/快进）；
  //   ↑/↓：音量 +/− 5%（0..1）。
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
  });

  // ---- 老板键：进入 → 暂停 + 静音（窗口被主进程隐藏）；退出 → 恢复原音量与原播放状态 ----
  const bossSnapRef = useRef<{ wasPlaying: boolean; vol: number } | null>(null);
  useEffect(() => {
    const offEnter = client.bossOnEnter(() => {
      if (!ref.current && !kIsChild()) return;
      bossActiveRef.current = true; // 临时静音期间不写记忆（见上方 persist effect）
      bossSnapRef.current = { wasPlaying: !kPaused(), vol: volRef.current };
      kPause();
      kSetVol(0);
      setPaused(true);
    });
    const offExit = client.bossOnExit(() => {
      const snap = bossSnapRef.current;
      bossSnapRef.current = null;
      bossActiveRef.current = false;
      if (!snap) return;
      kSetVol(snap.vol);
      if (snap.wasPlaying) {
        kPlay();
        setPaused(false);
      }
    });
    return () => {
      offEnter();
      offExit();
    };
  }, [kIsChild, kPause, kPaused, kPlay, kSetVol]);

  // ★ 2026-09-28（用户要求）：字幕/弹幕图标手势 —— 左键单击=开关，右键或长按=打开调整框（三者互斥）
  const openPanel = (which: 'sub' | 'dm' | 'fit' | 'audio' | 'sr') => {
    subHover.cancel();
    dmHover.cancel();
    volumeHover.cancel();
    volumeUi.setHovered(false);
    volumeUi.clearFlash();
    setSubPanel(which === 'sub');
    setDmPanel(which === 'dm');
    setFitPanel(which === 'fit');
    audio.setOpen(which === 'audio');
    superResolution.setOpen(which === 'sr');
    setEpPanel(false);
    setSkipPanel(false); // ★ 与跳过面板互斥
    poke();
  };
  const subHover = useHoverDelay(open => open ? openPanel('sub') : setSubPanel(false));
  const dmHover = useHoverDelay(open => open ? openPanel('dm') : setDmPanel(false));
  useLayoutEffect(() => {
    cancelPanelHoverRef.current = () => {
      subHover.cancel();
      dmHover.cancel();
    };
  }, [subHover, dmHover]);
  const volumeHover = useHoverDelay(open => {
    if (open) {
      subHover.cancel();
      dmHover.cancel();
      setSubPanel(false);
      setDmPanel(false);
      setFitPanel(false);
      setSkipPanel(false);
    }
    volumeUi.setHovered(open);
  });
  const subPanelHost = usePlayerPanelPosition(subPanel, wrapRef);
  const dmPanelHost = usePlayerPanelPosition(dmPanel, wrapRef);
  // ★ 2026-09-30（用户要求）：外部播放器**不再由内置播放器跳转** —— 设置里勾选「启用点播外部播放器」
  //   且填了路径后，点播直接由外部播放器播放（见 renderer/lib/externalPlay.ts），故此处无「外部播放器」按钮/面板。
  //   ★ 2026-10-08：总开关 = 配置页勾选项（未勾选时即使有路径也走内置播放器）。
  //   地址解析（client.play）与历史记录都在 externalPlay 里完成，播放器窗口根本不会打开。

  /**
   * ★ 2026-09-30：图片 / 音频分流（所有 hooks 都在上方，早返回不破坏 hooks 顺序）。
   *   图集源把每张图当一「集」传进来 → 图片浏览器按「集」翻页；
   *   音乐源同理 → 音乐播放器按「曲」切歌。
   */
  if (isImage) {
    return (
      <ImageViewer
        url={url}
        name={resourceName}
        index={(props.epIndex ?? 0) + 1}
        total={props.epTotal}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        mini={mini}
      />
    );
  }
  if (isAudio) {
    return (
      <AudioPlayer
        url={url}
        playbackSource={props.playbackSource}
        name={resourceName}
        cover={props.cover}
        index={(props.epIndex ?? 0) + 1}
        total={props.epTotal}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={onPrev}
        onNext={onNext}
        startTime={props.startTime}
        mini={mini}
      />
    );
  }

  /**
   * ★ 2026-10-08（用户要求「把置顶按钮从播放器下方取消，做到上方最小化按钮旁边，播放器下方的功能区太拥挤了」）：
   *   置顶按钮已挪到**播放器窗口标题栏**（`TitleBar` 的 showPin；小窗口模式在 mini 条上），
   *   本组件不再渲染置顶入口（见 PlayerPage 的 pinTop 状态与 TitleBar 接线）。
   */

  return (
    <div
      ref={wrapRef}
      className={`vplayer${ui ? ' vui' : ''}${full ? ' vfull' : ''}${mini ? ' vp-mini' : ''}`}
      style={{ '--sub-font': `${subFont}px`, '--sub-bottom': `${subBottom}px` } as React.CSSProperties}
      onMouseMove={poke}
            onMouseLeave={hideIfNoPanel}
      onDoubleClick={mini ? undefined : event => { if (!(event.target as HTMLElement).closest('.vp-eppanel')) toggleFull(); }}
      onContextMenu={contextMenu.onContextMenu}
    >
      {/* ★ 2026-09-26：画面比例（用户要求）—— video 包进 stage/ratio 两层：
          · `.vp-stage` 绝对定位、撑满 `.vplayer` 且 `overflow:hidden` → **画面永不越出播放器区域**；
          · `.vp-ratio` 承载「强制 16:9 / 4:3」的定比盒子（其余模式为 100%×100%）；
          · 具体缩放交由 `object-fit`（contain/fill/cover/none），不改变元素盒尺寸。
          这同时修掉「某些比例的视频把底部控制条挤出可视区」的老问题（flex min-height 链见 global.css）。 */}
      <div
        className={`vp-stage fit-${fit}`}
      >
        <div className="vp-ratio">
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Downloaded subtitles are attached with video.addTextTrack. */}
          <video ref={ref} style={{ width: '100%', height: '100%' }} playsInline />
        </div>
        <button
          type="button"
          className="vp-stage-toggle"
          aria-label={paused ? '播放' : '暂停'}
          aria-pressed={!paused}
          onClick={onSurfaceClick}
          onMouseDown={boost.onMouseDown}
        />
      </div>
      {/* 弹幕叠加层（canvas，全屏区域，不拦截鼠标；fit 决定绘制区是否避让宽银幕黑边）
          ★ 2026-10-08 MPV 内核：时间/画面尺寸由主进程事件驱动（mpv 子窗口在 Chromium 之下，覆盖层仍在其上） */}
      <DanmakuOverlay
        videoRef={ref}
        mpv={kernel === 'mpv' ? { time: mpvTimeRef, size: mpvSizeRef } : null}
        items={dmItems}
        enabled={dmEnabled}
        fit={fit}
        region={dmCfg.region}
        fontSize={dmCfg.fontSize}
        opacity={dmCfg.opacity}
        density={dmCfg.density}
        speed={dmCfg.speed}
        offset={dmCfg.offset}
      />
      {/* ★ 2026-10-08（用户要求）：跳过片头片尾的短暂提示（2.5s 淡出；不拦截鼠标） */}
      <PlayerContextMenu position={contextMenu.position} menuRef={contextMenu.menuRef} onInfo={() => { contextMenu.setInfoOpen(value => !value); contextMenu.setPosition(null); }} onCopy={() => { void contextMenu.copy(); contextMenu.setPosition(null); }} />
      {!mini && !!props.episodes?.length && <PlayerEpisodePanel episodes={props.episodes} current={props.epIndex ?? -1} open={epPanel} title={playTitle || resourceName || '选集'} onClose={() => setEpPanel(false)} onSelect={index => props.onPickEpisode?.(index)} />}
      <PlayerTechnicalPanels audioTracks={audio.tracks} subtitles={technical.subtitles} pluginKeys={pluginKeys} active={kernel === 'mpv'} statsOpen={statsOpen} keysOpen={keysOpen} mini={mini} mpvTech={technical.tech} fmtNet={fmtNet} onStatsClose={() => setStatsOpen(false)} onKeysClose={() => setKeysOpen(false)} />
      <PlayerInfoOverlay open={contextMenu.infoOpen && !mini} title={playTitle} currentTime={cur} duration={dur} resolution={resText} formatTime={fmt} />
      {(skipToast || boost.tip > 0) && <div className="vp-toast">{skipToast || boost.tip + 'x'}</div>}
      {/* 加载 / 缓冲 */}
      {(loading || buffering) && !err && !mpvErr && (
        <div className="vp-loading">
          <span className="vp-spin" />
          <span className="vp-load-text">
            缓存中
            {(() => {
              const kbs = relaySpeed && relaySpeed > 0 ? relaySpeed : netSpeed && netSpeed > 0 ? netSpeed : 0;
              return kbs > 0 ? <span className="vp-load-speed"> {fmtNet(kbs)}</span> : null;
            })()}
          </span>
        </div>
      )}
      {/* 中央大按钮（小窗口只保留控制条的 上/下集 + 播放暂停） */}
      {!loading && !err && !mpvErr && !mini && !epPanel && (
        <button className="vp-big" onClick={onSurfaceClick} onMouseDown={boost.onMouseDown} title={paused ? '播放' : '暂停'} aria-label={paused ? '播放' : '暂停'}>
          {paused ? (
            <svg width="44" height="44" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor" /></svg>
          )}
        </button>
      )}
      {/* ★ 网盘资源未绑定 cookie → 提示到源内「网盘绑定」写入（优先于加载/错误，确保用户可操作） */}
      {needBind && (
        <div className="vp-drive-bind" onDoubleClick={(e) => e.stopPropagation()}>
          <div>
            此片源来自<b>「{driveProviderLabel(needBind)}」网盘</b>的专用链接，
            需要先绑定对应网盘凭据（Cookie）才能取流播放：
            到<b>点播页 → 正在用的那个源</b>（如立播/玩偶/我的云盘等）点源主页的<b>「网盘绑定」</b>按钮写入
            （夸克/UC 请粘贴含 <code>__pus</code> 与 <code>__puus</code> 的完整 Cookie，或用其中的「扫码登录」自动抓取）。
          </div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            {/* ★ 2026-09-29：原按钮保留（跳点播页 → 源主页「网盘绑定」入口），弹窗只是**新增**的第二条路径 */}
            <button className="primary" onClick={() => void client.gotoDriveBind()}>去点播页绑定</button>
            <button onClick={() => setBindOpen(true)}>打开绑定窗口</button>
            <button onClick={() => { bindDismissedRef.current = true; setNeedBind(null); setBindOpen(false); }}>知道了</button>
          </div>
        </div>
      )}
      {/* ★ 2026-09-29：未绑定时自动弹出的网盘绑定窗口（预选该网盘；绑定成功 → 外层重新解析播放） */}
      {bindOpen && needBind && (
        <DriveBindModal
          siteName={resourceName || '当前播放源'}
          initialProvider={needBind}
          onClose={() => { bindDismissedRef.current = true; setBindOpen(false); }}
          onSaved={() => {
            setBindOpen(false);
            setNeedBind(null);
            bindDismissedRef.current = false; // 绑定成功 → 允许后续再次检测/提示
            props.onDriveBound?.();
          }}
        />
      )}
      {/* 错误 */}
      {err && (
        <div className="vp-err" onDoubleClick={(e) => e.stopPropagation()}>
          <div>{err}</div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            {/* ★ 2026-10-08（用户拍板「内置官方构建」）：HTML5 播不动（4K/HEVC 等）→ 一键改走 MPV 内核 */}
            {allowMpv && mpvInfo?.available && kernel === 'html5' && (
              <button className="primary" onClick={() => switchKernel('mpv')}>
                用 MPV 内核重试
              </button>
            )}
            <button className={allowMpv && mpvInfo?.available && kernel === 'html5' ? '' : 'primary'} onClick={() => window.location.reload()}>
              刷新重试
            </button>
          </div>
        </div>
      )}
      {/* ★ 2026-10-08 MPV 内核自身的错误（启动失败/进程退出）→ 切回内置内核 */}
      {mpvErr && kernel === 'mpv' && (
        <div className="vp-err" onDoubleClick={(e) => e.stopPropagation()}>
          <div>{mpvErr}</div>
          <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
            <button className="primary" onClick={() => switchKernel('html5')}>
              切回内置内核
            </button>
          </div>
        </div>
      )}
      {endAll && <div className="vp-next"><span>已播完全部剧集</span></div>}
      {kernel === 'mpv' && technical.badges.length > 0 && <div className="vp-fmtbadges">{technical.badges.map(badge => <span key={badge} className="vp-fmtbadge">{badge}</span>)}</div>}
      {engines.notice && <output className="vp-kernel-notice">{engines.notice}</output>}
      {/* 控制条（小窗口：只保留 上/下集 + 播放暂停） */}
      <div className={`vp-controls${mini ? ' vp-mini' : ''}`} onDoubleClick={(e) => e.stopPropagation()}>
        {mini ? (
          <div className="vp-bar">
            <PlayerTransportControls mini paused={paused} canPrev={canPrev} canNext={canNext} onPrev={handlePrev} onNext={handleNext} onToggle={togglePlay} />
          </div>
        ) : (
        <>
        <PlayerTechnicalBar active={kernel === 'mpv'} error={mpvErr} mpvTech={technical.tech} fmtNet={fmtNet} />
        {!isLive && (
          <PlayerProgressBar
            currentTime={cur}
            duration={dur}
            buffered={buffered}
            canSeek={() => !!ref.current || kIsChild()}
            getCurrentTime={kTime}
            seekTo={kSeek}
            formatTime={fmt}
            onContextMenu={(e, t) => {
              if (!skipUsable || !dur || t == null) return false;
              setSkipMenu({
                x: Math.max(8, Math.min(e.clientX, window.innerWidth - 248)),
                y: Math.max(8, Math.min(e.clientY, window.innerHeight - 196)),
                t,
              });
              return true;
            }}
          />
        )}
        {/* ★ 2026-10-08（用户要求）：进度条右键菜单 —— 用当前位置标记片头结束点 / 片尾起点 */}
        {skipMenu && (
          <div
            ref={skipMenuRef}
            className="vp-skipmenu"
            style={{ left: skipMenu.x, top: skipMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <div className="vp-skipmenu-title">跳过设置 · 指针位置 {fmt(skipMenu.t)}</div>
            <button
              className="vp-skipmenu-item"
              disabled={skipMenu.t < 1}
              onClick={() => {
                commitSkip(skipMenu.t, skipSegRef.current.outro);
                showSkipToast(`片头结束点设为 ${fmt(skipMenu.t)}`);
                setSkipMenu(null);
              }}
            >
              跳过片头至此（{fmt(skipMenu.t)}）
            </button>
            <button
              className="vp-skipmenu-item"
              disabled={!(dur > 0) || dur - skipMenu.t < 1}
              onClick={() => {
                const o = Math.max(0, Math.round(dur - skipMenu.t));
                commitSkip(skipSegRef.current.intro, o);
                showSkipToast(`片尾起点设为剩 ${fmt(o)}`);
                setSkipMenu(null);
              }}
            >
              从此跳过片尾（剩 {dur > 0 ? fmt(Math.max(0, dur - skipMenu.t)) : '--:--'}）
            </button>
            {(skipSeg.intro > 0 || skipSeg.outro > 0) && (
              <button
                className="vp-skipmenu-item"
                onClick={() => {
                  commitSkip(0, 0);
                  showSkipToast('已清除本集跳过点');
                  setSkipMenu(null);
                }}
              >
                清除本集跳过点
              </button>
            )}
            <button className="vp-skipmenu-item vp-skipmenu-cancel" onClick={() => setSkipMenu(null)}>取消</button>
          </div>
        )}
        <div className="vp-bar">
          <PlayerTransportControls mini={false} paused={paused} canPrev={canPrev} canNext={canNext} onPrev={handlePrev} onNext={handleNext} onToggle={togglePlay} />
          <span className="vp-time">{isLive ? <span className="vp-live">● 直播</span> : `${fmt(cur)} / ${fmt(dur)}`}</span>
          <PlayerVolumeControl
            volume={vol}
            open={volOpen}
            hidden={subPanel || dmPanel}
            inputRef={volumeUi.inputRef}
            onFocusChange={volumeUi.setFocused}
            onPointerEnter={() => volumeHover.enter()}
            onPointerLeave={() => volumeHover.leave()}
            onChange={kSetVol}
            onPointerStart={volumeUi.beginDrag}
            onPointerEnd={volumeUi.endDrag}
            onToggleMute={() => {
              kSetVol(volRef.current > 0 ? 0 : vol || 1);
              flashVol();
            }}
          />
          <DlnaCastControl url={url} resourceName={resourceName} getCurrentTime={kTime} />
          <SubtitlePanel
            embeddedTracks={technical.subtitles}
            sid={technical.sid}
            onSelectTrack={kernel !== 'html5' ? id => { void kCmd({ type: 'sid', value: id }).catch(() => undefined); } : undefined}
            enabled={subEnabled}
            open={subPanel}
            activeSubtitle={subActive}
            fontSize={subFont}
            bottom={subBottom}
            offset={subOffset}
            query={subQuery}
            searching={subSearching}
            tokenHint={subTokenHint}
            message={subMsg}
            candidates={subCands}
            resourceName={resourceName}
            panelRef={subPanelHost}
            onAnchorPointerEnter={() => subHover.enter()}
            onAnchorPointerLeave={() => subHover.leave()}
            onClose={() => { subHover.cancel(); setSubPanel(false); }}
            onPanelPointerEnter={() => subHover.enter(true)}
            onPanelPointerLeave={() => subHover.leave()}
            onToggle={toggleSub}
            setFontSize={setSubFont}
            setBottom={setSubBottom}
            setOffset={setSubOffset}
            onQueryChange={setSubQuery}
            onSearch={() => { void doSearch(); }}
            onSelectCandidate={selectSub}
          />
          <DanmakuPanel
            enabled={dmEnabled}
            open={dmPanel}
            activeEpisodeId={dmActiveEp}
            message={dmMsg}
            settings={dmCfg}
            candidates={dmCands}
            searching={dmSearching}
            query={dmQuery}
            episode={dmEp}
            sourcesOpen={dmSrcPanel}
            customText={dmCustomText}
            panelRef={dmPanelHost}
            onAnchorPointerEnter={() => dmHover.enter()}
            onAnchorPointerLeave={() => dmHover.leave()}
            onClose={() => { dmHover.cancel(); setDmPanel(false); }}
            onPanelPointerEnter={() => dmHover.enter(true)}
            onPanelPointerLeave={() => dmHover.leave()}
            onToggle={toggleDanmaku}
            onSettingsChange={setDmCfg}
            onQueryChange={setDmQuery}
            onEpisodeChange={setDmEp}
            setSourcesOpen={setDmSrcPanel}
            setCustomText={setDmCustomText}
            onSearch={() => { void matchDanmaku(dmQuery, dmEp, { fresh: true }); }}
            onCandidateSelect={applyDanmaku}
          />
          {/* 跳过片头片尾的展示与输入由独立控制组件负责，播放会话仍管理记录与自动跳转。 */}
          {skipUsable && (
            <SkipSegmentsControl
              segments={skipSeg}
              inheritedFrom={skipInheritFrom}
              draft={skipDraft}
              open={skipPanel}
              onDraftChange={setSkipDraft}
              onToggle={toggleSkipPanel}
              onSave={saveSkipDraft}
              onClear={() => { commitSkip(0, 0); showSkipToast('已清除本集跳过点'); }}
            />
          )}
          <PlayerRateControl
            rate={rate}
            onRateChange={kSetRate}
          />
          {allowMpv && <PlayerKernelControl kernel={kernel} preference={kernelPref} choices={engines.choices} containerRef={wrapRef} onSelect={preference => switchKernel(resolveKernel(preference, url, { mpvAvailable: !!mpvInfo?.available, engines: engines.usable }), true, preference)} onOpen={() => { setSubPanel(false); setDmPanel(false); setFitPanel(false); audio.setOpen(false); superResolution.setOpen(false); poke(); }} />}
          {kernel === 'mpv' && <><button type="button" className={'vp-ctl' + (statsOpen ? ' vp-on' : '')} title="播放统计" aria-pressed={statsOpen} onClick={() => { setStatsOpen(value => !value); setKeysOpen(false); poke(); }}><span className="vp-kernel-tag">统计</span></button><button type="button" className={'vp-ctl' + (keysOpen ? ' vp-on' : '')} title="快捷键一览" aria-pressed={keysOpen} onClick={() => { setKeysOpen(value => !value); setStatsOpen(false); poke(); }}><span className="vp-kernel-tag">键位</span></button></>}
          <PlayerSuperResolutionControl active={kernel === 'mpv'} info={superResolution.info} mode={superResolution.mode} open={superResolution.open} containerRef={wrapRef} onOpen={() => openPanel('sr')} onClose={() => superResolution.setOpen(false)} onSelect={value => { superResolution.apply(value); poke(); }} />
          <div style={{ flex: 1 }} />
          <PlayerAudioControl spdif={spdif} effectiveSpdif={technical.tech?.spdif} onSpdifChange={value => { const next = normalizeSpdif(value); setSpdif(next); savePlayerPrefs({ spdif: next }); if (kernel === 'mpv') void kCmd({ type: 'audio-spdif', value: next }).catch(() => undefined); }} open={audio.open} tracks={audio.tracks} aid={audio.aid} isMpv={kernel === 'mpv'} containerRef={wrapRef} onOpen={() => openPanel('audio')} onClose={() => audio.setOpen(false)} onSelect={audio.apply} />
          <PlayerFitControl
            fit={fit}
            open={fitPanel}
            onFitSelect={setFit}
            onFitOpen={() => openPanel('fit')}
            onFitPointerEnter={() => openPanel('fit')}
            onFitPointerLeave={() => setFitPanel(false)}
          />
          {(props.episodes?.length ?? 0) > 1 && <button className={'vp-ctl' + (epPanel ? ' vp-on' : '')} title="选集" aria-pressed={epPanel} onClick={toggleEpPanel}>☰</button>}
          <button className="vp-ctl" title="全屏" onClick={toggleFull}>
            {full ? (
              <svg width="15" height="15" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            )}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
