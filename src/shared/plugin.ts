// src/shared/plugin.ts
// 插件契约（渲染层 / 主进程 / 校验器 / AI skill 共用；**零依赖、不含 electron**）。
// 事实源：docs/design/插件制作规范.md（字段与白名单）；本文件是它的**机器可读口径**。
//
// ★ 两个正交维度（别混）：
//   - `contributes` = 插件贡献了什么（L1~L4 都要写）；
//   - `permissions` = 砂箱代码能调用哪些宿主 API —— **只有 L4（kind:"code"）才有**；
//     L1~L3（kind:"asset"）`permissions` 必须为空。

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
  'ui.slot': { kinds: ['asset'], level: 'L3' },
  'ui.command': { kinds: ['asset', 'code'], level: 'L3' },
  'settings.panel': { kinds: ['asset'], level: 'L3' },
  keymap: { kinds: ['asset'], level: 'L3' },
};

/** permissions 白名单（**只属 L4 / kind=code**） */
export const PERMISSIONS: readonly string[] = [
  'net', 'net.download', 'kv', 'settings', 'fs.plugin', 'log',
  'notify', 'clipboard.read', 'clipboard.write', 'dialog', 'player.control', 'openExternal',
];

/** 禁用项（**永不提供**，声明即拒装） */
export const FORBIDDEN_PERMISSIONS: readonly string[] = [
  'main', 'spawn', 'child_process', 'eval', 'fs', 'cred', 'proxy', 'registry', 'raw.net',
];
/** 禁用的 contributes（红线） */
export const FORBIDDEN_CONTRIBUTES: readonly string[] = ['code.spider', 'main.hook', 'drive.provider'];

// ---------- ★ 皮肤令牌契约（`contributes.theme`）----------
// 唯一权威：`docs/design/皮肤与主题规范.md` §2（令牌词表）/ §3（layout）/ §5（校验）。
// ★ 内置 4 套皮肤与插件皮肤**共用本表**；v1 **不允许任何 CSS** —— 皮肤 = 令牌字典 + layout 声明。

export type ThemeTokenKind = 'color' | 'length' | 'time' | 'easing' | 'shadow';
export interface ThemeTokenSpec {
  kind: ThemeTokenKind;
  /** length → px 上下限；time → ms 上下限 */
  min?: number; max?: number;
  /** color → 必须含 alpha(<1)：玻璃层 / 淡底 / 弱边框 */
  requiresAlpha?: boolean;
}

const tColor = (requiresAlpha = false): ThemeTokenSpec => ({ kind: 'color', requiresAlpha });
const tLen = (min: number, max: number): ThemeTokenSpec => ({ kind: 'length', min, max });
const tTime = (min: number, max: number): ThemeTokenSpec => ({ kind: 'time', min, max });

/** 令牌白名单（未知令牌名 —— 含 `--nf-*` 一类自造前缀 —— 一律拒） */
export const THEME_TOKENS: Record<string, ThemeTokenSpec> = {
  // 表面与层级
  '--surface-0': tColor(), '--surface-1': tColor(), '--surface-2': tColor(), '--surface-3': tColor(),
  '--surface-glass': tColor(true),
  // 品牌与强调
  '--accent': tColor(), '--accent-strong': tColor(), '--accent-container': tColor(),
  '--accent-soft': tColor(true), '--on-accent': tColor(), '--accent-2': tColor(),
  // 文本
  '--text': tColor(), '--text-dim': tColor(), '--text-faint': tColor(),
  // 分隔与语义色
  '--border': tColor(), '--border-soft': tColor(true), '--hairline': tColor(true),
  '--danger': tColor(), '--warn': tColor(), '--success': tColor(), '--info': tColor(),
  // 形状与光影
  '--radius': tLen(0, 24), '--radius-sm': tLen(0, 16), '--radius-lg': tLen(0, 32),
  '--shadow': { kind: 'shadow' }, '--shadow-lg': { kind: 'shadow' },
  // 动效（曲线 + 时长）
  '--ease-standard': { kind: 'easing' }, '--ease-enter': { kind: 'easing' },
  '--ease-exit': { kind: 'easing' }, '--ease-spring': { kind: 'easing' },
  '--dur-instant': tTime(40, 200), '--dur-quick': tTime(40, 300), '--dur-state': tTime(80, 400),
  '--dur-panel': tTime(120, 600), '--dur-page': tTime(120, 800),
  // 字级
  '--fs-xs': tLen(9, 34), '--fs-sm': tLen(9, 34), '--fs-md': tLen(9, 34),
  '--fs-lg': tLen(9, 34), '--fs-xl': tLen(9, 34), '--fs-2xl': tLen(9, 34),
};

