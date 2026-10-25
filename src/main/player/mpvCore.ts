// src/main/player/mpvCore.ts
// ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核的**纯逻辑**（不 import electron，可单测）。
//   负责：启动参数 / JSON IPC 行协议 / 内核状态归一 / mpv 路径解析 / 画面比例与字幕参数换算。
//
// PoC 实测口径（见 .workbuddy/memory/2026-10-08.md §二）：
//   · `--wid=<HWND>` 把 mpv 画面嵌进 Electron 播放器窗口（子窗口在 Chromium 渲染面之下 →
//     窗口必须 transparent + 播放区页面透明；HTML 覆盖层仍绘制在 mpv 画面之上，点击归 HTML）；
//   · `--input-ipc-server=\\.\pipe\<name>` + Node `net.connect` 可用（loadfile / set_property /
//     observe_property 全通）；属性事件以 JSON 行推送。
import type { MpvAudioParams, MpvAudioTrack, MpvCommand, MpvKernelState, MpvSubtitleTrack, MpvVideoParams } from '../../shared/player';
import { mpvFontSize } from '../../shared/player';
import { playerCandidates } from '../torrent/externalPlayer';

/** 初始状态（每次会话重置） */
export function initialKernelState(live = false): MpvKernelState {
  return {
    time: null,
    duration: null,
    paused: false,
    buffering: false,
    eof: false,
    loaded: false,
    live,
    playbackStarted: false,
    error: null,
    videoW: 0,
    videoH: 0,
    cacheKbps: 0,
    cacheTime: null,
    exited: false,
    audioTracks: [],
    aid: null,
    // ★ 2026-10-17（阶段2）：能力面
    subtitles: [],
    sid: null,
    video: null,
    audio: null,
    vCodec: '',
    aCodec: '',
    hwdec: '',
    vBitrateKbps: 0,
    aBitrateKbps: 0,
    fps: 0,
    dropped: 0,
    cacheDuration: null,
    spdif: '',
  };
}

/** 需要 observe 的属性（id 必须稳定：mpv property-change 事件按 id 回传） */
export const MPV_OBSERVED: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: 'time-pos' },
  { id: 2, name: 'duration' },
  { id: 3, name: 'pause' },
  { id: 4, name: 'paused-for-cache' },
  { id: 5, name: 'eof-reached' },
  { id: 6, name: 'width' },
  { id: 7, name: 'height' },
  { id: 8, name: 'cache-speed' },
  { id: 9, name: 'demuxer-cache-time' },
  // ★ 2026-10-17（用户要求「音轨设置」）：观察音轨表与当前音轨，渲染层据此列出/高亮（无需新 IPC）
  { id: 10, name: 'track-list' },
  { id: 11, name: 'aid' },
  // ---------- ★ 2026-10-17（阶段2）：MPV 内核「能力面」（只重做 MPV 内核下界面所需） ----------
  // 键名与单位均按该内核**实测**输出（见 .tmp/yaozhi-poc/mpv-props.cjs 的 dump）：
  //   · `video-params` 里 `hdr-vivid` 是 Yaozhi 自编译核心的自定义键；
  //   · `audio-bitrate` / `video-bitrate` 单位是 **bps**（不是 kbps）；
  //   · `track-list` 的 `language`/`title` 在 **`metadata`** 里（顶层没有）。
  { id: 12, name: 'video-params' },
  { id: 13, name: 'audio-params' },
  { id: 14, name: 'video-format' },
  { id: 15, name: 'audio-codec-name' },
  { id: 16, name: 'hwdec-current' },
  { id: 17, name: 'audio-bitrate' },
  { id: 18, name: 'video-bitrate' },
  { id: 19, name: 'container-fps' },
  { id: 20, name: 'frame-drop-count' },
  { id: 21, name: 'demuxer-cache-duration' },
  { id: 22, name: 'audio-spdif' },
  { id: 23, name: 'sid' },
];

/** 归一：任意值 → 非空字符串（数字转字符串；空/其它 → undefined） */
function mpvStr(v: unknown): string | undefined {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  return s ? s : undefined;
}

/** 有限数字 → number，否则 undefined */
function mpvNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 轨道 `metadata`（★实测：本内核的 `language`/`title` 在这里，顶层没有） */
function mpvTrackMeta(t: Record<string, unknown>): Record<string, unknown> {
  const m = t.metadata;
  return m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
}

