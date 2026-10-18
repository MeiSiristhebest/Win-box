// src/shared/player.ts
// 播放相关的本地偏好 —— 主进程（本地中继 `/play`）与渲染层配置页共用。
// 落在 <userData>/player-settings.json（见 src/main/player/playerSettings.ts）。

// ---------- ★ 超分插件（M1）：用户可见档位（见 docs/design/插件系统_设计方案.md §8） ----------
//
// 档位 id 与插件 manifest 的 `contributes[type='mpv.shaders'].modes[].id` 一一对应；
// `off` = 不注入着色器（不重启 mpv 会话，逐条 clr 即关）。
/** 超分档位（`off` + 插件声明的档位 id） */
export type SrMode = 'off' | 'efficiency' | 'quality' | 'general' | 'high';
export const SR_MODES: readonly SrMode[] = ['off', 'efficiency', 'quality', 'general', 'high'];
export const SR_MODE_LABEL: Record<SrMode, string> = {
  off: '关闭',
  efficiency: '效率',
  quality: '质量',
  general: '通用',
  high: '高质量',
};

export function isSrMode(v: unknown): v is SrMode {
  return typeof v === 'string' && (SR_MODES as readonly string[]).includes(v);
}

/**
 * 求**实际生效**档位（纯函数，主/渲染共用）：未就绪（未装插件 / 载荷缺 / 档位不在可用集）→ 一律 `off`。
 * 记的是"用户想要哪个档"，落盘的 `srMode` 不因插件卸载被改写；渲染时才按可用性收敛。
 */
export function srModeUsable(mode: unknown, usable: readonly string[]): SrMode {
  if (!isSrMode(mode) || mode === 'off') return 'off';
  return usable.includes(mode) ? mode : 'off';
}

export interface PlayerSettings {
  /**
   * ★ m3u8 去广告（对位 TVBox `HawkConfig.M3U8_PURIFY`，**默认关**）。
   *
   * 默认关是有意为之：清洗是启发式的（按切片路径/域名、订阅规则、SCTE/DATERANGE、
   * EXTINF 精度与帧率特征删广告段），宁可少删也不能删掉正片；实现里另有三道回退保护。
   * 开启后作用于点播（含 `#EXT-X-ENDLIST`）清单，且只在该轮**确实删到段**时替换播放列表。
   */
  m3u8Purify: boolean;
  /**
   * ★ 2026-09-29：磁力「外部播放器接力」的播放器路径（空 = 自动探测常见安装位置）。
   * 用途：种子内是 MKV/HEVC 等 Chromium 播不了的形态时，把本机中继地址交给它边下边播
   * （探测顺序 PotPlayer → VLC → mpv → MPC-HC，见 main/torrent/externalPlayer.ts）。
   */
  btExternalPlayer: string;
  /**
   * ★ 2026-09-30（用户要求「点播也应该支持绑定外部播放器，和磁力区分开」+「选定后直接由它播放」）：
   * **点播**外部播放器的路径（空 = 用内置播放器）——与磁力分开绑定。
   * 填了路径：点播**直接**由它播放（不开内置播放器窗口）；从历史播放会把上次进度作为启动参数带上。
   */
  vodExternalPlayer: string;
  /**
   * ★ 2026-10-08（用户要求「把点播外部播放器换成勾选项，不要根据路径选择是否启用；就算填了路径，
   * 不勾选依旧不使用第三方播放器」）：**点播外部播放器总开关**。
   * 生效判据 = `vodExternalPlayerEnabled && vodExternalPlayer 非空`；不勾选 ⇒ 一律用内置播放器（即使已填路径）。
   * 旧配置（无此字段）按「路径非空 = 勾选」迁移（保持 09-30 起「填了路径就直接用它播」的既有行为，
   * 用户可随时取消勾选；此后该字段以显式值为准）。
   */
  vodExternalPlayerEnabled: boolean;
  /**
   * ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核的 **mpv.exe 路径覆盖**（空 = 用内置）。
   * 解析链（见 main/player/mpvCore.resolveMpvPath）：本字段（非空且存在）→ 随包内置
   * `resources/mpv/mpv.exe`（安装目录内）→ 本机常见安装位置（Program Files 等）。
   * 用途：4K / HEVC / HDR 等 Chromium 播不好的形态，改由嵌入播放器窗口的 mpv 渲染
   * （HTML 覆盖层仍在 mpv 画面之上；地址链路不变，mpv 直接吃既有 `/play` 中继）。
   */
  mpvPath: string;
  /**
   * ★ 超分插件（M1）：MPV 内核超分档位（`off`=关；其余为插件档位 id）。
   * **仅 MPV 内核生效**（HTML5 跑不了 GLSL）；实际是否生效由「插件已装且载荷就绪」决定（`srModeUsable`）。
   * 换档走运行期 IPC（逐条 clr+append），**不重启 mpv 会话**。
   */
  srMode: SrMode;
  /**
   * ★ 2026-10-18（R11）第三方播放内核（`player.engine`）的**启用开关**（键 = 引擎 id `engine:<contributeId>`）。
   * ★ 默认**关**（全表为空 = 全关）：开启意味着「将执行插件提供的本机程序」，故需配置页单独开关 + 首次开启二次确认。
   * `engine:start` 前由主进程校验本表（未启用 → 明确拒绝）。
   */
  engineEnabled: Record<string, boolean>;
  /**
   * ★ 2026-10-18（R11）第三方播放内核的**本机程序路径**（键 = 引擎 id `engine:<contributeId>`）。
   * 仅 `binary.source === 'local-path'` 的引擎使用（对位 `mpvPath` 口径：留空 = 未就绪，需用户在配置页填写）。
   */
  enginePaths: Record<string, string>;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  m3u8Purify: false,
  btExternalPlayer: '',
  vodExternalPlayer: '',
  vodExternalPlayerEnabled: false,
  mpvPath: '',
  srMode: 'off',
  engineEnabled: {},
  enginePaths: {},
};

