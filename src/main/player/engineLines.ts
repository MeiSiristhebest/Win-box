// src/main/player/engineLines.ts
// ★ 2026-10-18（R11）第三方播放内核的**纯逻辑**（不 import electron，可单测）。
//   与 `mpvCore.ts` 的分工：`mpv-ipc` 协议族**逐字复用** `mpvCore`（观察/命令/归约）；
//   本文件只负责**插件引擎描述符**相关的三件事：
//     ① 参数模板展开 `expandEngineArgs`（可选占位符缺省 → **整项丢弃**）；
//     ② 通用 `json-lines` 族的**下行命令** `engineCommandLines` / `engineLoadLine`（一行一个 JSON 对象）；
//     ③ 通用 `json-lines` 族的**上行事件归约** `reduceEngineEvent`（归一到与 mpv 同一套 `MpvKernelState`）。
//
// 线格式（宿主定死，见 插件制作规范 §6.3 / R11 spec §2.1.1）：
//   宿主 → 引擎：`{"cmd":"load","url":…,"start":…,"paused":…,"volume":…,"rate":…,"fit":…}`
//                `{"cmd":"play"} {"cmd":"pause"} {"cmd":"seek","value":…} {"cmd":"volume","value":…}`
//                `{"cmd":"rate","value":…} {"cmd":"fit","value":"contain"} {"cmd":"quit"}`
//   引擎 → 宿主：`{"event":"loaded","duration":…,"live":…}` `{"event":"time","value":…}`
//                `{"event":"duration","value":…}` `{"event":"paused","value":…}` `{"event":"eof"}`
//                `{"event":"exit"}` `{"event":"tracks","audio":[{"id":1,"title":"国语"}],"sub":[{"id":2}]}`
//                `{"event":"error","message":"…"}`
//   ★ 未识别的事件/字段一律**忽略**（前向兼容）；字段名即上表（**不做字段重映射**）。

import { placeholdersOf } from '../../shared/plugin';
import type { MpvAudioTrack, MpvCommand, MpvKernelState, MpvSubtitleTrack } from '../../shared/player';
import { sameAudioTracks, sameSubtitleTracks } from './mpvCore';

/** 参数模板变量（`{wid}`/`{pipe}`/`{url}` 必需；`{start}`/`{volume}`/`{fit}`/`{rate}` 可选） */
export interface EngineArgVars {
  wid?: string;
  pipe?: string;
  url?: string;
  start?: number;
  volume?: number;
  fit?: string;
  rate?: number;
}

/**
 * **可选**占位符 —— 缺省时该参数项**整项丢弃**（避免传空串导致内核报错；见 §6.3）。
 * 其余（`{wid}`/`{pipe}`/`{url}`）为必需，已在契约校验期保证出现。
 */
const ENGINE_OPTIONAL = new Set(['start', 'volume', 'fit', 'rate']);

/** 变量是否有「有效值」（缺省/空串 → 视为无值，触发整项丢弃） */
function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

/**
 * 展开引擎启动参数模板（纯函数）。
 * · 逐项替换 `{wid}`/`{pipe}`/`{url}`/`{start}`/`{volume}`/`{fit}`/`{rate}`；
 * · 本项含任一**可选**占位符却无对应值 → **整项丢弃**（例如 `--speed={rate}` 在未指定倍速时不传入）。
 */
export function expandEngineArgs(args: readonly string[], vars: EngineArgVars): string[] {
  const out: string[] = [];
  for (const raw of args ?? []) {
    if (typeof raw !== 'string' || !raw) continue;
    let drop = false;
    for (const name of placeholdersOf(raw)) {
      if (ENGINE_OPTIONAL.has(name) && !hasValue((vars as Record<string, unknown>)[name])) {
        drop = true;
        break;
      }
    }
    if (drop) continue;
    out.push(
      raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => {
        const v = (vars as Record<string, unknown>)[name];
        return hasValue(v) ? String(v) : whole;
      }),
    );
  }
  return out;
}

/** 一行 JSON（`json-lines` 族的行格式：UTF-8、`\n` 分隔） */
function jsonLine(o: unknown): string {
  return JSON.stringify(o) + '\n';
}

/** `{"cmd":"load",…}` —— 会话起播（**json-lines 族**；mpv-ipc 走 `loadfile` 命令） */
export function engineLoadLine(o: {
  url: string;
  start?: number;
  paused?: boolean;
  volume?: number;
  rate?: number;
  fit?: string;
}): string {
  const start = Number(o.start);
  const volume = Number(o.volume);
  const rate = Number(o.rate);
  return jsonLine({
    cmd: 'load',
    url: String(o.url ?? ''),
    start: Number.isFinite(start) && start > 0 ? start : 0,
    paused: !!o.paused,
    volume: Number.isFinite(volume) ? volume : 1,
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    fit: String(o.fit || 'contain'),
  });
}

/** `{"cmd":"quit"}` —— 停止会话（与 mpv 的 `quit` 命令同口径） */
export const ENGINE_QUIT_LINE = '{"cmd":"quit"}\n';

