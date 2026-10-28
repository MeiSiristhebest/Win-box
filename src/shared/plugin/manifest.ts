import { ID_RE, type ValidateResult } from './core';
import { isSafeRelPath } from './paths';
import { validateThemeContribute } from './theme';
import { validateSubtitleProviderContribute } from './subtitleProvider';
import { validateMetaProviderContribute } from './metaProvider';
import { validateDiscoverSourceContribute } from './discoverSource';
import { validateDanmakuSourceContribute } from './danmakuSource';
import { validateLiveTemplateContribute } from './liveTemplate';
import { validateUiCommandContribute, validateKeymapContribute } from './uiActions';
import { validateSettingsPanelContribute } from './settingsPanel';
import { validateUiSlotContribute } from './uiSlot';
import { validatePlayerEngineContribute } from './playerEngine';
import { validateSpiderRuntimeContribute } from './spiderRuntime';

export const HOST_API_VERSION = '1.x';
export const MANIFEST_VERSION = 1;

export type PluginKind = 'asset' | 'code';
/** 来源：builtin = 随包官方插件（resources/plugins）；user = 用户安装；none = 未安装 */
export type PluginSource = 'builtin' | 'user' | 'none';
/** 能力分级 = **能力形态**（不是权限档位） */
export type PluginLevel = 'L1' | 'L2' | 'L3' | 'L4';

/** contributes 白名单（含允许的 `kind`；`level` 仅用于展示/校验提示） */
export const CONTRIBUTES: Record<string, { kinds: PluginKind[]; level: PluginLevel }> = {
  'mpv.shaders': { kinds: ['asset'], level: 'L1' },
  theme: { kinds: ['asset'], level: 'L1' },
  'danmaku.source': { kinds: ['asset', 'code'], level: 'L2' },
  'subtitle.provider': { kinds: ['asset', 'code'], level: 'L2' },
  'meta.provider': { kinds: ['asset', 'code'], level: 'L2' },
  'discover.source': { kinds: ['asset', 'code'], level: 'L2' },
  'live.template': { kinds: ['asset'], level: 'L2' },
  'player.engine': { kinds: ['code'], level: 'L2' },
  // Spider runtime executes plugin-supplied code and therefore requires an explicit L4 permission.
  'spider.runtime': { kinds: ['code'], level: 'L4' },
  'ui.slot': { kinds: ['asset'], level: 'L3' },
  'ui.command': { kinds: ['asset', 'code'], level: 'L3' },
  // ★ 2026-10-18（R10）：`settings.panel` 允许 `code` —— §5.11 明确「值的读取面留给 L4」，
  //   即 code 插件声明自己的设置面板、再经 `winbox.settings` 读；面板内容本身是**声明式 UI**，与 kind 无关。
  'settings.panel': { kinds: ['asset', 'code'], level: 'L3' },
  keymap: { kinds: ['asset'], level: 'L3' },
};

/**
 * permissions 白名单（**只属 L4 / kind=code**）。
 * ★ 2026-10-18（R10）：改为 `as const` 元组 —— 供 `PermissionId` 字面量类型 + 沙箱侧挂载表共用。
 */
export const PERMISSIONS = [
  'net', 'net.download', 'kv', 'settings', 'fs.plugin', 'log',
  'notify', 'clipboard.read', 'clipboard.write', 'dialog', 'player.control', 'openExternal', 'spider.runtime',
] as const;
/** 白名单权限的字面量类型（沙箱挂载表 / 宿主 API 面共用） */
export type PermissionId = (typeof PERMISSIONS)[number];

/** 权限 → 一句话用途（宿主兜底文案；`permissionNotes` 缺省时用于安装确认弹窗） */
export const PERMISSION_LABELS: Record<PermissionId, string> = {
  net: '发起网络请求（经宿主代理）',
  'net.download': '下载文件到插件目录',
  kv: '读写插件私有键值存储',
  settings: '读写插件自己的设置项',
  'fs.plugin': '读写**插件自身目录**内的文件',
  log: '写运行日志',
  notify: '弹系统通知',
  'clipboard.read': '读系统剪贴板',
  'clipboard.write': '写系统剪贴板',
  dialog: '显示应用内提示与确认',
  'player.control': '控制播放（播放 / 暂停 / 进度 / 音轨 / 字幕 / 音量）',
  openExternal: '用系统程序打开链接',
  'spider.runtime': '执行第三方 Spider 运行时代码。仅安装你信任的代码插件；插件 worker 不是安全隔离边界',
};

