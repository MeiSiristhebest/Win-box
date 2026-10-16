// src/main/util/mediaDiag.ts
/**
 * ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）播放诊断上报的**主进程侧**收集器。
 *
 * 为什么需要：`vod:play` 返回 URL 之后，画面/声音全在渲染层与 GPU 进程里跑，**主进程不再有任何日志**。
 *   出事时（最典型 = GPU 进程崩溃：合成器死 → 整窗不再刷新、连进度条都不动，音频走另一通道继续，
 *   用户看到的就是「只剩声音」）日志里只剩一行 `child-process-gone type=GPU` —— 查不到当时在放什么。
 *   这里把渲染层上报的媒体事件（含「帧停更」检测）缓存为「最后一次播放状态」，
 *   供 index.ts 的 child-process-gone 落盘带出，并按事件严重性分级落盘为 `media:*` 日志。
 *
 * 依赖方向：只有 main/ipc 调 noteMediaState（窗口身份由调用方传入），本模块不 import electron。
 */
import { fileLogger } from './logger';
import type { MediaStateEvent } from '../../shared/player';

/** 最近一次上报（跨窗口只留最新一条 + 它的窗口号/类型）：GPU 崩溃时用来说明「当时在放什么」 */
let last: { wcId: number; win: string; at: number; state: MediaStateEvent } | null = null;

/** 需要以 W（异常）级别落盘的事件：正常播放过程中的 play/pause/waiting 记为 I 即可 */
const LOUD = /^(error|stalled|emptied|frame-stall|hls-fatal)/;

/** 去掉查询串/片段：地址里可能带凭据或防盗链参数（落盘口径与 renderer-error 一致），并截断长度 */
function sanitizeUrl(u: unknown): string {
  const s = typeof u === 'string' ? u : '';
  if (!s) return '';
  const cut = s.search(/[?#]/);
  return (cut >= 0 ? s.slice(0, cut) : s).slice(0, 200);
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined;
}

/**
 * 记一条渲染层上报的播放事件。
 * @param wcId 上报窗口的 webContents id（GPU 崩溃时优先重载它 —— 「最后在播放的那个窗口」）
 * @param win  窗口类型（main / player / gone），仅用于日志可读性
 */
export function noteMediaState(wcId: number, win: string, raw: unknown): void {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<MediaStateEvent>;
  const state: MediaStateEvent = {
    event: String(r.event || 'unknown').slice(0, 48),
    kernel: r.kernel === 'mpv' ? 'mpv' : 'html5',
    url: sanitizeUrl(r.url),
    title: r.title ? String(r.title).slice(0, 80) : undefined,
    readyState: asNum(r.readyState),
    currentTime: asNum(r.currentTime),
    paused: !!r.paused,
  };
  last = { wcId, win, at: Date.now(), state };
  const brief =
    `media:${state.event} win=${win} wc=${wcId} kernel=${state.kernel}`
    + ` rs=${state.readyState ?? '-'} t=${state.currentTime ?? '-'} paused=${state.paused ? 1 : 0}`
    + `${state.title ? ` title=${state.title}` : ''}${state.url ? ` url=${state.url}` : ''}`;
  if (LOUD.test(state.event)) fileLogger.w(brief);
  else fileLogger.i(brief);
}

/** 最后一次上报的窗口 id（无上报 → null）。GPU 崩溃恢复据此选「最后在播放的那个窗口」。 */
export function lastMediaWcId(): number | null {
  return last ? last.wcId : null;
}

/** 供 child-process-gone 落盘的一段话：崩溃前的最后播放状态（无上报时如实说明） */
export function lastMediaSummary(): string {
  if (!last) return 'media=无上报（渲染层在进程出事前没有报过任何播放事件）';
  const ago = Math.max(0, Math.round((Date.now() - last.at) / 1000));
  const s = last.state;
  return (
    `media=${s.event} win=${last.win} kernel=${s.kernel} t=${s.currentTime ?? '-'} paused=${s.paused ? 1 : 0}`
    + `${s.title ? ` title=${s.title}` : ''}${s.url ? ` url=${s.url}` : ''}（${ago}s 前）`
  );
}
