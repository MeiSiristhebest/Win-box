import { ID_RE, type ValidateResult } from './core';
import { placeholdersOf } from './providerSchema';
import { isSafeRelPath } from './paths';

// ---------- ★ 第三方播放内核契约（`contributes.player.engine`）----------
// 唯一权威：`docs/design/插件制作规范.md` §6.3。**L2 / kind:"code"**。
//   ★ 形态（D1 已拍板）：**宿主托管** —— 插件只给「引擎描述符」（协议 / 二进制来源 / 参数模板），
//     **永不拉进程**（`spawn` / `child_process` 是 §6.2 **永久禁止项**）；宿主负责
//     spawn + `--wid` 嵌入 + 协议通信 + 状态推送。插件侧只见「描述符」，不见进程。
//   ★ v1 协议族 = 两个（D2 已拍板）：`mpv-ipc`（逐字复用宿主既有 mpv 全链路：`--input-ipc-server`
//     JSON IPC）＋ **通用 `json-lines`**（宿主定死线格式：stdin/stdout 一行一个 JSON 对象）。
//   ★ 二进制来源（D3 已拍板）：插件包内 `files/…` **随包自带**（主）或**用户本机路径覆盖**（次）。
//   ★ 授权（D4 已拍板）：**默认关** + 配置页单独开关 + 首次开启二次确认（安装期另有 R10 权限弹层）。

/** 引擎协议族（v1 = mpv 系 JSON IPC + 通用 JSON 行） */
export type PlayerEngineProtocol = 'mpv-ipc' | 'json-lines';
export const PLAYER_ENGINE_PROTOCOLS: readonly PlayerEngineProtocol[] = ['mpv-ipc', 'json-lines'];

/** 二进制来源：`plugin-file` = 插件包内 `files/…`（随包自带）；`local-path` = 用户在本机指定路径（配置页覆盖） */
export type PlayerEngineBinarySource = 'plugin-file' | 'local-path';
/** 引擎能力（宿主据此收敛 UI：不支持的控件不显示） */
export type PlayerEngineCapability = 'seek' | 'rate' | 'tracks' | 'subtitle' | 'fit';
export const PLAYER_ENGINE_CAPABILITIES: readonly PlayerEngineCapability[] = ['seek', 'rate', 'tracks', 'subtitle', 'fit'];

/**
 * 参数占位符白名单（宿主展开；见 `main/player/engineLines.expandEngineArgs`）：
 *   `{wid}`=窗口句柄 / `{pipe}`=IPC 管道名 / `{url}`=播放地址 / 余（`{start}` `{volume}` `{fit}` `{rate}`）为可选。
 * ★ exe 路径**不在 args 里** —— 由 `binary` 决定，宿主拼命令行。
 */
export const PLAYER_ENGINE_PLACEHOLDERS: readonly string[] = ['wid', 'pipe', 'url', 'start', 'volume', 'fit', 'rate'];

/**
 * 按协议分支的**必需 / 禁止**占位符（口径 = 「不满足它就不是一个可用的嵌入式内核」→ 拒装）：
 *   · `mpv-ipc`：必需 `{wid}` `{url}` **`{pipe}`**；
 *   · `json-lines`：必需 `{wid}` `{url}`，**不得**带 `{pipe}`（该族通道就是 stdin/stdout，带 `{pipe}` 说明作者误解协议）。
 */
const PLAYER_ENGINE_REQUIRED: Record<PlayerEngineProtocol, readonly string[]> = {
  'mpv-ipc': ['wid', 'url', 'pipe'],
  'json-lines': ['wid', 'url'],
};
const PLAYER_ENGINE_FORBIDDEN: Record<PlayerEngineProtocol, readonly string[]> = {
  'mpv-ipc': [],
  'json-lines': ['pipe'],
};

/** `contributes` 里 `type:"player.engine"` 的结构（L2 / kind=code；宿主托管进程） */
export interface PlayerEngineContribute {
  type: 'player.engine';
  /** 稳定 id（渲染层内核值用 `engine:<id>`） */
  id: string;
  label: string;
  /** 协议族（见 §6.3 线格式） */
  protocol: PlayerEngineProtocol;
  /** 二进制来源（缺省 `{source:'plugin-file'}`） */
  binary?: { source?: PlayerEngineBinarySource; /** `plugin-file` 时必填：插件内相对名，如 `files/my-mpv.exe` */ file?: string };
  /** 参数模板（含占位符；**exe 路径不在 args 里** —— 由 `binary` 决定，宿主拼命令行） */
  args: string[];
  capabilities?: PlayerEngineCapability[];
}

const PLAYER_ENGINE_FIELDS: readonly string[] = ['type', 'id', 'label', 'protocol', 'binary', 'args', 'capabilities'];
const PLAYER_ENGINE_MAX_ARGS = 24;