/** 判定是否白名单权限（校验器与沙箱共用；`PermissionId` 的守卫） */
export function isPermission(x: unknown): x is PermissionId {
  return typeof x === 'string' && (PERMISSIONS as readonly string[]).includes(x);
}

/** 禁用项（**永不提供**，声明即拒装） */
export const FORBIDDEN_PERMISSIONS: readonly string[] = [
  'main', 'spawn', 'child_process', 'eval', 'fs', 'cred', 'proxy', 'registry', 'raw.net',
];
/** 禁用的 contributes（红线） */
export const FORBIDDEN_CONTRIBUTES: readonly string[] = ['code.spider', 'main.hook', 'drive.provider'];

/** 运行库许可清单（宿主侧**唯一**来源；插件只能按 `id` 引用，不得自报 url/sha256） */
export interface DepEntry {
  id: string; url: string; /** 64 位小写 hex；实现期真实下载后固化 */ sha256: string;
  version: string; size: number; files: string[];
}
export const DEP_ALLOWLIST: Record<string, DepEntry> = {
  // ★ 以下 sha256/url/size 已于 2026-10-16 **真实下载后固化**（走加速池；取证见 MEMORY §C72「M1 收尾」）。
  'anime4k-shaders': {
    id: 'anime4k-shaders',
    url: 'https://github.com/bloc97/Anime4K/releases/download/v4.0.1/Anime4K_v4.0.zip',
    sha256: '139cd282086457c5adc79caf7b75b8b825091d71c9b54958c18745fea62d7ed7',
    version: '4.0.1',
    size: 776303,
    files: [
      'Anime4K_Clamp_Highlights.glsl', 'Anime4K_Restore_CNN_M.glsl', 'Anime4K_Restore_CNN_S.glsl',
      'Anime4K_Restore_CNN_VL.glsl', 'Anime4K_Upscale_CNN_x2_M.glsl', 'Anime4K_Upscale_CNN_x2_S.glsl',
      'Anime4K_Upscale_CNN_x2_VL.glsl', 'Anime4K_AutoDownscalePre_x2.glsl', 'Anime4K_AutoDownscalePre_x4.glsl',
    ],
  },
  'ravu-lite-shaders': {
    // ★ 上游 master 无 tag（用 raw 路径；靠 sha256 兜住漂移——不符即失败，不静默降级）
    id: 'ravu-lite-shaders',
    url: 'https://raw.githubusercontent.com/bjin/mpv-prescalers/master/ravu-lite-r4.hook',
    sha256: '46905b8a09a41867b351431ae1cb828e371ae1b64c4abe247e3f4acdc22c9704',
    version: 'master',
    size: 239986,
    files: ['ravu-lite-r4.hook'],
  },
  'fsrcnnx-shaders': {
    id: 'fsrcnnx-shaders',
    url: 'https://github.com/igv/FSRCNN-TensorFlow/releases/download/1.1/FSRCNNX_x2_8-0-4-1.glsl',
    sha256: 'e800dbc5c1c95185cc82216c597724533ff5f2880179f256eef600f03e8dc2ae',
    version: '1.1',
    size: 71296,
    files: ['FSRCNNX_x2_8-0-4-1.glsl'],
  },
};

export interface PluginMode { id: string; label: string; hint?: string; shaders: string[] }
export interface Contribute { type: string; modes?: PluginMode[]; [k: string]: unknown }
export interface RuntimeDepRef { id: string; files?: string[] }

export interface PluginManifest {
  manifestVersion: number;
  id: string; name: string; version: string; apiVersion: string;
  kind: PluginKind;
  /** `kind:"code"` 必填：沙箱入口文件相对名 */
  main?: string;
  author?: string; license?: string; homepage?: string; description?: string;
  permissions: string[];
  permissionNotes?: Record<string, string>;
  contributes: Contribute[];
  runtimeDeps?: RuntimeDepRef[];
  updateCheckUrl?: string;
}

/** apiVersion 主版本号（`1.x` → `1`） */
function major(v: string): string {
  return String(v || '').trim().split('.')[0];
}