/** 归一（容错旧值/缺字段；纯函数，配置页与主进程共用） */
export function normalizePlayerSettings(s: Partial<PlayerSettings> | null | undefined): PlayerSettings {
  const bt = s && typeof s.btExternalPlayer === 'string' ? s.btExternalPlayer.trim() : '';
  const vod = s && typeof s.vodExternalPlayer === 'string' ? s.vodExternalPlayer.trim() : '';
  // 旧配置没有该字段 → 按「路径非空」推导（迁移口径）；显式布尔值一律以它为准
  const vodOn = s && typeof s.vodExternalPlayerEnabled === 'boolean' ? s.vodExternalPlayerEnabled : vod !== '';
  const mpv = s && typeof s.mpvPath === 'string' ? s.mpvPath.trim() : '';
  // ★ 超分档位：非白名单值（旧配置 / 手改坏）一律回落 off
  const sr = isSrMode(s?.srMode) ? (s!.srMode as SrMode) : 'off';
  return {
    m3u8Purify: !!(s && s.m3u8Purify),
    btExternalPlayer: bt,
    vodExternalPlayer: vod,
    vodExternalPlayerEnabled: vodOn,
    mpvPath: mpv,
    srMode: sr,
    engineEnabled: normalizeBoolMap(s?.engineEnabled),
    enginePaths: normalizeStrMap(s?.enginePaths),
  };
}

/** ★ R11：`Record<string, boolean>` 归一（非对象/非布尔值丢弃；键去空白） */
export function normalizeBoolMap(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = String(k || '').trim();
    if (key && typeof val === 'boolean') out[key] = val;
  }
  return out;
}

/** ★ R11：`Record<string, string>` 归一（非对象/非字符串值丢弃；键值去空白） */
export function normalizeStrMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = String(k || '').trim();
    if (key && typeof val === 'string') out[key] = val.trim();
  }
  return out;
}

// ---------- ★ 2026-10-08 MPV 播放内核（主进程 MpvController ↔ 渲染层 VideoPlayer） ----------
//
// 口径（PoC 实测，见 .workbuddy/memory/2026-10-08.md §二）：
//   · mpv 以 `--wid=<播放器窗口 HWND>` 嵌入（子窗口在 Chromium 渲染面**之下**，
//     故播放器窗口必须 transparent + 播放区页面透明，HTML 覆盖层仍绘制在 mpv 画面之上）；
//   · 控制/状态走 `--input-ipc-server` 的 JSON IPC（loadfile / set_property / observe_property）；
//   · 地址链路不变：mpv 直接吃既有 `/play` 中继（防盗链头 / 网盘 cookie / m3u8 清洗全保留）。

/** mpv 可执行文件的解析结果（配置覆盖 → 随包内置 → 本机探测） */
export interface MpvStatus {
  available: boolean;
  path: string;
  source: 'override' | 'bundled' | 'system' | 'none';
  /** 人话说明（配置页/播放器提示用） */
  note: string;
}