export type ThemeNav = 'side' | 'top';
export type ThemeDensity = 'compact' | 'comfy';
export type ThemeMotion = 'full' | 'reduced';
export type ThemeRadiusScale = 0.5 | 1 | 1.5;
/** 外壳：单行顶栏 / 双行头 / 玻璃侧边栏 / 胶囊导航+浮动圆钮 */
export type ThemeShell = 'topbar' | 'dualbar' | 'sidebar' | 'pillbar';
/** 详情页排版（取代按皮肤 id 分支）：影院大图 / 玻璃信息卡 / 左海报右信息（缺省 = 基础排版） */
export type ThemeDetailStyle = 'cinema' | 'glass' | 'poster';
/** 发现页排版：内容行 / 宽卡内容行 / 海报墙（缺省 = 基础行） */
export type ThemeDiscoverStyle = 'shelf' | 'shelfWide' | 'wall';
/** 筛选条：朴素 / 卡片容器（缺省 = plain） */
export type ThemeFilterStyle = 'plain' | 'card';

/** 布局声明（取代组件里的 `isNetflix()` 一类皮肤 id 分支） */
export interface ThemeLayout {
  shell?: ThemeShell;
  nav?: ThemeNav;
  density?: ThemeDensity;
  radiusScale?: ThemeRadiusScale;
  /** px，40–72（顶栏高） */
  navHeight?: number;
  /** px，160–280（侧栏宽） */
  sideWidth?: number;
  /** px，120–260（卡片宽） */
  cardWidth?: number;
  motion?: ThemeMotion;
  detailStyle?: ThemeDetailStyle;
  discoverStyle?: ThemeDiscoverStyle;
  filterStyle?: ThemeFilterStyle;
}

/** `contributes` 里 `type:"theme"` 的结构（见规范 §5.3） */
export interface ThemeContribute {
  type: 'theme';
  id: string;
  label: string;
  base: 'dark' | 'light';
  tokens: Record<string, string>;
  layout?: ThemeLayout;
}

/** CSS 注入护栏：任何令牌值都不得出现这些片段 */
const CSS_DANGER_RE = /[;{}<]|url\s*\(|expression\s*\(|@import|\/\*/i;
const VAR_REF_RE = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
const NUM = '-?\\d+(?:\\.\\d+)?';

/** 颜色的 alpha 通道（无 alpha 信息 → null；`var()` 引用 → undefined 表示「交由被引用令牌」） */
function colorAlpha(v: string): number | null | undefined {
  if (VAR_REF_RE.test(v)) return undefined;
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) return hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : 1;
  const fn = /^(rgba|hsla)\(\s*([^)]+)\)$/i.exec(v);
  if (fn) {
    const parts = fn[2].split(',').map((s) => s.trim());
    if (parts.length !== 4) return null;
    let a = Number(parts[3].replace('%', ''));
    if (!Number.isFinite(a)) return null;
    if (parts[3].includes('%') || a > 1) a /= 100;
    return a;
  }
  if (/^(rgb|hsl)\(\s*[^)]+\)$/i.test(v)) return 1;
  return null;
}