type ContributionContentRule = { appliesTo: 'asset' | 'all'; validate: (contribution: unknown) => ValidateResult };

/** 每种贡献只注册一次校验策略；清单遍历负责白名单/能力分级，策略负责各自结构。 */
const CONTRIBUTION_CONTENT_RULES: Record<string, ContributionContentRule> = {
  theme: { appliesTo: 'asset', validate: validateThemeContribute },
  'subtitle.provider': { appliesTo: 'asset', validate: validateSubtitleProviderContribute },
  'meta.provider': { appliesTo: 'asset', validate: validateMetaProviderContribute },
  'discover.source': { appliesTo: 'asset', validate: validateDiscoverSourceContribute },
  'danmaku.source': { appliesTo: 'asset', validate: validateDanmakuSourceContribute },
  'live.template': { appliesTo: 'asset', validate: validateLiveTemplateContribute },
  'ui.command': { appliesTo: 'asset', validate: validateUiCommandContribute },
  keymap: { appliesTo: 'asset', validate: validateKeymapContribute },
  'settings.panel': { appliesTo: 'all', validate: validateSettingsPanelContribute },
  'ui.slot': { appliesTo: 'asset', validate: validateUiSlotContribute },
  'player.engine': { appliesTo: 'all', validate: validatePlayerEngineContribute },
  'spider.runtime': { appliesTo: 'all', validate: validateSpiderRuntimeContribute },
};

function validateContributionContent(contribution: Contribute, kind: PluginKind): ValidateResult | undefined {
  const rule = CONTRIBUTION_CONTENT_RULES[contribution.type];
  if (!rule || (rule.appliesTo === 'asset' && kind !== 'asset')) return undefined;
  return rule.validate(contribution);
}

/**
 * 校验插件清单（**纯函数**，逐条对应规范 §4.1）。
 * 只做**清单级**约束；文件是否真实存在于 `.winbox` 包内 → 安装期再校验。
 */