/**
 * 渲染层命令 → **json-lines 下行命令行**（返回空数组 = 该命令在通用族里无对应动作）。
 * ★ `load` 不走这里（起播时由 `engineLoadLine` 单独下发）；`quit` 由 `ENGINE_QUIT_LINE` 下发。
 * ★ `sub-add`/`sub-font`/`sub-pos`/`aid`/`sid`/`sr-mode` 等 mpv 专属命令在通用族**无对应动作** → 空数组
 *   （插件若声明了 `capabilities`，宿主 UI 据此收敛；不提供假能力）。
 */
export function engineCommandLines(cmd: MpvCommand): string[] {
  switch (cmd?.type) {
    case 'play':
      return [jsonLine({ cmd: 'play' })];
    case 'pause':
      return [jsonLine({ cmd: 'pause' })];
    case 'seek': {
      const v = Number(cmd.value);
      if (!Number.isFinite(v)) return [];
      return [jsonLine({ cmd: 'seek', value: Math.max(0, v) })];
    }
    case 'volume': {
      const v = Number(cmd.value);
      if (!Number.isFinite(v)) return [];
      return [jsonLine({ cmd: 'volume', value: Math.max(0, Math.min(1, v)) })];
    }
    case 'rate': {
      const v = Number(cmd.value);
      if (!Number.isFinite(v) || v <= 0) return [];
      return [jsonLine({ cmd: 'rate', value: Math.max(0.25, Math.min(4, v)) })];
    }
    case 'fit':
      return [jsonLine({ cmd: 'fit', value: String(cmd.value || 'contain') })];
    default:
      return [];
  }
}

/** 轨道项归一（`{id,title,lang}` → 宿主轨道结构；无有效 id → null） */
function trackOf(raw: unknown): { id: number; title?: string; lang?: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const id = Number(t.id);
  if (!Number.isFinite(id)) return null;
  const title = typeof t.title === 'string' && t.title ? t.title : undefined;
  const lang = typeof t.lang === 'string' && t.lang ? t.lang : undefined;
  return { id, ...(title ? { title } : {}), ...(lang ? { lang } : {}) };
}

/**
 * 归约 `json-lines` 族的一行事件到内核状态（就地更新，返回是否有变化）。
 * 与 `reduceMpvMessage` 同一套 `MpvKernelState` 字段口径；未识别的事件/字段**忽略**（前向兼容）。
 */
export function reduceEngineEvent(state: MpvKernelState, obj: unknown): boolean {
  const m = obj as Record<string, unknown> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  switch (m.event) {
    case 'loaded': {
      let changed = false;
      if (!state.loaded) {
        state.loaded = true;
        changed = true;
      }
      const d = num(m.duration);
      if (d != null && d > 0) {
        if (state.duration !== d) {
          state.duration = d;
          changed = true;
        }
        if (state.live) {
          state.live = false;
          changed = true;
        }
      } else if (m.live === true && !state.live) {
        state.live = true;
        changed = true;
      }
      return changed;
    }
    case 'time': {
      const v = num(m.value);
      if (v === null || v === state.time) return false;
      state.time = v;
      if (v > 0.25) state.playbackStarted = true;
      return true;
    }
    case 'duration': {
      if (m.value === null) return state.duration === null ? false : ((state.duration = null), true);
      const v = num(m.value);
      if (v === null) return false;
      const live = v > 0 ? false : state.live;
      if (v === state.duration && live === state.live) return false;
      state.duration = v;
      state.live = live;
      return true;
    }
    case 'paused': {
      const v = !!m.value;
      if (v === state.paused) return false;
      state.paused = v;
      return true;
    }
    case 'buffering': {
      const v = !!m.value;
      if (v === state.buffering) return false;
      state.buffering = v;
      return true;
    }
    case 'eof': {
      if (state.eof) return false;
      state.eof = true;
      return true;
    }
    case 'exit': {
      if (state.exited) return false;
      state.exited = true;
      return true;
    }
    case 'error': {
      const message = typeof m.message === 'string' && m.message ? m.message : '引擎报告错误';
      if (state.error === message) return false;
      state.error = message;
      return true;
    }
    case 'tracks': {
      const audio: MpvAudioTrack[] = (Array.isArray(m.audio) ? m.audio : [])
        .map(trackOf)
        .filter((x): x is { id: number; title?: string; lang?: string } => !!x);
      const sub: MpvSubtitleTrack[] = (Array.isArray(m.sub) ? m.sub : [])
        .map(trackOf)
        .filter((x): x is { id: number; title?: string; lang?: string } => !!x);
      let changed = false;
      if (!sameAudioTracks(state.audioTracks, audio)) {
        state.audioTracks = audio;
        changed = true;
      }
      if (!sameSubtitleTracks(state.subtitles, sub)) {
        state.subtitles = sub;
        changed = true;
      }
      return changed;
    }
    default:
      return false;
  }
}