/** 启动一次 mpv 会话（每次换集/换源 = 新会话；主进程先停旧进程） */
export interface MpvStartOptions {
  url: string;
  live?: boolean;
  /** Keep a paused video paused when switching kernels. */
  paused?: boolean;
  /** 起播位置（秒，0/缺省 = 从头） */
  startTime?: number;
  /** 初始音量 0..1（缺省 1） */
  volume?: number;
  /** 初始倍速（缺省 1） */
  rate?: number;
  /** 初始画面比例（PlayerFit；缺省 contain） */
  fit?: string;
  /**
   * ★ 超分插件（M1）：本会话初始 mpv 着色器链（**绝对路径**，顺序即生效顺序）。
   *   经 IPC 逐条 `change-list glsl-shaders clr/append` 注入（不用拼接串，规避分隔符问题）；空/缺省 = 不注入。
   */
  shaders?: string[];
}

/** 渲染层 → 主进程：内核控制命令（主进程翻译成 mpv 命令） */
export type MpvCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; value: number }
  | { type: 'volume'; value: number } // 0..1
  | { type: 'rate'; value: number } // 0.25..4
  | { type: 'fit'; value: string } // PlayerFit
  | { type: 'sub-add'; text: string; fileName?: string } // SRT 文本（主进程落临时文件后 sub-add）
  | { type: 'sub-clear' }
  | { type: 'sub-font'; value: number } // CSS px（主进程换算 mpv 字号）
  | { type: 'sub-pos'; value: number } // 0..100（距顶部百分比）
  // ★ 2026-10-17（用户要求）：音轨切换（mpv 的 aid；内置内核走 hls.js 的 audioTrack，不走这里）
  | { type: 'aid'; value: number }
  // ★ 2026-10-17（阶段2）：字幕轨切换（mpv 的 sid；-1 = 关闭字幕）
  | { type: 'sid'; value: number }
  // ★ 2026-10-17（阶段2）：音频源码直通（mpv `audio-spdif`；'' = 关闭直通）
  | { type: 'audio-spdif'; value: string }
  // ★ 超分插件（M1）：整链替换 mpv 着色器（空数组 = 关闭超分），即时生效、不重启会话
  | { type: 'glsl-shaders'; value: string[] }
  // ★ 超分插件（M1）：换超分档位 —— 渲染层只报档位，**绝对路径由主进程解析**（渲染层不碰文件系统）
  | { type: 'sr-mode'; value: SrMode };

/** ★ 2026-10-17（用户要求「音轨设置」）：音轨条目（mpv `track-list` 里的 audio 项归一后） */
export interface MpvAudioTrack {
  /** mpv 音轨 id（切换时用；也用于高亮当前项） */
  id: number;
  /** 轨道标题（如「国语」） */
  title?: string;
  /** 语言代码（如 chi/zho/jpn） */
  lang?: string;
  /** 编码（如 aac/ac3/eac3/dts） */
  codec?: string;
  /** 声道数/布局（如 2/6） */
  channels?: string;
  /** 是否 mpv 当前选中 */
  selected?: boolean;
}

/** ★ 2026-10-17（阶段2）：字幕轨条目（mpv `track-list` 里 type=sub 的项归一后） */
export interface MpvSubtitleTrack {
  /** mpv 字幕轨 id（切换时用；也用于高亮当前项） */
  id: number;
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  /** 外挂字幕（sub-add 进来的） */
  external?: boolean;
}

/**
 * ★ 2026-10-17（阶段2）：视频参数（HDR 标准判定 / 底栏规格标签用）。
 * 字段名与含义**取自该内核 `video-params` 的实测输出**（不要照搬其它 mpv 版本的键名）：
 * `pixelformat/primaries/gamma/light/sig-peak` 为 mpv 标准键；
 * `hdr-vivid` 是 Yaozhi 自编译核心的**自定义扩展键**（只有它才有）。
 */
export interface MpvVideoParams {
  w: number;
  h: number;
  pixelformat?: string;
  primaries?: string;
  gamma?: string;
  light?: string;
  sigPeak?: number;
  /** ★ 自定义键：HDR Vivid 元数据识别（其它 mpv 构建不提供 → undefined） */
  hdrVivid?: boolean;
}

/** ★ 2026-10-17（阶段2）：音频参数（mpv `audio-params` 归一）。注意 `format` 是**采样格式**（floatp/s16），不是编码名 */
export interface MpvAudioParams {
  samplerate?: number;
  /** 声道布局名（mono/stereo/5.1…） */
  channels?: string;
  channelCount?: number;
}

/** 画面标准（格式标签用；纯函数推导，见 `mpvDisplayStandard`） */
export type MpvDisplayStandard = 'SDR' | 'HLG' | 'HDR Vivid' | 'HDR10';