/** 单个令牌值校验（返回错误描述；undefined = 合法） */
function tokenValueError(v: unknown, spec: ThemeTokenSpec): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return '值必须是非空字符串';
  const s = v.trim();
  if (CSS_DANGER_RE.test(s)) return '值含非法片段（禁止 ; { } < url() @import 注释）';
  const ref = VAR_REF_RE.exec(s);
  if (ref) {
    return THEME_TOKENS[ref[1]] ? undefined : `引用了词表外的令牌：${ref[1]}`;
  }
  if (spec.kind === 'color') {
    const a = colorAlpha(s);
    if (a === null) return '颜色格式非法（支持 #rgb/#rrggbb/#rrggbbaa、rgb()/rgba()/hsl()/hsla()）';
    if (spec.requiresAlpha) {
      const alpha = a as number;
      if (alpha >= 1) return '该令牌必须含透明通道（alpha < 1）';
    }
    return undefined;
  }
  if (spec.kind === 'length') {
    const m = new RegExp(`^(?:0|(${NUM})px)$`).exec(s);
    if (!m) return '长度必须带 px（仅 0 可省略单位）';
    const n = m[1] == null ? 0 : Number(m[1]);
    if (spec.min != null && n < spec.min) return `低于下限 ${spec.min}px`;
    if (spec.max != null && n > spec.max) return `高于上限 ${spec.max}px`;
    return undefined;
  }
  if (spec.kind === 'time') {
    const m = new RegExp(`^(${NUM})(ms|s)$`).exec(s);
    if (!m) return '时长必须是 ms/s（如 240ms）';
    const n = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
    if (spec.min != null && n < spec.min) return `低于下限 ${spec.min}ms`;
    if (spec.max != null && n > spec.max) return `高于上限 ${spec.max}ms`;
    return undefined;
  }
  if (spec.kind === 'easing') {
    return new RegExp(`^cubic-bezier\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)$`).test(s)
      ? undefined : '缓动函数仅允许 cubic-bezier(a, b, c, d)';
  }
  // shadow：受限语法 —— 仅允许 [inset] + 2~4 个长度（`0` 或 `<n>px`）+ 可选颜色，逗号分层
  // ★ 分层必须**按括号深度**切分：`rgba(0,0,0,.35)` 里的逗号不是层分隔符
  const LEN = `(?:0|${NUM}px)`;
  const layers: string[] = [];
  {
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
    }
    layers.push(cur);
  }
  const parts = layers.map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return '阴影为空';
  for (const layer of parts) {
    const body = layer.replace(/^inset\s+/i, '');
    const head = new RegExp(`^(?:${LEN}\\s+){2,4}`);
    if (!head.test(body)) return '阴影每层须是 2~4 个长度（0 或 <n>px）开头，如 0 8px 24px rgba(0,0,0,.35)';
    const tail = body.replace(head, '').trim();
    if (tail && colorAlpha(tail) === null) return '阴影颜色格式非法';
  }
  return undefined;
}

/** 布局声明校验 */
function layoutError(L: unknown): string | undefined {
  if (L == null) return undefined;
  if (typeof L !== 'object' || Array.isArray(L)) return 'layout 必须是对象';
  const l = L as Record<string, unknown>;
  const enums: Record<string, readonly unknown[]> = {
    shell: ['topbar', 'dualbar', 'sidebar', 'pillbar'],
    nav: ['side', 'top'], density: ['compact', 'comfy'], motion: ['full', 'reduced'],
    radiusScale: [0.5, 1, 1.5],
    detailStyle: ['cinema', 'glass', 'poster'],
    discoverStyle: ['shelf', 'shelfWide', 'wall'],
    filterStyle: ['plain', 'card'],
  };
  const ranges: Record<string, [number, number]> = {
    navHeight: [40, 72], sideWidth: [160, 280], cardWidth: [120, 260],
  };
  for (const [k, v] of Object.entries(l)) {
    if (enums[k]) {
      if (!enums[k].includes(v)) return `${k} 取值非法（允许 ${enums[k].join(' | ')}）`;
      continue;
    }
    if (ranges[k]) {
      const [min, max] = ranges[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return `${k} 须是 ${min}–${max} 之间的数值`;
      continue;
    }
    return `layout 字段未知：${k}`;
  }
  return undefined;
}

/**
 * 校验 `contributes.theme`（纯函数）。
 * ★ v1：只允许「令牌字典 + layout 声明」，出现样式表字段即拒（THEME_STYLE_NOT_ALLOWED）。
 */
export function validateThemeContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim()) {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme.label 必填' };
  }
  if (t.base !== 'dark' && t.base !== 'light') {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme.base 须为 dark | light' };
  }
  if (t.style != null || t.css != null || t.stylesheet != null || t.styles != null) {
    return { ok: false, reasonCode: 'THEME_STYLE_NOT_ALLOWED', reason: 'v1 皮肤不允许样式表（只允许 tokens + layout）' };
  }
  const tokens = t.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme.tokens 必须是对象' };
  }
  const entries = Object.entries(tokens as Record<string, unknown>);
  if (!entries.length) {
    return { ok: false, reasonCode: 'THEME_TOKENS_REQUIRED', reason: 'theme.tokens 不得为空' };
  }
  for (const [k, v] of entries) {
    const spec = THEME_TOKENS[k];
    if (!spec) return { ok: false, reasonCode: 'UNKNOWN_THEME_TOKEN', reason: `未在词表的令牌：${k}` };
    const err = tokenValueError(v, spec);
    if (err) return { ok: false, reasonCode: 'BAD_THEME_TOKEN_VALUE', reason: `${k}：${err}` };
  }
  const lErr = layoutError(t.layout);
  if (lErr) return { ok: false, reasonCode: 'BAD_THEME_LAYOUT', reason: lErr };
  return { ok: true };
}

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