/**
 * ★ 2026-10-17：mpv `track-list` → 只要 audio 轨道（紧凑结构；缺字段就不写）。
 * ★ 2026-10-17（阶段2）修正：`lang`/`title` 在本内核里位于 **`metadata`**（顶层没有），
 *   此前只读顶层 ⇒ 音轨标签恒为空。现两处都读（兼容其它 mpv 版本）。
 * 声道兼容两种历史键名（`demux-channel-count` / `demux-channels`）。
 */
export function mpvAudioTracks(data: unknown): MpvAudioTrack[] {
  if (!Array.isArray(data)) return [];
  const out: MpvAudioTrack[] = [];
  for (const raw of data) {
    const t = raw as Record<string, unknown> | null;
    if (!t || typeof t !== 'object') continue;
    if (String(t.type || '') !== 'audio') continue;
    const id = Number(t.id);
    if (!Number.isFinite(id)) continue;
    const meta = mpvTrackMeta(t);
    out.push({
      id,
      title: mpvStr(t.title) ?? mpvStr(meta.title),
      lang: mpvStr(t.lang) ?? mpvStr(meta.language),
      codec: mpvStr(t.codec),
      channels: mpvStr(t['demux-channel-count']) ?? mpvStr(t['demux-channels']),
      selected: t.selected === true ? true : undefined,
    });
  }
  return out;
}

/** ★ 2026-10-17（阶段2）：mpv `track-list` → 字幕轨（type=sub） */
export function mpvSubtitleTracks(data: unknown): MpvSubtitleTrack[] {
  if (!Array.isArray(data)) return [];
  const out: MpvSubtitleTrack[] = [];
  for (const raw of data) {
    const t = raw as Record<string, unknown> | null;
    if (!t || typeof t !== 'object') continue;
    if (String(t.type || '') !== 'sub') continue;
    const id = Number(t.id);
    if (!Number.isFinite(id)) continue;
    const meta = mpvTrackMeta(t);
    out.push({
      id,
      title: mpvStr(t.title) ?? mpvStr(meta.title),
      lang: mpvStr(t.lang) ?? mpvStr(meta.language),
      codec: mpvStr(t.codec),
      selected: t.selected === true ? true : undefined,
      external: t.external === true ? true : undefined,
    });
  }
  return out;
}

/** ★ 2026-10-17（阶段2）：mpv `video-params` → 归一视频参数（w/h 缺失 = 无视频 → null） */
export function mpvVideoParams(data: unknown): MpvVideoParams | null {
  const v = data as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') return null;
  const w = mpvNum(v.w) ?? mpvNum(v.dw) ?? 0;
  const h = mpvNum(v.h) ?? mpvNum(v.dh) ?? 0;
  if (w <= 0 || h <= 0) return null;
  return {
    w,
    h,
    pixelformat: mpvStr(v.pixelformat),
    primaries: mpvStr(v.primaries),
    gamma: mpvStr(v.gamma),
    light: mpvStr(v.light),
    sigPeak: mpvNum(v['sig-peak']),
    // ★ 本内核自定义键（其余构建不提供 → undefined）
    hdrVivid: v['hdr-vivid'] === true ? true : undefined,
  };
}

/** ★ 2026-10-17（阶段2）：mpv `audio-params` → 归一音频参数（无有效字段 → null） */
export function mpvAudioParams(data: unknown): MpvAudioParams | null {
  const a = data as Record<string, unknown> | null;
  if (!a || typeof a !== 'object') return null;
  const out: MpvAudioParams = {};
  const sr = mpvNum(a.samplerate);
  if (sr) out.samplerate = sr;
  const cc = mpvNum(a['channel-count']);
  if (cc) out.channelCount = cc;
  const ch = mpvStr(a.channels);
  if (ch) out.channels = ch;
  return Object.keys(out).length ? out : null;
}

/** 音轨列表内容是否相同（避免每次 property-change 都 setState 触发重渲染） */
export function sameAudioTracks(a: readonly MpvAudioTrack[], b: readonly MpvAudioTrack[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.title === y.title && x.lang === y.lang
      && x.codec === y.codec && x.channels === y.channels && x.selected === y.selected;
  });
}

/** ★ 阶段2：字幕轨列表判等 */
export function sameSubtitleTracks(a: readonly MpvSubtitleTrack[], b: readonly MpvSubtitleTrack[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && x.title === y.title && x.lang === y.lang
      && x.codec === y.codec && x.selected === y.selected && x.external === y.external;
  });
}