/**
 * ★ 2026-10-17（阶段2）：由 mpv `video-params` 推导「画面标准」。
 * 口径（仅用实测存在的键，不发明）：
 *   ① `hdr-vivid === true`（Yaozhi 核心自定义键）→ HDR Vivid；
 *   ② `gamma` 含 `hlg` → HLG；含 `pq` / `smpte2084` → HDR10（BT.2020 与否不改变标签）；
 *   ③ 其余 → SDR。**DV 不做标签**：该核心未暴露可区分的 DV 专用键，不猜。
 */
export function mpvDisplayStandard(v: MpvVideoParams | null | undefined): MpvDisplayStandard {
  if (!v) return 'SDR';
  if (v.hdrVivid === true) return 'HDR Vivid';
  const gamma = String(v.gamma || '').toLowerCase();
  if (gamma.includes('hlg')) return 'HLG';
  if (gamma.includes('pq') || gamma.includes('2084')) return 'HDR10';
  return 'SDR';
}

/**
 * ★ 2026-10-17（阶段3）：起播格式标签（参照 Yaozhi 的 startup-format-logos，但我们只做**已知值**的标签）。
 * 口径：画面标准（SDR/HLG/HDR10/HDR Vivid）必给；BT.2020 仅在 `primaries` 明说时补；
 * 音频编码（大写）与声道布局有值才补。**不做** DV/Atmos/DTS:X 这类需要专用元数据的标签（不猜）。
 */
export function mpvFormatBadges(v: MpvVideoParams | null, aCodec: string, channels?: string): string[] {
  const out: string[] = [mpvDisplayStandard(v)];
  const p = String(v?.primaries || '').toLowerCase();
  if (p.includes('2020')) out.push('BT.2020');
  const a = String(aCodec || '').trim();
  if (a) out.push(a.toUpperCase());
  const ch = String(channels || '').trim();
  if (ch) out.push(ch);
  return out;
}

// ---------- ★ 2026-10-17（阶段3b，用户要求「音频直通开关」）：mpv `audio-spdif` 档位 ----------
//
// 语义：把音频**不解码**、按源码直通给功放（HDMI/SPDIF 比特流）。值 = 直接下发给 mpv 的
//   编解码名**列表串**（mpv 认的键名：ac3 / eac3 / dts / dts-hd / truehd）；'' = 关闭直通（本机解码）。
//   ★ 只在 MPV 内核生效（HTML5 内核无此能力），且默认关闭（多数场景本机解码更稳）。
/** 音频直通档位（`value` = 下发给 mpv 的列表串；'' = 关闭） */
export interface SpdifOption {
  value: string;
  label: string;
  /** 一句话说明（面板 title / 技术详情里用） */
  hint: string;
}
export const SPDIF_OPTIONS: readonly SpdifOption[] = [
  { value: '', label: '关闭', hint: '由本机解码（默认；兼容性最好）' },
  { value: 'ac3,eac3,dts,dts-hd,truehd', label: '全部', hint: 'Dolby / DTS 全部源码直通给功放' },
  { value: 'ac3,eac3,truehd', label: '仅 Dolby', hint: 'AC3 / EAC3 / TrueHD 直通' },
  { value: 'dts,dts-hd', label: '仅 DTS', hint: 'DTS / DTS-HD 直通' },
];
/** 直通档位归一（纯函数）：非法/未知值一律回落 ''（关闭）——避免记忆损坏把声音弄哑 */
export function normalizeSpdif(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return SPDIF_OPTIONS.some((o) => o.value === s) ? s : '';
}
/** 直通档位人话标签（技术详情面板显示「实际生效」值用） */
export function spdifLabel(v: unknown): string {
  const s = normalizeSpdif(v);
  return SPDIF_OPTIONS.find((o) => o.value === s)?.label ?? '关闭';
}