/** 单个 args 项的文本 / 占位符检查（返回描述；undefined = 合法） */
function engineArgTextError(s: unknown, i: number): string | undefined {
  if (typeof s !== 'string') return `args[${i}] 须是字符串`;
  if (!s.trim()) return `args[${i}] 不得为空串`;
  if (/[\r\n]/.test(s)) return `args[${i}] 不得含换行`;
  for (const name of placeholdersOf(s)) {
    if (!PLAYER_ENGINE_PLACEHOLDERS.includes(name)) {
      return `args[${i}] 含未知占位符 {${name}}（允许 ${PLAYER_ENGINE_PLACEHOLDERS.map((x) => `{${x}}`).join(' / ')}）`;
    }
  }
  return undefined;
}

/**
 * 校验 `contributes.player.engine`（纯函数）。
 * ★ 只做**结构性**约束：占位符白名单 / 按协议的必需与禁止 / binary 形态 / capabilities 枚举与去重。
 *   结构性（空、换行、缺必需占位符、占位符越界）→ `BAD_ENGINE_ARGS`；其余 → `PLAYER_ENGINE_INVALID`。
 */
export function validatePlayerEngineContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.label 必填（1~40 字，不含换行）' };
  }
  const protocol = t.protocol as PlayerEngineProtocol;
  if (!PLAYER_ENGINE_PROTOCOLS.includes(protocol)) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: `player.engine.protocol 须为 ${PLAYER_ENGINE_PROTOCOLS.join(' | ')}` };
  }
  for (const k of Object.keys(t)) {
    if (!PLAYER_ENGINE_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: `player.engine 字段未知：${k}` };
    }
  }
  // binary（**缺省 = `{source:'plugin-file'}`** —— 该来源要求 `file`，故「完全不写 binary」同样会被拒）
  const binaryRaw: unknown = t.binary == null ? {} : t.binary;
  if (typeof binaryRaw !== 'object' || Array.isArray(binaryRaw)) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.binary 须是对象' };
  }
  const b = binaryRaw as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (k !== 'source' && k !== 'file') {
      return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: `player.engine.binary 字段未知：${k}` };
    }
  }
  const source = b.source == null ? 'plugin-file' : b.source;
  if (source !== 'plugin-file' && source !== 'local-path') {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.binary.source 须为 plugin-file | local-path' };
  }
  if (source === 'plugin-file') {
    if (!isSafeRelPath(b.file)) {
      return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.binary.file 必填且须是插件内安全相对路径（如 files/my-mpv.exe）' };
    }
  } else if (b.file != null) {
    return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.binary.source=local-path 时不得带 file（路径由用户在配置页指定）' };
  }
  // args（结构性 → BAD_ENGINE_ARGS）
  const args = t.args;
  if (!Array.isArray(args) || !args.length) {
    return { ok: false, reasonCode: 'BAD_ENGINE_ARGS', reason: 'player.engine.args 须是非空数组' };
  }
  if (args.length > PLAYER_ENGINE_MAX_ARGS) {
    return { ok: false, reasonCode: 'BAD_ENGINE_ARGS', reason: `player.engine.args 不得超过 ${PLAYER_ENGINE_MAX_ARGS} 项` };
  }
  const present = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const err = engineArgTextError(args[i], i);
    if (err) return { ok: false, reasonCode: 'BAD_ENGINE_ARGS', reason: err };
    for (const name of placeholdersOf(args[i] as string)) present.add(name);
  }
  for (const name of PLAYER_ENGINE_REQUIRED[protocol]) {
    if (!present.has(name)) {
      return { ok: false, reasonCode: 'BAD_ENGINE_ARGS', reason: `player.engine.args 缺少协议 ${protocol} 必需的占位符 {${name}}` };
    }
  }
  for (const name of PLAYER_ENGINE_FORBIDDEN[protocol]) {
    if (present.has(name)) {
      return { ok: false, reasonCode: 'BAD_ENGINE_ARGS', reason: `player.engine.args 不得含占位符 {${name}}（协议 ${protocol} 的通道是 stdin/stdout，不是管道）` };
    }
  }
  // capabilities
  if (t.capabilities != null) {
    const caps = t.capabilities;
    if (!Array.isArray(caps) || !caps.length) {
      return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: 'player.engine.capabilities（若写）须是非空数组' };
    }
    const seen = new Set<string>();
    for (const cap of caps) {
      if (!PLAYER_ENGINE_CAPABILITIES.includes(cap as PlayerEngineCapability)) {
        return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: `player.engine.capabilities 取值非法：${cap}（允许 ${PLAYER_ENGINE_CAPABILITIES.join(' / ')}）` };
      }
      if (seen.has(cap as string)) {
        return { ok: false, reasonCode: 'PLAYER_ENGINE_INVALID', reason: `player.engine.capabilities 重复：${cap}` };
      }
      seen.add(cap as string);
    }
  }
  return { ok: true };
}

/** 取插件的**第一个** `player.engine` 贡献项（未声明 → undefined；一个插件可声明多个内核，宿主按全部装配） */
export function playerEngineContributeOf(contributes: Array<{ type: string }> | undefined): PlayerEngineContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'player.engine');
  return c ? (c as unknown as PlayerEngineContribute) : undefined;
}