/** ★ 阶段2：键序稳定的浅比较（这两个对象都是我们按固定键序构造的） */
function sameFlat(a: object | null, b: object | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** ★ 阶段2：视频/音频参数判等（避免无谓推送） */
export function sameVideoParams(a: MpvVideoParams | null, b: MpvVideoParams | null): boolean {
  return sameFlat(a, b);
}
export function sameAudioParams(a: MpvAudioParams | null, b: MpvAudioParams | null): boolean {
  return sameFlat(a, b);
}

/** JSON IPC 一行（命令或属性观察） */
export function mpvCmdLine(cmd: unknown[]): string {
  return JSON.stringify({ command: cmd }) + '\n';
}

/** 观察属性命令行（连接建立后立即下发） */
export function mpvObserveLines(): string[] {
  return MPV_OBSERVED.map((o) => mpvCmdLine(['observe_property', o.id, o.name]));
}

/**
 * ★ 超分插件（M1）：整链替换 mpv 着色器（`glsl-shaders`）。
 *
 * 口径（设计文档 §10）：**不用**拼接串（`set glsl-shaders "a:b:c"` —— 路径含分隔符/转义易出错），
 * 改为**逐条** `change-list`：先 `clr ""` 清空，再对每个绝对路径 `append`。
 * 空数组 = 只清空（关闭超分）；返回空数组 = 无路径且无意义（调用方自行决定是否下发 clr）。
 */
export function mpvShadersCmd(paths: readonly string[]): string[] {
  const list = (paths ?? []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const lines = [mpvCmdLine(['change-list', 'glsl-shaders', 'clr', ''])];
  for (const p of list) lines.push(mpvCmdLine(['change-list', 'glsl-shaders', 'append', p]));
  return lines;
}

/**
 * 归一 mpv 推送的一行消息到内核状态（就地更新，返回是否有变化）。
 * 覆盖：property-change（time-pos/duration/pause/paused-for-cache/eof-reached/width/height/
 * cache-speed/demuxer-cache-time/track-list/aid）、file-loaded、end-file。
 */
export function reduceMpvMessage(state: MpvKernelState, msg: unknown): boolean {
  const m = msg as { event?: string; name?: string; data?: unknown; reason?: string; error?: unknown } | null;
  if (!m || typeof m !== 'object') return false;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // 解复用器读包失败也可能报告 EOF；已知时长时还要检查是否真正走到末尾。
  const finishPlayback = (): boolean => {
    if (state.error) {
      if (!state.eof) return false;
      state.eof = false;
      return true;
    }
    const error = !state.loaded || !state.playbackStarted
      ? '读取或解码失败'
      : state.duration != null && state.duration > 0 && (state.time ?? 0) < state.duration - 2
        ? '视频流提前结束'
        : null;
    if (error) {
      state.error = error;
      state.eof = false;
      return true;
    }
    if (state.eof) return false;
    state.eof = true;
    return true;
  };
  if (m.event === 'property-change') {
    switch (m.name) {
      case 'time-pos': {
        const v = num(m.data);
        if (v === null || v === state.time) return false;
        state.time = v;
        if (v > 0.25) state.playbackStarted = true;
        return true;
      }
      case 'duration': {
        // 直播/未知 → null（mpv 对未知时长回传 null）
        if (m.data === null) return state.duration === null ? false : ((state.duration = null), true);
        const v = num(m.data);
        if (v === null) return false;
        const live = v > 0 ? false : state.live;
        if (v === state.duration && live === state.live) return false;
        state.duration = v;
        state.live = live;
        return true;
      }
      case 'pause': {
        const v = !!m.data;
        if (v === state.paused) return false;
        state.paused = v;
        return true;
      }
      case 'paused-for-cache': {
        const v = !!m.data;
        if (v === state.buffering) return false;
        state.buffering = v;
        return true;
      }
      case 'eof-reached': {
        const v = !!m.data;
        if (!v) {
          if (!state.eof) return false;
          state.eof = false;
          return true;
        }
        return finishPlayback();
      }
      case 'width':
      case 'height': {
        const v = num(m.data);
        if (v === null || v <= 0) return false;
        // mpv 的 width/height 是**物理像素**（与 osd-dimensions 同口径，PoC 实测）
        if (m.name === 'width') { if (v === state.videoW) return false; state.videoW = v; }
        else { if (v === state.videoH) return false; state.videoH = v; }
        return true;
      }
      case 'cache-speed': {
        const v = num(m.data);
        if (v === null) return false;
        const kbps = v / 1024;
        if (Math.abs(kbps - state.cacheKbps) < 0.5) return false;
        state.cacheKbps = kbps;
        return true;
      }
      case 'demuxer-cache-time': {
        const v = num(m.data);
        if (v === state.cacheTime) return false;
        state.cacheTime = v;
        return true;
      }
      // ★ 2026-10-17（用户要求「音轨设置」）：音轨表 / 当前音轨
      // ★ 2026-10-17（阶段2）：同一次 track-list 事件里**顺便**归一出字幕轨（不新增观察项）
      case 'track-list': {
        const audio = mpvAudioTracks(m.data);
        const subs = mpvSubtitleTracks(m.data);
        let changed = false;
        if (!sameAudioTracks(state.audioTracks, audio)) { state.audioTracks = audio; changed = true; }
        if (!sameSubtitleTracks(state.subtitles, subs)) { state.subtitles = subs; changed = true; }
        return changed;
      }
      case 'aid': {
        const v = num(m.data);
        if (v === state.aid) return false;
        state.aid = v;
        return true;
      }
      // ---------- ★ 2026-10-17（阶段2）：MPV 内核能力面 ----------
      case 'video-params': {
        const v = mpvVideoParams(m.data);
        if (sameVideoParams(state.video, v)) return false;
        state.video = v;
        return true;
      }
      case 'audio-params': {
        const v = mpvAudioParams(m.data);
        if (sameAudioParams(state.audio, v)) return false;
        state.audio = v;
        return true;
      }
      case 'video-format': {
        const s = mpvStr(m.data) ?? '';
        if (s === state.vCodec) return false;
        state.vCodec = s;
        return true;
      }
      case 'audio-codec-name': {
        const s = mpvStr(m.data) ?? '';
        if (s === state.aCodec) return false;
        state.aCodec = s;
        return true;
      }
      case 'hwdec-current': {
        const s = mpvStr(m.data) ?? '';
        if (s === state.hwdec) return false;
        state.hwdec = s;
        return true;
      }
      // ★ 实测：这两个属性的单位是 **bps**（不是 kbps）→ 统一存 kbps（÷1000 四舍五入）
      case 'video-bitrate':
      case 'audio-bitrate': {
        const bps = mpvNum(m.data) ?? 0;
        const kbps = bps > 0 ? Math.round(bps / 1000) : 0;
        if (m.name === 'video-bitrate') {
          if (kbps === state.vBitrateKbps) return false;
          state.vBitrateKbps = kbps;
        } else {
          if (kbps === state.aBitrateKbps) return false;
          state.aBitrateKbps = kbps;
        }
        return true;
      }
      case 'container-fps': {
        const v = num(m.data);
        if (v === null || v === state.fps) return false;
        state.fps = v;
        return true;
      }
      case 'frame-drop-count': {
        const v = mpvNum(m.data);
        if (v === undefined || v === state.dropped) return false;
        state.dropped = v;
        return true;
      }
      case 'demuxer-cache-duration': {
        const v = num(m.data);
        if (v === state.cacheDuration) return false;
        state.cacheDuration = v;
        return true;
      }
      case 'audio-spdif': {
        const s = mpvStr(m.data) ?? '';
        if (s === state.spdif) return false;
        state.spdif = s;
        return true;
      }
      case 'sid': {
        // mpv 对「无字幕」回传 false/null → null（与 aid 同口径）
        const v = m.data === false || m.data === null ? null : num(m.data);
        if (v === state.sid) return false;
        state.sid = v;
        return true;
      }
      default:
        return false;
    }
  }
  if (m.event === 'file-loaded') {
    if (state.loaded) return false;
    state.loaded = true;
    // 未知时长不等于直播；保持启动提示，有限时长由 duration 事件纠正。
    return true;
  }
  if (m.event === 'end-file') {
    // reason: eof / stop / quit / error / redirect …
    if (m.reason === 'error') {
      const detail = typeof m.error === 'string'
        ? String(m.error)
        : '读取或解码失败';
      if (state.error === detail && !state.eof) return false;
      state.error = detail;
      state.eof = false;
      return true;
    }
    if (m.reason === 'eof') return finishPlayback();
  }
  return false;
}

/** 画面比例（PlayerFit）→ mpv 属性（[] = 保持 mpv 默认，等价 contain） */
export function mpvFitProps(fit: string): Array<[string, string]> {
  switch (fit) {
    case 'fill':
      return [['keepaspect', 'no'], ['panscan', '0'], ['video-unscaled', 'no'], ['video-aspect-override', 'no']];
    case 'cover':
      return [['keepaspect', 'yes'], ['panscan', '1.0'], ['video-unscaled', 'no'], ['video-aspect-override', 'no']];
    case 'r169':
      return [['keepaspect', 'yes'], ['panscan', '0'], ['video-unscaled', 'no'], ['video-aspect-override', '16:9']];
    case 'r43':
      return [['keepaspect', 'yes'], ['panscan', '0'], ['video-unscaled', 'no'], ['video-aspect-override', '4:3']];
    case 'none':
      return [['video-unscaled', 'yes'], ['keepaspect', 'yes'], ['panscan', '0'], ['video-aspect-override', 'no']];
    default: // contain
      return [['keepaspect', 'yes'], ['panscan', '0'], ['video-unscaled', 'no'], ['video-aspect-override', 'no']];
  }
}

export interface BuildMpvArgsOptions {
  /** IPC 管道名（\\.\pipe\…） */
  pipe: string;
  /** 父窗口 HWND（十进制字符串） */
  wid: string;
  /** 起播位置（秒，>0 才传） */
  start?: number;
  /** 音量 0..1 */
  volume?: number;
  /** 倍速 */
  rate?: number;
  /** 画面比例（PlayerFit） */
  fit?: string;
}

/**
 * mpv 启动参数。
 * ★ 关键项：--wid 嵌入 / --input-ipc-server JSON IPC / --idle 先空转（连接后再 loadfile）/
 *   --keep-open=yes 播完保留末帧（等我们切下一集）/ --hwdec=auto-safe 4K 硬解（失败自动回软解）/
 *   --input-default-bindings=no（键盘鼠标不抢，全由 HTML 层接管）。
 */
export function buildMpvArgs(o: BuildMpvArgsOptions): string[] {
  const args = [
    '--no-config',
    '--idle=yes',
    '--force-window=yes',
    '--keep-open=yes',
    '--hwdec=auto-safe',
    // gpu-next/libplacebo fails FBO allocation on some integrated GPUs after switching sources.
    '--vo=gpu',
    '--gpu-api=d3d11',
    '--gpu-context=d3d11',
    '--d3d11-feature-level=11_0',
    '--osc=no',
    '--input-default-bindings=no',
    '--input-vo-keyboard=no',
    '--msg-level=all=error',
    /**
     * ★ 2026-10-17（内存优化专项 A3，用户拍板「可接受」）：**给 mpv 的 demuxer 缓存封顶**。
     *   此前带 `--no-config` 且未覆盖缓存 → 取 mpv 默认（前向 `demuxer-max-bytes` ≈150MB +
     *   回看 `demuxer-max-back-bytes` ≈50MB）。封顶到 64/16 MiB 后单进程可省 ~120MB；
     *   代价 = **大范围拖拽 seek 的回填变慢**（用户已确认接受）。
     */
    '--demuxer-max-bytes=64MiB',
    '--demuxer-max-back-bytes=16MiB',
    // ★ 影视仓开箱体验对齐：内嵌多轨自动首选中文字幕与中文音轨，倍速变调保真，网络流防丢包
    '--slang=zh,chi,chs,sc,cht,tc',
    '--alang=zh,chi,chs,sc,cmn,yue',
    '--audio-pitch-correction=yes',
    '--sub-auto=fuzzy',
    '--stream-auto-disconnect=0',
    '--rtsp-transport=tcp',
    `--wid=${o.wid}`,
    `--input-ipc-server=${o.pipe}`,
  ];
  const start = Number(o.start) || 0;
  if (start > 0) args.push(`--start=${Math.floor(start)}`);
  const vol = Number(o.volume);
  if (Number.isFinite(vol)) args.push(`--volume=${Math.max(0, Math.min(130, Math.round(vol * 100)))}`);
  const rate = Number(o.rate);
  if (Number.isFinite(rate) && rate > 0) args.push(`--speed=${rate}`);
  for (const [k, v] of mpvFitProps(String(o.fit || 'contain'))) args.push(`--${k}=${v}`);
  return args;
}

/**
 * 渲染层命令 → mpv 命令**行**（不含 sub-add，见 MpvController：需要先落盘字幕文件）。
 * 返回空数组 = 该命令不走这里（sub-add/sub-clear 由控制器特殊处理）。
 */
export function mpvCommandLines(cmd: MpvCommand): string[] {
  switch (cmd?.type) {
    case 'play':
      return [mpvCmdLine(['set_property', 'pause', 'no'])];
    case 'pause':
      return [mpvCmdLine(['set_property', 'pause', 'yes'])];
    case 'seek':
      return [mpvCmdLine(['seek', Math.max(0, Number(cmd.value) || 0), 'absolute'])];
    case 'volume':
      return [mpvCmdLine(['set_property', 'volume', Math.max(0, Math.min(1, Number(cmd.value) || 0)) * 100])];
    case 'rate': {
      const r = Number(cmd.value);
      if (!Number.isFinite(r) || r <= 0) return [];
      return [mpvCmdLine(['set_property', 'speed', Math.max(0.25, Math.min(4, r))])];
    }
    case 'fit':
      return mpvFitProps(String(cmd.value || 'contain')).map(([k, v]) => mpvCmdLine(['set_property', k, v]));
    case 'sub-font':
      return [mpvCmdLine(['set_property', 'sub-font-size', mpvFontSize(cmd.value)])];
    case 'sub-pos':
      return [mpvCmdLine(['set_property', 'sub-pos', Math.max(0, Math.min(100, Math.round(Number(cmd.value) || 90)))])];
    // ★ 2026-10-17（用户要求「音轨设置」）：切音轨（mpv 的 aid = 音轨 id）
    case 'aid': {
      const id = Number(cmd.value);
      if (!Number.isFinite(id) || id <= 0) return [];
      return [mpvCmdLine(['set_property', 'aid', Math.round(id)])];
    }
    // ★ 2026-10-17（阶段2）：切字幕轨（mpv 的 sid）。
    // ★★ 实测坑（勿改回数字）：`sid` 在本内核是**字符串型**属性 —— `set_property sid -1`（数字）会回
    //   `unsupported format for accessing property`，**命令静默失败**（IPC 层只知写管道成功）。
    //   必须传字符串：`"no"`（关闭字幕，实测回 `sid=false` → 我们归一成 null）或 id 的十进制字符串。
    case 'sid': {
      const id = Math.round(Number(cmd.value));
      if (!Number.isFinite(id) || id === 0 || id < -1) return [];
      return [mpvCmdLine(['set_property', 'sid', id < 0 ? 'no' : String(id)])];
    }
    // ★ 2026-10-17（阶段2）：音频源码直通（'' 合法 = 关闭直通；只接受 mpv 认的编解码名列表串）
    case 'audio-spdif':
      return [mpvCmdLine(['set_property', 'audio-spdif', String(cmd.value ?? '')])];
    // ★ 超分插件（M1）：整链替换着色器（空数组 = 清空 = 关闭超分）
    case 'glsl-shaders':
      return mpvShadersCmd(cmd.value ?? []);
    default:
      return [];
  }
}

export interface MpvResolveOptions {
  /** 用户配置覆盖路径（playerSettings.mpvPath） */
  override?: string;
  /** 随包内置路径（resources/mpv/mpv.exe） */
  bundled?: string;
  /** 环境变量快照（本机探测用） */
  env?: Record<string, string | undefined>;
  exists: (p: string) => boolean;
}

export interface MpvResolveResult {
  path: string;
  source: 'override' | 'bundled' | 'system' | 'none';
}

/**
 * mpv.exe 解析链（★ 顺序即优先级）：
 *   ① 用户覆盖路径（非空且存在）→ ② 随包内置 resources/mpv/mpv.exe（安装目录内）→ ③ 本机常见安装位置。
 * 全部落空 → { path:'', source:'none' }（播放器里不显示 MPV 入口，错误上屏）。
 */
export function resolveMpvPath(o: MpvResolveOptions): MpvResolveResult {
  const safeExists = (p: string): boolean => {
    try {
      return !!p && o.exists(p);
    } catch {
      return false; // 非法路径（通配符等）→ 视为不存在
    }
  };
  const ov = (o.override || '').trim();
  if (ov && safeExists(ov)) return { path: ov, source: 'override' };
  const bundled = (o.bundled || '').trim();
  if (bundled && safeExists(bundled)) return { path: bundled, source: 'bundled' };
  const cands = playerCandidates(o.env || {}).filter((c) => c.id === 'mpv');
  for (const c of cands) {
    if (safeExists(c.path)) return { path: c.path, source: 'system' };
  }
  return { path: '', source: 'none' };
}
