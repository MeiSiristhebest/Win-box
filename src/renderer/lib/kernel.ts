// src/renderer/lib/kernel.ts
// ★ 2026-10-08（用户拍板「内置官方构建」）：播放内核选择的**纯函数**（可单测）。
//
// 双内核口径（调研结论，见 .workbuddy/memory/2026-10-08.md §二）：
//   · HTML5（hls.js / mpegts.js / 原生 <video>）继续做默认内核，零依赖兜底；
//   · MPV 为**高兼容内核**：已知 Chromium 播不好的容器（MKV/AVI/WMV/RMVB 等）自动改走 mpv，
//     其余资源可一键手动切换；4K / HEVC / HDR 这类「只有解了才知道播不动」的场景，
//     HTML5 失败时也有一键/自动（pref='auto'）转 mpv 的兜底。
//
// ★ 2026-10-18（R11）：内核从「双选」扩为「内置 2 + 插件 N」——
//   插件引擎的渲染层内核值 = `engine:<contributeId>`（见 插件制作规范 §6.3 / shared/plugin.ts 的 PlayerEngineView）。
//   ★ `auto` 语义**不变**：插件引擎**不参与 auto**（必须用户在配置页/控制条显式选），
//     自动切换只在 html5 ↔ mpv 之间发生（插件内核涉及执行本机程序，不做隐式选择）。
import { detectMediaKind } from './mediaKind';
import { resolvePlayTarget } from './playTarget';

/** 本次播放实际使用的内核（内置 2 + 插件引擎 `engine:<contributeId>`） */
export type Kernel = 'html5' | 'mpv' | `engine:${string}`;
/** 用户偏好：auto = 按资源形态自动；html5/mpv/`engine:*` = 显式指定（手动切换后记住） */
export type KernelPref = 'auto' | 'html5' | 'mpv' | `engine:${string}`;

/** 插件引擎内核值前缀（`engine:<contributeId>`） */
export const ENGINE_PREFIX = 'engine:';

/** 是否为插件引擎内核值 */
export function isEngineKernel(k: unknown): k is `engine:${string}` {
  return typeof k === 'string' && k.startsWith(ENGINE_PREFIX) && k.length > ENGINE_PREFIX.length;
}

/**
 * 已知 Chromium **解不了/解不好**的容器扩展名（MSE 无对应 demuxer 或支持极差）：
 * mkv（H.264 之外的编码基本必挂）、avi/wmv/rmvb（老容器）、m2ts（蓝光 TS）、vob/divx/f4v。
 * 注意 `.ts` 不在列（mpegts.js 已覆盖，`.ts` 直播居多）。
 */
const MPV_EXT = new Set(['mkv', 'avi', 'wmv', 'rmvb', 'm2ts', 'vob', 'divx', 'f4v']);

/** 资源形态是否**倾向** mpv 内核（图片/音频/无载体协议一律 false，不走内核切换） */
export function preferMpvKernel(url: string): boolean {
  const kind = detectMediaKind(url);
  if (kind === 'image' || kind === 'audio' || kind === 'unsupported') return false;
  // 还原 `/play?url=…` 中继后再取扩展名（与 mediaKind 同口径）
  const s = (resolvePlayTarget(url || '') || '').toLowerCase().split('?')[0].split('#')[0];
  const m = /\.([a-z0-9]{2,5})$/.exec(s);
  return !!m && MPV_EXT.has(m[1]);
}

/** 内核可用性（由宿主 status / 引擎列表决定；渲染层据此收敛可选集合） */
export interface KernelOptions {
  /** 内置 mpv 是否可用（未内置且本机未探测到 → false） */
  mpvAvailable: boolean;
  /** **已启用且就绪**的插件引擎内核值集合（`engine:<contributeId>`）；**不参与 auto** */
  engines: readonly string[];
  /** Media probing confirmed that standard playback needs conversion. Prefer native decoding when available. */
  requiresCompatibility?: boolean;
}

/** `auto` 结果（只在 html5 ↔ mpv 之间选；mpv 不可用 → html5） */
function autoKernel(url: string, opts: KernelOptions): Kernel {
  return opts.mpvAvailable && (opts.requiresCompatibility || preferMpvKernel(url)) ? 'mpv' : 'html5';
}

/**
 * 本次生效内核：
 *   · 显式偏好优先；不可用一律回落 —— mpv 不可用 → html5，插件内核不在可用集合 → 回落 `auto` 结果；
 *   · `'auto'` → 按资源形态（preferMpvKernel），**插件引擎不参与**。
 */
export function resolveKernel(pref: KernelPref, url: string, opts: KernelOptions): Kernel {
  const engines = opts?.engines ?? [];
  if (pref === 'html5') return 'html5';
  if (isEngineKernel(pref)) return engines.includes(pref) ? pref : autoKernel(url, opts);
  if (pref === 'mpv') return opts?.mpvAvailable ? 'mpv' : 'html5';
  return autoKernel(url, opts);
}