export type PluginReasonCode =
  | 'MISSING_MANIFEST' | 'ID_INVALID' | 'API_VERSION_MISMATCH' | 'KIND_PERM_MISMATCH'
  | 'UNKNOWN_CONTRIBUTE' | 'UNKNOWN_CONTRIBUTE_KIND' | 'UNKNOWN_PERMISSION'
  | 'PATH_ESCAPE' | 'DEP_NOT_ALLOWED' | 'BAD_UPDATE_URL'
  // 皮肤（`contributes.theme`）——沿用 `docs/design/皮肤与主题规范.md` §5 的原因码
  | 'THEME_TOKENS_REQUIRED' | 'UNKNOWN_THEME_TOKEN' | 'BAD_THEME_TOKEN_VALUE'
  | 'THEME_STYLE_NOT_ALLOWED' | 'BAD_THEME_LAYOUT';

export interface ValidateResult { ok: boolean; reasonCode?: PluginReasonCode; reason?: string }

/** id 规则：`[a-z0-9-]{3,40}`，且不以 `-` 开头/结尾 */
const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** 安全相对路径：非空、无盘符/前导分隔符、任一段不得是 `..` */
export function isSafeRelPath(p: unknown): boolean {
  if (typeof p !== 'string') return false;
  const s = p.trim().replace(/\\/g, '/');
  if (!s) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  if (s.startsWith('/')) return false;
  return !s.split('/').some((seg) => seg === '..');
}

/** apiVersion 主版本号（`1.x` → `1`） */
function major(v: string): string {
  return String(v || '').trim().split('.')[0];
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
    if (!PERMISSIONS.includes(perm)) return { ok: false, reasonCode: 'UNKNOWN_PERMISSION', reason: `未在白名单的权限：${perm}` };
  }

  const contributes = Array.isArray(p.contributes) ? p.contributes : null;
  if (!contributes) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: 'contributes 必须是数组' };
  for (const c of contributes) {
    if (!c || typeof c !== 'object') return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: 'contributes 项非法' };
    const def = CONTRIBUTES[c.type];
    if (!def) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE', reason: `未在白名单的 contributes：${c.type}` };
    if (!def.kinds.includes(p.kind)) return { ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE_KIND', reason: `${c.type} 不支持 kind=${p.kind}` };
    // ★ `theme` 的内容也要校验（词表外的令牌名 / 值类型 / 夹带样式表 —— 见 皮肤与主题规范 §5）
    if (c.type === 'theme') {
      const tr = validateThemeContribute(c);
      if (!tr.ok) return tr;
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

  if (p.updateCheckUrl != null && p.updateCheckUrl !== '' && !p.updateCheckUrl.startsWith('https://')) {
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

/** 取插件的 `theme` 贡献项（未声明 → undefined） */
export function themeContributeOf(contributes: Contribute[] | undefined): ThemeContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'theme');
  return c ? (c as unknown as ThemeContribute) : undefined;
}

// ---------- ★ 渲染层/管理器可见的**视图模型**（主进程组装，preload 与 client 共用类型） ----------

/** 插件条目视图（管理器列表 / 播放器超分入口用） */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'user';
  level: PluginLevel;
  /** 是否启用（停用保留磁盘，只不参与宿主装配） */
  enabled: boolean;
  /** 载荷是否已就位（可访问的目录） */
  ready: boolean;
  /** 可用档位（仅 `mpv.shaders` 插件非空） */
  modes: Array<{ id: string; label: string }>;
}

/** 插件皮肤视图（主进程组装 → 渲染层皮肤注册表消费） */
export interface ThemeSkinView {
  /** 生效值：**直接作为 `data-theme` 使用**（形如 `plugin:<skinId>`） */
  id: string;
  /** 来源插件 id */
  pluginId: string;
  label: string;
  base: 'dark' | 'light';
  tokens: Record<string, string>;
  layout: ThemeLayout;
}

/** 超分状态（播放器按钮据此显示与高亮） */
export interface SrState {
  /** 是否有可用超分插件（未装/未就位 → false，按钮不显示） */
  available: boolean;
  modes: Array<{ id: string; label: string }>;
  /** 实际生效档位（未就绪一律 `off`；见 shared/player.srModeUsable） */
  mode: string;
}