export function validatePluginManifest(m: unknown): ValidateResult {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, reasonCode: 'MISSING_MANIFEST', reason: '缺少 plugin.json' };
  const p = m as Partial<PluginManifest>;
  if (p.manifestVersion !== MANIFEST_VERSION) return { ok: false, reasonCode: 'MISSING_MANIFEST', reason: `manifestVersion 须为 ${MANIFEST_VERSION}` };
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return { ok: false, reasonCode: 'ID_INVALID', reason: 'id 须匹配 [a-z0-9-]{3,40} 且不以 - 起止' };
  if (typeof p.apiVersion !== 'string' || major(p.apiVersion) !== major(HOST_API_VERSION)) {
    return { ok: false, reasonCode: 'API_VERSION_MISMATCH', reason: `apiVersion 主版本须与宿主 ${HOST_API_VERSION} 一致` };
  }
  if (p.kind !== 'asset' && p.kind !== 'code') return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'kind 须为 asset 或 code' };

  const perms = Array.isArray(p.permissions) ? p.permissions : null;
  if (!perms) return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'permissions 必须是数组' };
  if (p.kind === 'asset') {
    if (perms.length) return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'kind=asset 的 permissions 必须为空' };
    if (p.main != null && p.main !== '') return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'kind=asset 不得有 main' };
  } else {
    if (!perms.length) return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'kind=code 必须声明 permissions' };
    if (!isSafeRelPath(p.main)) return { ok: false, reasonCode: 'PATH_ESCAPE', reason: 'kind=code 必须有安全的 main（沙箱入口）' };
  }
  for (const perm of perms) {
    if (!(PERMISSIONS as readonly string[]).includes(perm)) return { ok: false, reasonCode: 'UNKNOWN_PERMISSION', reason: `未在白名单的权限：${perm}` };
  }
  // ★ 2026-10-18（R10）：`permissionNotes`（可选）—— 若写则**键必须 ⊆ 已声明权限**、值 1~200 字且不含换行。
  //   缺说明**不拒装**（安装确认弹窗用 PERMISSION_LABELS 兜底）。
  if (p.permissionNotes != null) {
    const notes = p.permissionNotes;
    if (typeof notes !== 'object' || Array.isArray(notes)) {
      return { ok: false, reasonCode: 'BAD_PERMISSION_NOTES', reason: 'permissionNotes 必须是对象' };
    }
    for (const [k, v] of Object.entries(notes as Record<string, unknown>)) {
      if (!perms.includes(k)) {
        return { ok: false, reasonCode: 'BAD_PERMISSION_NOTES', reason: `permissionNotes 含未声明的权限：${k}` };
      }
      if (typeof v !== 'string' || !v.trim() || v.length > 200 || /[\r\n]/.test(v)) {
        return { ok: false, reasonCode: 'BAD_PERMISSION_NOTES', reason: `permissionNotes.${k} 须是 1~200 字且不含换行的字符串` };
      }
    }
  }

  const contributes = Array.isArray(p.contributes) ? p.contributes : null;
  if (!contributes) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: 'contributes 必须是数组' };
  const spiderRuntimeIds = new Set<string>();
  for (const c of contributes) {
    if (!c || typeof c !== 'object') return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: 'contributes 项非法' };
    const def = CONTRIBUTES[c.type];
    if (!def) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: `未在白名单的 contributes：${c.type}` };
    if (!def.kinds.includes(p.kind)) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE_KIND', reason: `${c.type} 不支持 kind=${p.kind}` };
    const contentResult = validateContributionContent(c, p.kind);
    if (contentResult && !contentResult.ok) return contentResult;
    if (c.type === 'spider.runtime' && !perms.includes('spider.runtime')) {
      return { ok: false, reasonCode: 'KIND_PERM_MISMATCH', reason: 'spider.runtime 需要显式声明 spider.runtime 权限并由用户确认' };
    }
    if (c.type === 'spider.runtime') {
      const id = (c as Record<string, unknown>).id;
      if (typeof id === 'string' && spiderRuntimeIds.has(id)) {
        return { ok: false, reasonCode: 'SPIDER_RUNTIME_INVALID', reason: `spider.runtime id 重复：${id}` };
      }
      if (typeof id === 'string') spiderRuntimeIds.add(id);
    }
    for (const mode of c.modes ?? []) {
      for (const s of mode.shaders ?? []) {
        if (!isSafeRelPath(s)) return { ok: false, reasonCode: 'PATH_ESCAPE', reason: `shader 名称非法：${s}` };
      }
    }
  }

  for (const dep of p.runtimeDeps ?? []) {
    if (!dep || typeof dep.id !== 'string' || !DEP_ALLOWLIST[dep.id]) {
      return { ok: false, reasonCode: 'DEP_NOT_ALLOWED', reason: `运行库未收录于内置许可清单：${dep && dep.id}` };
    }
    for (const f of dep.files ?? []) {
      if (!isSafeRelPath(f)) return { ok: false, reasonCode: 'PATH_ESCAPE', reason: `运行库文件非法：${f}` };
    }
  }

  if (p.updateCheckUrl != null && p.updateCheckUrl !== '' && (typeof p.updateCheckUrl !== 'string' || !p.updateCheckUrl.startsWith('https://'))) {
    return { ok: false, reasonCode: 'BAD_UPDATE_URL', reason: 'updateCheckUrl 必须是 https://' };
  }
  return { ok: true };
}

/** 插件整体级别（取 contributes 里最高的 level） */
export function pluginLevelOf(m: Pick<PluginManifest, 'kind' | 'contributes'>): PluginLevel {
  const order: PluginLevel[] = ['L1', 'L2', 'L3', 'L4'];
  if (m.kind === 'code') return 'L4';
  let max: PluginLevel = 'L1';
  for (const c of m.contributes ?? []) {
    const lv = CONTRIBUTES[c?.type]?.level ?? 'L1';
    if (order.indexOf(lv) > order.indexOf(max)) max = lv;
  }
  return max;
}

/** 取某 contributes 的某档位着色器名列表（保持顺序 = 生效顺序） */
export function shadersForMode(contributes: Contribute[] | undefined, type: string, modeId: string): string[] {
  const c = (contributes ?? []).find((x) => x.type === type);
  const mode = (c?.modes ?? []).find((x) => x.id === modeId);
  return mode?.shaders ?? [];
}

/** 全部档位（用于 UI 渲染 `off / <label>`） */
export function shaderModes(contributes: Contribute[] | undefined, type: string): PluginMode[] {
  return (contributes ?? []).find((x) => x.type === type)?.modes ?? [];
}