/** mpv 内核状态（主进程节流推送，渲染层据此驱动进度条/弹幕/跳过片头片尾） */
export interface MpvKernelState {
  /** 播放位置（秒）；未知 null */
  time: number | null;
  /** 总时长（秒）；直播/未知 null */
  duration: number | null;
  paused: boolean;
  /** 缓冲中（paused-for-cache） */
  buffering: boolean;
  /** 已到结尾（触发一次自动下一集） */
  eof: boolean;
  /** 文件已加载（file-loaded） */
  loaded: boolean;
  /** 启动直播提示；拿到有限正时长后纠正为点播，未知时长不自动判直播 */
  live: boolean;
  playbackStarted: boolean;
  error: string | null;
  /** 画面尺寸（物理像素；弹幕绘制区用） */
  videoW: number;
  videoH: number;
  /** 缓存速度 KB/s（cache-speed，可缺） */
  cacheKbps: number;
  /** 已缓存到的时间点（demuxer-cache-time，进度条缓冲段用） */
  cacheTime: number | null;
  /** mpv 进程已退出 */
  exited: boolean;
  /** ★ 2026-10-17（用户要求「音轨设置」）：可用音轨（track-list 里 type=audio 的项） */
  audioTracks: MpvAudioTrack[];
  /** ★ 2026-10-17：当前音轨 id（aid）；无音轨/未知 null */
  aid: number | null;
  // ---------- ★ 2026-10-17（阶段2）：MPV 内核「能力面」（只重做 MPV 内核下界面所需） ----------
  // 数据源与键名均按该内核实测（video-params / audio-params / track-list / hwdec-current / *-bitrate）。
  /** 字幕轨（track-list 里 type=sub 的项；中文轨道菜单用） */
  subtitles: MpvSubtitleTrack[];
  /** 当前字幕轨 id（sid）；无字幕/未选 null */
  sid: number | null;
  /** 视频参数（画面尺寸/HDR 标准判定）；无视频 null */
  video: MpvVideoParams | null;
  /** 音频参数（采样率/声道）；无音频 null */
  audio: MpvAudioParams | null;
  /** 视频编码名（video-format，如 h264/hevc/vvc/av1） */
  vCodec: string;
  /** 音频编码名（audio-codec-name，如 aac/ac3/eac3/dts） */
  aCodec: string;
  /** 硬件解码方式（hwdec-current；'' 未知 / 'no' 软解 / 其它 = 硬解后端名） */
  hwdec: string;
  /** 视频码率 kbps（`video-bitrate` 原始单位是 bps → ÷1000；不可用 = 0） */
  vBitrateKbps: number;
  /** 音频码率 kbps（`audio-bitrate` 原始单位是 bps → ÷1000；不可用 = 0） */
  aBitrateKbps: number;
  /** 容器帧率（container-fps；未知 0） */
  fps: number;
  /** 丢帧数（frame-drop-count） */
  dropped: number;
  /** 已缓存时长（demuxer-cache-duration，秒；未知 null） */
  cacheDuration: number | null;
  /** 音频源码直通（audio-spdif；'' = 关闭） */
  spdif: string;
}

/** 主进程 → 渲染层：内核状态推送（带会话号，晚到的旧会话事件被丢弃） */
export interface MpvStateEvent {
  session: number;
  state: MpvKernelState;
}

// ---------- ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）播放诊断上报 ----------
//
// 为什么需要：`vod:play` 返回 URL 后，画面/声音全在渲染层与 GPU 进程里跑，**主进程侧不再有任何日志**，
//   出事时（最典型 = GPU 进程崩溃：合成器死 → 整窗不再刷新、连进度条都不动，而音频走另一通道继续）
//   日志里只剩一行 `child-process-gone type=GPU`，看不到「当时在放哪一集、停在哪一帧」。
// 渲染层负责上报「事件 + 当时的 <video> 快照 + 帧停更检测（frame-stall）」；
// 主进程侧落到 app-*.log，并在 GPU 崩溃那条日志里带出（见 main/util/mediaDiag.ts 与 index.ts）。
/** 渲染层 → 主进程：播放中的媒体事件（fire-and-forget） */
export interface MediaStateEvent {
  /** 事件名：play/pause/waiting/playing/stalled/emptied/error/frame-stall，或 visibility:<状态> / hls-fatal:<类型>:<明细> */
  event: string;
  /** 内核（HTML5 内置 / mpv） */
  kernel: 'html5' | 'mpv';
  /** 播放地址（主进程落盘前会去掉查询串：地址可能带凭据与防盗链参数） */
  url?: string;
  /** 资源名（不含集号），用于区分「同一地址换了集」这类情况 */
  title?: string;
  // ---- 事件发生时的 <video> 快照 ----
  readyState?: number;
  currentTime?: number;
  paused?: boolean;
}

/** 字幕字号换算：CSS px → mpv `sub-font-size`（mpv 默认 55 ≈ 720p 常规字号；近似 2:1，两侧共用） */
export function mpvFontSize(px: number): number {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return 55;
  return Math.max(12, Math.min(200, Math.round(n * 2)));
}

/** 字幕位置换算：距底部 px → mpv `sub-pos`（0..100，距**顶部**百分比） */
export function mpvSubPos(bottomPx: number, winHeight: number): number {
  const h = Number(winHeight);
  const b = Number(bottomPx);
  if (!Number.isFinite(h) || h <= 0) return 90;
  const pct = 100 - (Math.max(0, Number.isFinite(b) ? b : 0) / h) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
