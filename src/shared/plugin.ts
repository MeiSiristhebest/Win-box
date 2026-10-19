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
  'notify', 'clipboard.read', 'clipboard.write', 'dialog', 'player.control', 'openExternal',
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

// ---------- ★ 字幕源契约（`contributes.subtitle.provider`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5（L2 声明式 provider）。
// ★ L2 = **纯声明式**：宿主按插件的「受限 URL 模板 + JSON 路径映射」**代发请求并取数**，
//   **不执行插件的代码** → `kind:"asset"` 且 `permissions` 恒空。
// ★ v1 仅 GET（无 POST / 无鉴权）：需要 POST / 需要 token / 需要自己算 → 用 `kind:"code"`（L4）。

/** 受限请求描述（地址模板 + 额外请求头） */
export interface SubHttpSpec {
  /** 含白名单占位符（如 `{keyword}`）的地址模板；只允许 http/https */
  url: string;
  /** 额外请求头（键值皆禁 CRLF 注入；禁用 Host/Content-Length 等走私头） */
  headers?: Record<string, string>;
}

/** `contributes` 里 `type:"subtitle.provider"` 的结构（L2 声明式字幕源） */
export interface SubtitleProviderContribute {
  type: 'subtitle.provider';
  /** 稳定 id（写入候选的 `provider` 字段；不得占用内置源 / 别插件已用的 id） */
  id: string;
  name: string;
  search: SubHttpSpec & {
    /** 响应里**数组**所在的点号路径（如 `data.list`；空串不可） */
    list: string;
    /** 候选项字段映射：源 JSON 字段 → 候选字段 */
    map: { file: string; subname: string; title?: string; lang?: string; format?: string; detail?: string };
  };
  /** 下载：`url` 必须含 `{file}`（据候选的 `file` 定位具体字幕） */
  fetch: SubHttpSpec;
}

/** 内置字幕源 id（插件不得占用；避免候选中 provider 字段歧义） */
export const RESERVED_SUBTITLE_IDS: readonly string[] = ['assrt', 'subtitlecat'];

/** 模板占位符白名单：search / fetch 各自可用的变量 */
export const SUB_PLACEHOLDERS_SEARCH: readonly string[] = ['keyword', 'keywords', 'title', 'ep'];
export const SUB_PLACEHOLDERS_FETCH: readonly string[] = ['file', 'subname', 'title', 'ep'];
/** 候选项映射字段白名单 */
export const SUB_MAP_FIELDS: readonly string[] = ['file', 'subname', 'title', 'lang', 'format', 'detail'];

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;
const HEADER_KEY_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
/** 请求头禁用键（防越权 / 防请求走私） */
const FORBIDDEN_HEADER_KEYS: readonly string[] = ['host', 'content-length', 'connection', 'transfer-encoding'];
/** 受限 JSON 路径语法：`name` / `name[0]` 逐段 */
const PATH_SEG_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[\d{1,3}\])?$/;

/** 模板里的占位符名（去重，保持出现顺序） */
export function placeholdersOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** 受限 JSON 路径语法检查 */
export function isProviderPath(p: unknown): boolean {
  if (typeof p !== 'string') return false;
  const s = p.trim();
  return !!s && s.split('.').every((seg) => PATH_SEG_RE.test(seg));
}

function urlError(u: unknown, ph: readonly string[]): string | undefined {
  if (typeof u !== 'string' || !u.trim()) return 'url 必填';
  const s = u.trim();
  if (!/^https?:\/\//i.test(s)) return 'url 只允许 http:// 或 https://';
  if (/[\s\r\n]/.test(s.replace(PLACEHOLDER_RE, ''))) return 'url 不得含空白或换行';
  for (const name of placeholdersOf(s)) {
    if (!ph.includes(name)) return `url 含未知占位符 {${name}}（本处允许 ${ph.join(' / ')}）`;
  }
  return undefined;
}

function headersError(h: unknown, ph: readonly string[]): string | undefined {
  if (h == null) return undefined;
  if (typeof h !== 'object' || Array.isArray(h)) return 'headers 必须是对象';
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (!HEADER_KEY_RE.test(k)) return `请求头键非法：${k}`;
    if (FORBIDDEN_HEADER_KEYS.includes(k.toLowerCase())) return `请求头被禁用：${k}`;
    if (typeof v !== 'string' || /[\r\n]/.test(v)) return `请求头值非法：${k}`;
    for (const name of placeholdersOf(v)) if (!ph.includes(name)) return `请求头 ${k} 含未知占位符 {${name}}`;
  }
  return undefined;
}

/**
 * 校验 `contributes.subtitle.provider`（纯函数）。
 * ★ 只做**声明式**约束：URL 协议 / 占位符白名单 / JSON 路径语法 / 字段白名单。
 */
export function validateSubtitleProviderContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (RESERVED_SUBTITLE_IDS.includes(t.id)) {
    return { ok: false, reasonCode: 'SUBTITLE_ID_TAKEN', reason: `该字幕源 id 为内置源保留：${t.id}` };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'subtitle.provider.name 必填' };
  }
  const search = t.search as Record<string, unknown> | undefined;
  if (!search || typeof search !== 'object' || Array.isArray(search)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'search 必填（对象）' };
  }
  const su = urlError(search.url, SUB_PLACEHOLDERS_SEARCH);
  if (su) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.url：${su}` };
  const sh = headersError(search.headers, SUB_PLACEHOLDERS_SEARCH);
  if (sh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.headers：${sh}` };
  if (!isProviderPath(search.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.list 须是点号路径（如 data.list）' };
  }
  const map = search.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'search.map 必填（对象）' };
  }
  for (const k of Object.keys(map)) {
    if (!SUB_MAP_FIELDS.includes(k)) return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: `search.map 字段未知：${k}` };
  }
  for (const k of ['file', 'subname']) {
    if (!isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 必填且须是点号路径` };
  }
  for (const k of ['title', 'lang', 'format', 'detail']) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 须是点号路径` };
  }
  const fetch = t.fetch as Record<string, unknown> | undefined;
  if (!fetch || typeof fetch !== 'object' || Array.isArray(fetch)) {
    return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: 'fetch 必填（对象）' };
  }
  for (const k of Object.keys(fetch)) {
    if (k !== 'url' && k !== 'headers') return { ok: false, reasonCode: 'SUBTITLE_PROVIDER_INVALID', reason: `fetch 字段未知：${k}` };
  }
  const fu = urlError(fetch.url, SUB_PLACEHOLDERS_FETCH);
  if (fu) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `fetch.url：${fu}` };
  if (!placeholdersOf(String(fetch.url)).includes('file')) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: 'fetch.url 必须含占位符 {file}' };
  }
  const fh = headersError(fetch.headers, SUB_PLACEHOLDERS_FETCH);
  if (fh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `fetch.headers：${fh}` };
  return { ok: true };
}

/** 模板展开（值经 `encodeURIComponent`；未知占位符原样保留，仅供容错） */
export function expandSubTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? encodeURIComponent(vars[name] ?? '') : raw,
  );
}

/** 受限 JSON 路径取值（任一段缺失 → undefined） */
export function jsonPathGet(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\[(\d{1,3})\])?$/.exec(seg);
    if (!m) return undefined;
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2] != null) cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
  }
  return cur;
}

// ---------- ★ 元数据源契约（`contributes.meta.provider`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.5。与字幕源同为 **L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 命中口径 = 宿主现有 `MetaHit`：标题 / 年份 / 海报 / 简介 / 类型（+ 可选横图）。
//   v1 **不含评分**（宿主 UI 尚未展示评分）→ 声明 `rating` 字段会被拒。

/** `contributes` 里 `type:"meta.provider"` 的结构（L2 声明式元数据源） */
export interface MetaProviderContribute {
  type: 'meta.provider';
  /** 稳定 id；不得占用内置来源 `tmdb` / `douban` */
  id: string;
  name: string;
  search: SubHttpSpec & {
    /** 命中项的路径：**数组**（取第一项）或**单个对象**；空/非法 → 拒装 */
    list: string;
    /** 字段映射：源 JSON → 元数据命中（`title` 必填） */
    map: {
      title: string;
      year?: string;
      poster?: string;
      backdrop?: string;
      overview?: string;
      mediaType?: string;
    };
  };
  /** 海报 / 横图取到**相对路径**时的前缀（如 `https://img.cdn/t/p/w342`）；绝对 URL 不受影响 */
  imageBase?: string;
}

/** 内置元数据源 id（插件不得占用） */
export const RESERVED_META_IDS: readonly string[] = ['tmdb', 'douban'];

/** 元数据源模板占位符白名单 */
export const META_PLACEHOLDERS: readonly string[] = ['keyword', 'title', 'year'];
/** 元数据字段映射白名单（`rating` 等一律拒：宿主 UI 不展示 → 不提供假能力） */
export const META_MAP_FIELDS: readonly string[] = ['title', 'year', 'poster', 'backdrop', 'overview', 'mediaType'];

/**
 * 校验 `contributes.meta.provider`（纯函数）。
 * ★ 只做**声明式**约束；v1 与字幕源同边界（仅 GET / 仅 JSON / 无鉴权）。
 */
export function validateMetaProviderContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (RESERVED_META_IDS.includes(t.id)) {
    return { ok: false, reasonCode: 'META_ID_TAKEN', reason: `该元数据源 id 为内置来源保留：${t.id}` };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'meta.provider.name 必填' };
  }
  const search = t.search as Record<string, unknown> | undefined;
  if (!search || typeof search !== 'object' || Array.isArray(search)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'search 必填（对象）' };
  }
  const su = urlError(search.url, META_PLACEHOLDERS);
  if (su) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.url：${su}` };
  const sh = headersError(search.headers, META_PLACEHOLDERS);
  if (sh) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `search.headers：${sh}` };
  if (!isProviderPath(search.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.list 须是点号路径（如 data.results）' };
  }
  const map = search.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: 'search.map 必填（对象）' };
  }
  for (const k of Object.keys(map)) {
    if (!META_MAP_FIELDS.includes(k)) return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: `search.map 字段未知：${k}（v1 不提供评分等字段）` };
  }
  if (!isProviderPath(map.title)) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: 'search.map.title 必填且须是点号路径' };
  for (const k of META_MAP_FIELDS.filter((x) => x !== 'title')) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `search.map.${k} 须是点号路径` };
  }
  if (t.imageBase != null) {
    const ib = urlError(t.imageBase, []);
    if (ib) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `imageBase：${ib}` };
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'search', 'imageBase'].includes(k)) {
      return { ok: false, reasonCode: 'META_PROVIDER_INVALID', reason: `meta.provider 字段未知：${k}` };
    }
  }
  return { ok: true };
}

// ---------- ★ 发现页数据源契约（`contributes.discover.source`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.6。与前两者同为 **L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 定位 = **增补**：宿主把插件分区**追加**到发现页现有榜单之后（内置分区先占 id；同 id 的插件分区被忽略）。
// ★ v1 的 `map` **不含 `doubanId`** —— 该字段会让宿主去取「豆瓣剧照」，插件源并非豆瓣，映射过来会错配图源。

/** 发现页的一个**分区**（榜单分组）声明 */
export interface DiscoverSectionContribute {
  /** [a-z0-9-]{3,40}；同一插件内不得重复；与宿主内置分区同 id 时该分区被忽略 */
  id: string;
  /** 分区标题（发现页上那一行的标题） */
  title: string;
  /** 本分区的影片类型：决定 `{mediaType}` 占位符展开值，也是条目未映射 mediaType 时的缺省 */
  mediaType?: 'movie' | 'tv';
  /** 地址模板（可用 `{mediaType}`） */
  url: string;
  /** 额外请求头（键值皆禁 CRLF；禁用走私头） */
  headers?: Record<string, string>;
  /** 响应里**数组**所在的点号路径 */
  list: string;
  /** 本分区的图片相对路径前缀（可选） */
  imageBase?: string;
  /** 条目字段映射（`title` 必填） */
  map: { title: string; year?: string; poster?: string; backdrop?: string; mediaType?: string; tmdbId?: string };
}

/** `contributes` 里 `type:"discover.source"` 的结构（L2 声明式发现页数据源） */
export interface DiscoverSourceContribute {
  type: 'discover.source';
  id: string;
  name: string;
  /** 该插件贡献的分区（≥1；顺序即发现页上的显示顺序） */
  sections: DiscoverSectionContribute[];
}

/** 发现页模板占位符白名单 */
export const DISCOVER_PLACEHOLDERS: readonly string[] = ['mediaType'];
/** 发现页条目字段白名单（不含 `doubanId`：见本节说明） */
export const DISCOVER_MAP_FIELDS: readonly string[] = ['title', 'year', 'poster', 'backdrop', 'mediaType', 'tmdbId'];

/** 校验 `contributes.discover.source`（纯函数） */
export function validateDiscoverSourceContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'discover.source.name 必填' };
  }
  if (!Array.isArray(t.sections) || !t.sections.length) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'sections 必须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of t.sections) {
    const r = sectionError(s, seen);
    if (!r.ok) return r;
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'sections'].includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `discover.source 字段未知：${k}` };
    }
  }
  return { ok: true };
}

/** 单个分区声明校验（`seen` 用于同一插件内的 section id 去重） */
function sectionError(s: unknown, seen: Set<string>): ValidateResult {
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'sections 项非法' };
  }
  const sec = s as Record<string, unknown>;
  if (typeof sec.id !== 'string' || !ID_RE.test(sec.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: 'section.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (seen.has(sec.id)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section.id 在同一插件内重复：${sec.id}` };
  }
  seen.add(sec.id);
  if (typeof sec.title !== 'string' || !sec.title.trim()) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).title 必填` };
  }
  if (sec.mediaType != null && sec.mediaType !== 'movie' && sec.mediaType !== 'tv') {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).mediaType 须为 movie | tv` };
  }
  const u = urlError(sec.url, DISCOVER_PLACEHOLDERS);
  if (u) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).url：${u}` };
  const h = headersError(sec.headers, DISCOVER_PLACEHOLDERS);
  if (h) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).headers：${h}` };
  if (sec.imageBase != null) {
    const ib = urlError(sec.imageBase, []);
    if (ib) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `section(${sec.id}).imageBase：${ib}` };
  }
  if (!isProviderPath(sec.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).list 须是点号路径` };
  }
  const map = sec.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).map 必填（对象）` };
  }
  for (const k of Object.keys(map)) {
    if (!DISCOVER_MAP_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section(${sec.id}).map 字段未知：${k}（v1 不含 doubanId）` };
    }
  }
  if (!isProviderPath(map.title)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).map.title 必填且须是点号路径` };
  }
  for (const k of DISCOVER_MAP_FIELDS.filter((x) => x !== 'title')) {
    if (map[k] != null && !isProviderPath(map[k])) {
      return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `section(${sec.id}).map.${k} 须是点号路径` };
    }
  }
  for (const k of Object.keys(sec)) {
    if (!['id', 'title', 'mediaType', 'url', 'headers', 'list', 'imageBase', 'map'].includes(k)) {
      return { ok: false, reasonCode: 'DISCOVER_PROVIDER_INVALID', reason: `section 字段未知：${k}` };
    }
  }
  return { ok: true };
}

// ---------- ★ 弹幕源契约（`contributes.danmaku.source`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.7。**L2 声明式**（宿主代发请求，插件不跑代码）。
// ★ 弹幕是**三步链路**（宿主既有做法，见 main/danmaku/logvarProvider.ts）：
//   ① 搜索番剧（关键词）→ ② 取该番剧的剧集列表 → ③ 按剧集 id 拉**弹幕 XML**（B 站格式）。
//   三步各一段受限模板；弹幕数据由宿主的引擎解析器消费（插件不产出解析结果）。
// ★ v1 的弹幕数据**只收 XML 文本**（B 站格式）。源若只给 JSON 弹幕 → 用 `kind:"code"`（L4）。

/** 弹幕「搜索番剧」段 */
export interface DanmakuSearchSpec extends SubHttpSpec {
  /** 响应里**数组**所在的点号路径 */
  list: string;
  /** 番剧字段映射（`animeId` / `title` 必填；`bangumiId` 缺省用 `animeId`） */
  map: { animeId: string; title: string; bangumiId?: string; episodeCount?: string; kind?: string };
}

/** 弹幕「取剧集列表」段 */
export interface DanmakuEpisodesSpec extends SubHttpSpec {
  list: string;
  /** 剧集字段映射（`episodeId` 必填） */
  map: { episodeId: string; episodeTitle?: string; episodeNumber?: string };
}

/** `contributes` 里 `type:"danmaku.source"` 的结构（L2 声明式弹幕源） */
export interface DanmakuSourceContribute {
  type: 'danmaku.source';
  /** 稳定 id（宿主合成 source 键 `plugin:<contributeId>`，供候选/剧集/弹幕三步间路由） */
  id: string;
  name: string;
  search: DanmakuSearchSpec;
  episodes: DanmakuEpisodesSpec;
  /** 拉弹幕：`url` 必须含 `{episodeId}`，响应须是**XML 文本** */
  comments: SubHttpSpec;
}

/** 三段各自的模板占位符白名单 */
export const DANMAKU_SEARCH_PLACEHOLDERS: readonly string[] = ['keyword', 'season'];
export const DANMAKU_EPISODES_PLACEHOLDERS: readonly string[] = ['animeId', 'title'];
export const DANMAKU_COMMENTS_PLACEHOLDERS: readonly string[] = ['episodeId'];
/** 两段字段映射白名单 */
export const DANMAKU_ANIME_MAP_FIELDS: readonly string[] = ['animeId', 'title', 'bangumiId', 'episodeCount', 'kind'];
export const DANMAKU_EPISODE_MAP_FIELDS: readonly string[] = ['episodeId', 'episodeTitle', 'episodeNumber'];

/** 校验 `contributes.danmaku.source`（纯函数） */
export function validateDanmakuSourceContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: 'danmaku.source.name 必填' };
  }
  for (const k of Object.keys(t)) {
    if (!['type', 'id', 'name', 'search', 'episodes', 'comments'].includes(k)) {
      return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `danmaku.source 字段未知：${k}` };
    }
  }
  const r = danmakuStepError(t, 'search');
  if (r) return r;
  const r2 = danmakuStepError(t, 'episodes');
  if (r2) return r2;
  const r3 = danmakuStepError(t, 'comments');
  if (r3) return r3;
  return { ok: true };
}

/** 校验弹幕三步里的某一段（返回 error；undefined = 该段合法） */
function danmakuStepError(t: Record<string, unknown>, step: 'search' | 'episodes' | 'comments'): ValidateResult | undefined {
  const spec = t[step] as Record<string, unknown> | undefined;
  const label = `danmaku.source.${step}`;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 必填（对象）` };
  }
  const placeholders =
    step === 'search' ? DANMAKU_SEARCH_PLACEHOLDERS : step === 'episodes' ? DANMAKU_EPISODES_PLACEHOLDERS : DANMAKU_COMMENTS_PLACEHOLDERS;
  const u = urlError(spec.url, placeholders);
  if (u) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.url：${u}` };
  const h = headersError(spec.headers, placeholders);
  if (h) return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.headers：${h}` };
  if (step === 'comments') {
    if (!placeholdersOf(String(spec.url)).includes('episodeId')) {
      return { ok: false, reasonCode: 'BAD_PROVIDER_URL', reason: `${label}.url 必须含占位符 {episodeId}` };
    }
    for (const k of Object.keys(spec)) {
      if (k !== 'url' && k !== 'headers') return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 字段未知：${k}` };
    }
    return undefined;
  }
  if (!isProviderPath(spec.list)) {
    return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.list 须是点号路径` };
  }
  const map = spec.map as Record<string, unknown> | undefined;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label}.map 必填（对象）` };
  }
  const fields = step === 'search' ? DANMAKU_ANIME_MAP_FIELDS : DANMAKU_EPISODE_MAP_FIELDS;
  const required = step === 'search' ? ['animeId', 'title'] : ['episodeId'];
  for (const k of Object.keys(map)) {
    if (!fields.includes(k)) return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label}.map 字段未知：${k}` };
  }
  for (const k of required) {
    if (!isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.map.${k} 必填且须是点号路径` };
  }
  for (const k of fields.filter((x) => !required.includes(x))) {
    if (map[k] != null && !isProviderPath(map[k])) return { ok: false, reasonCode: 'BAD_PROVIDER_PATH', reason: `${label}.map.${k} 须是点号路径` };
  }
  for (const k of Object.keys(spec)) {
    if (!['url', 'headers', 'list', 'map'].includes(k)) {
      return { ok: false, reasonCode: 'DANMAKU_PROVIDER_INVALID', reason: `${label} 字段未知：${k}` };
    }
  }
  return undefined;
}

// ---------- ★ 直播输出模板契约（`contributes.live.template`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.8。**L2 声明式**，但与前四者**形态不同**：
//   ★ 本类型**不发网络请求、不取数** —— 它把宿主**已解析**的直播频道（`LiveGroup[]`）**格式化输出**成文本
//     （TXT / M3U），供外部播放器 / 其它设备使用。插件只给「每行格式串」，宿主负责取数与写盘。
//   ★ 绝**不解析**任何直播订阅格式（红线③：不触碰 TxtSubscribe / LiveConfigParser —— 那是引擎解析行为）。
//   ★ 同理 `kind:"asset"`、`permissions` 恒空、不得有 `main`。

/** 输出行模板（仅格式化宿主**已解析**的直播频道；不取数、不解析、不发请求） */
export interface LiveTemplateContribute {
  type: 'live.template';
  /** 稳定 id（导出面板里的模板键；同插件内唯一） */
  id: string;
  /** 显示名（导出面板里的选项名） */
  label: string;
  /** 输出类型：决定语义与**默认扩展名**（txt = TVBox 惯用文本；m3u = 播放列表） */
  format: 'txt' | 'm3u';
  /** 分组行模板（可选）。txt 惯用 `{group},#genre#`；**不得含 `{url}`**、须是单行 */
  group?: string;
  /** 文件头（可选，**逐行**；m3u 惯用 `["#EXTM3U"]`）；每项须是单行 */
  header?: string[];
  /** 频道行模板（**必须含 `{url}`**；允许含 `\n` 表达多行，如 m3u 的 `#EXTINF…\n{url}`） */
  line: string;
  /** 扩展名（可选，不带点；`[a-z0-9]{1,8}`）；缺省 txt→`txt` / m3u→`m3u` */
  ext?: string;
}

/** 模板占位符白名单（分组行与频道行共用；渲染时由宿主从 LiveGroup 展开） */
export const LIVE_TEMPLATE_PLACEHOLDERS: readonly string[] = [
  'group', 'name', 'url', 'logo', 'tvgId', 'tvgName', 'tvgChno', 'index',
];
/** 输出类型白名单 */
export const LIVE_TEMPLATE_FORMATS: readonly string[] = ['txt', 'm3u'];

/** 各类型的默认扩展名 */
export function liveTemplateExt(format: 'txt' | 'm3u'): string {
  return format === 'm3u' ? 'm3u' : 'txt';
}

/** 导出文本的行连接符（Windows 友好，且既有 TxtSubscribe 解析兼容） */
export const LIVE_TEMPLATE_EOL = '\r\n';

const LIVE_TEMPLATE_FIELDS: readonly string[] = ['type', 'id', 'label', 'format', 'group', 'header', 'line', 'ext'];
const LIVE_EXT_RE = /^[a-z0-9]{1,8}$/;

/** 模板片段里的未知占位符检查（返回描述；undefined = 合法） */
function templatePlaceholderError(s: string, where: string): string | undefined {
  for (const name of placeholdersOf(s)) {
    if (!LIVE_TEMPLATE_PLACEHOLDERS.includes(name)) {
      return `${where} 含未知占位符 {${name}}（允许 ${LIVE_TEMPLATE_PLACEHOLDERS.join(' / ')}）`;
    }
  }
  return undefined;
}

/**
 * 行模板校验（换行 / 空行 / 占位符 / 必含项）。
 * ★ 原因码按**成因**分：占位符越界 → `LIVE_TEMPLATE_INVALID`；结构性（空/空行/换行/缺 `{url}`）→ `opts.lineCode`。
 * @param opts.allowNewline 是否允许 `\n`（频道行允许，分组行与文件头不允许）
 * @param opts.requireUrl 是否必须含 `{url}`（频道行必须）
 * @param opts.lineCode 结构性问题的原因码（频道行 = `BAD_LIVE_TEMPLATE_LINE`；分组行 / 文件头 = `LIVE_TEMPLATE_INVALID`）
 */
function templateTextIssue(
  s: unknown,
  where: string,
  opts: { allowNewline: boolean; requireUrl: boolean; lineCode: 'BAD_LIVE_TEMPLATE_LINE' | 'LIVE_TEMPLATE_INVALID' },
): ValidateResult | undefined {
  if (typeof s !== 'string' || !s.trim()) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 必填（非空字符串）` };
  const pe = templatePlaceholderError(s, where);
  if (pe) return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: pe };
  if (/\r/.test(s)) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含回车（\\r）` };
  if (!opts.allowNewline && /\n/.test(s)) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含换行` };
  if (s.split('\n').some((x) => !x.trim())) return { ok: false, reasonCode: opts.lineCode, reason: `${where} 不得含空行` };
  if (opts.requireUrl && !placeholdersOf(s).includes('url')) {
    return { ok: false, reasonCode: opts.lineCode, reason: `${where} 必须含占位符 {url}` };
  }
  return undefined;
}

/** 校验 `contributes.live.template`（纯函数） */
export function validateLiveTemplateContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim()) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.label 必填' };
  }
  if (t.format !== 'txt' && t.format !== 'm3u') {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.format 须为 txt | m3u' };
  }
  for (const k of Object.keys(t)) {
    if (!LIVE_TEMPLATE_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: `live.template 字段未知：${k}` };
    }
  }
  const le = templateTextIssue(t.line, 'live.template.line', { allowNewline: true, requireUrl: true, lineCode: 'BAD_LIVE_TEMPLATE_LINE' });
  if (le) return le;
  if (t.group != null) {
    const ge = templateTextIssue(t.group, 'live.template.group', { allowNewline: false, requireUrl: false, lineCode: 'LIVE_TEMPLATE_INVALID' });
    if (ge) return ge;
    if (placeholdersOf(String(t.group)).includes('url')) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.group 不得含占位符 {url}' };
    }
  }
  if (t.header != null) {
    if (!Array.isArray(t.header) || !t.header.length) {
      return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.header 须是非空数组' };
    }
    for (let i = 0; i < t.header.length; i++) {
      const he = templateTextIssue(t.header[i], `live.template.header[${i}]`, {
        allowNewline: false, requireUrl: false, lineCode: 'LIVE_TEMPLATE_INVALID',
      });
      if (he) return he;
    }
  }
  if (t.ext != null && (typeof t.ext !== 'string' || !LIVE_EXT_RE.test(t.ext))) {
    return { ok: false, reasonCode: 'LIVE_TEMPLATE_INVALID', reason: 'live.template.ext 须匹配 [a-z0-9]{1,8}（不带点）' };
  }
  return { ok: true };
}

// ---------- ★ 受限动作按钮契约（`contributes.ui.command`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.9。**L2 声明式**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码** —— 按钮只映射到宿主**预定义的动作词表**（`open-url` / `navigate` / `export-live` / `set-theme`），
//     由**渲染层**按受控逻辑执行（既不是主进程取数，也不是引擎行为）。
//   ★ 红线②：**不做任意 React 组件注入** —— 只往宿主既有 UI 表面追加宿主样式的按钮。

/** 命令挂载点（宿主既有 UI 表面） */
export type UiCommandPlacement = 'config' | 'player';
/** 动作词表（宿主预定义；插件只能**选**，不能自己写逻辑） */
export type UiCommandAction = 'open-url' | 'navigate' | 'export-live' | 'set-theme';
/** `navigate` 可去的宿主页面（**语义名**；具体路由由宿主映射，插件不写路径） */
export type UiNavTarget =
  | 'discover' | 'home' | 'history' | 'favorites' | 'live' | 'storage' | 'config' | 'about';

export const UI_COMMAND_PLACEMENTS: readonly UiCommandPlacement[] = ['config', 'player'];
export const UI_COMMAND_ACTIONS: readonly UiCommandAction[] = ['open-url', 'navigate', 'export-live', 'set-theme'];
export const UI_NAV_TARGETS: readonly UiNavTarget[] = [
  'discover', 'home', 'history', 'favorites', 'live', 'storage', 'config', 'about',
];
/** `navigate` 语义名 → 宿主路由（渲染层执行时用） */
export const UI_NAV_PATHS: Record<UiNavTarget, string> = {
  discover: '/', home: '/home', history: '/history', favorites: '/favorites',
  live: '/live', storage: '/storage', config: '/config', about: '/about',
};

/** `contributes` 里 `type:"ui.command"` 的结构（受限动作按钮） */
export interface UiCommandContribute {
  type: 'ui.command';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 按钮文字（短） */
  label: string;
  /** 悬停提示（可选） */
  title?: string;
  /** 挂在哪几个 UI 表面（≥1；每项须在白名单） */
  placement: UiCommandPlacement[];
  /** 动作（决定下面哪些参数必填） */
  action: UiCommandAction;
  /** `action:"open-url"` 必填：仅 `http` / `https` */
  url?: string;
  /** `action:"navigate"` 必填：宿主页面语义名 */
  to?: UiNavTarget;
  /** `action:"navigate"` 且 `to:"config"` 时可选：配置页卡片锚点（`#cfg-<section>`） */
  section?: string;
  /** `action:"export-live"` 可选：模板 id（缺省 = 宿主第一个可用模板） */
  template?: string;
  /** `action:"set-theme"` 必填：皮肤 id（内置 4 套，或 `plugin:<skinId>`） */
  theme?: string;
  /** 执行前二次确认（可选） */
  confirm?: boolean;
}

/** 顶层字段白名单 */
const UI_COMMAND_FIELDS: readonly string[] = [
  'type', 'id', 'label', 'title', 'placement', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm',
];
/** 各动作的专属字段（其余专属字段**不得出现**） */
const UI_COMMAND_ACTION_FIELDS: Record<UiCommandAction, readonly string[]> = {
  'open-url': ['url'],
  navigate: ['to', 'section'],
  'export-live': ['template'],
  'set-theme': ['theme'],
};
const UI_SECTION_RE = /^[a-z0-9-]{1,40}$/;
const UI_TEMPLATE_RE = /^[a-z0-9][a-z0-9:.-]{2,60}$/;
const UI_THEME_RE = /^(?:plugin:)?[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * ★ 动作参数校验（`ui.command` §5.9 与 `keymap` §5.10 **共用**）——
 *   动作是宿主**预定义能力**，按钮 / 快捷键只是两种触发方式，参数口径必须一致。
 *   `where` = 报错前缀（`ui.command` / `keymap`）；`code` = 两处各自的原因码。
 */
function actionParamError(
  t: Record<string, unknown>,
  where: string,
  code: { invalid: PluginReasonCode; url: PluginReasonCode },
): ValidateResult {
  const action = t.action as UiCommandAction;
  if (!UI_COMMAND_ACTIONS.includes(action)) {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.action 须为 ${UI_COMMAND_ACTIONS.join(' | ')}` };
  }
  // ★ 各动作只允许自己的专属字段（写错 = 作者以为能做，实际不做 ⇒ 拒装）
  const allowed = UI_COMMAND_ACTION_FIELDS[action];
  for (const k of ['url', 'to', 'section', 'template', 'theme']) {
    if (t[k] != null && !allowed.includes(k)) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.action=${action} 不接受字段 ${k}` };
    }
  }
  if (t.confirm != null && typeof t.confirm !== 'boolean') {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.confirm（若写）须是布尔` };
  }
  if (action === 'open-url') {
    if (typeof t.url !== 'string' || !/^https?:\/\//i.test(t.url.trim()) || /[\s\r\n]/.test(t.url.trim())) {
      return { ok: false, reasonCode: code.url, reason: `${where}.url 须是 http:// 或 https:// 且不含空白` };
    }
    return { ok: true };
  }
  if (action === 'navigate') {
    if (!UI_NAV_TARGETS.includes(t.to as UiNavTarget)) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.to 须为 ${UI_NAV_TARGETS.join(' / ')}` };
    }
    if (t.section != null) {
      if (t.to !== 'config') return { ok: false, reasonCode: code.invalid, reason: `${where}.section 只在 to=config 时可用` };
      if (typeof t.section !== 'string' || !UI_SECTION_RE.test(t.section)) {
        return { ok: false, reasonCode: code.invalid, reason: `${where}.section 须匹配 [a-z0-9-]{1,40}` };
      }
    }
    return { ok: true };
  }
  if (action === 'export-live') {
    if (t.template != null && (typeof t.template !== 'string' || !UI_TEMPLATE_RE.test(t.template))) {
      return { ok: false, reasonCode: code.invalid, reason: `${where}.template 须匹配 [a-z0-9][a-z0-9:.-]{2,60}` };
    }
    return { ok: true };
  }
  // set-theme
  if (typeof t.theme !== 'string' || !UI_THEME_RE.test(t.theme)) {
    return { ok: false, reasonCode: code.invalid, reason: `${where}.theme 须是皮肤 id（内置 4 套或 plugin:<skinId>）` };
  }
  return { ok: true };
}

/** 校验 `contributes.ui.command`（纯函数） */
export function validateUiCommandContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!UI_COMMAND_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command 字段未知：${k}` };
    }
  }
  const pl = t.placement;
  if (!Array.isArray(pl) || !pl.length) {
    return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: 'ui.command.placement 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const p of pl) {
    if (!UI_COMMAND_PLACEMENTS.includes(p as UiCommandPlacement)) {
      return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command.placement 取值非法：${p}（允许 ${UI_COMMAND_PLACEMENTS.join(' / ')}）` };
    }
    if (seen.has(p as string)) return { ok: false, reasonCode: 'UI_COMMAND_INVALID', reason: `ui.command.placement 重复：${p}` };
    seen.add(p as string);
  }
  const ar = actionParamError(t, 'ui.command', { invalid: 'UI_COMMAND_INVALID', url: 'BAD_UI_COMMAND_URL' });
  if (!ar.ok) return ar;
  return { ok: true };
}

// ---------- ★ 追加快捷键契约（`contributes.keymap`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.10。**L3 声明式**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 与 `ui.command` 用**同一套动作词表** —— 键盘只是另一种**触发方式**（按钮 / 快捷键），
//     动作的实际执行仍由**渲染层** `lib/pluginCommands.ts` 完成（主进程只校验 + 装配）。
//   ★ 「不与宿主冲突」的硬护栏：键位**必须含 Ctrl / Alt / Meta 至少一个**（Shift 单独不算）；
//     主键**仅允许 A~Z / 0~9 / F1~F24** —— 不含方向键 / Backspace / Esc 等宿主已占用的键。
//   ★ 红线②：不注入任何插件自带 UI，只在宿主既有表面（配置页「快捷键」一览 + 播放器键位面板）展示。

/** 快捷键作用域：`app` = 主窗口（App.tsx 全局）/ `player` = 播放器窗口（VideoPlayer） */
export type KeymapScope = 'app' | 'player';
export const KEYMAP_SCOPES: readonly KeymapScope[] = ['app', 'player'];
/** 动作 = **复用** `ui.command` 词表（动作是宿主能力，与触发方式无关） */
export type KeymapAction = UiCommandAction;

/** 修饰键（规范化顺序：Ctrl → Alt → Shift → Meta） */
export type KeymapModifier = 'Ctrl' | 'Alt' | 'Shift' | 'Meta';
export const KEYMAP_MODIFIERS: readonly KeymapModifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];
/** 修饰键别名（大小写不敏感；便于作者书写） */
const KEYMAP_MOD_ALIAS: Record<string, KeymapModifier> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', super: 'Meta', win: 'Meta',
};
/** 主键白名单：单个字母 / 数字 / F1~F24（**不含**方向键、Backspace、Esc 等宿主已占用键） */
const KEYMAP_MAIN_RE = /^(?:[A-Za-z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;

export interface ParsedKeyCombo { mods: KeymapModifier[]; main: string; canonical: string }

/** 解析键位串（大小写不敏感 / 修饰键顺序不限 / 别名归一）；返回规范化结果或错误描述 */
export function parseKeyCombo(key: unknown): { ok: true; combo: ParsedKeyCombo } | { ok: false; error: string } {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, error: '键位必填（如 Ctrl+Alt+F）' };
  const parts = key.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, error: '键位须是「修饰键 + 主键」，如 Ctrl+Alt+F' };
  const main = parts[parts.length - 1];
  const mods: KeymapModifier[] = [];
  for (const tok of parts.slice(0, -1)) {
    const m = KEYMAP_MOD_ALIAS[tok.toLowerCase()];
    if (!m) return { ok: false, error: `未知修饰键：${tok}（允许 Ctrl / Alt / Shift / Meta）` };
    if (mods.includes(m)) return { ok: false, error: `修饰键重复：${m}` };
    mods.push(m);
  }
  if (!(mods.includes('Ctrl') || mods.includes('Alt') || mods.includes('Meta'))) {
    return { ok: false, error: '必须含 Ctrl / Alt / Meta 至少一个（Shift 单独不算，避免劫持普通按键）' };
  }
  if (!KEYMAP_MAIN_RE.test(main)) {
    return { ok: false, error: `主键非法：${main}（仅允许 A~Z / 0~9 / F1~F24；不含方向键等宿主已占用键）` };
  }
  const orderedMods = KEYMAP_MODIFIERS.filter((m) => mods.includes(m));
  const canonical = [...orderedMods, main.toUpperCase()].join('+');
  return { ok: true, combo: { mods: orderedMods, main: main.toUpperCase(), canonical } };
}

/** `contributes` 里 `type:"keymap"` 的结构（追加快捷键；动作复用 `ui.command` 词表） */
export interface KeymapContribute {
  type: 'keymap';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 中文说明（配置页只读一览 / 播放器键位面板显示） */
  label: string;
  /** 悬停提示（可选） */
  title?: string;
  /** 生效范围（≥1；每项须在白名单） */
  scope: KeymapScope[];
  /** 键位串，如 `Ctrl+Alt+F`（**必须含 Ctrl / Alt / Meta**） */
  key: string;
  /** 动作（复用 `ui.command` 词表；决定下面哪些参数必填） */
  action: KeymapAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 顶层字段白名单 */
const KEYMAP_FIELDS: readonly string[] = [
  'type', 'id', 'label', 'title', 'scope', 'key', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm',
];

/** 校验 `contributes.keymap`（纯函数） */
export function validateKeymapContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!KEYMAP_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap 字段未知：${k}` };
    }
  }
  const sc = t.scope;
  if (!Array.isArray(sc) || !sc.length) {
    return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: 'keymap.scope 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of sc) {
    if (!KEYMAP_SCOPES.includes(s as KeymapScope)) {
      return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap.scope 取值非法：${s}（允许 ${KEYMAP_SCOPES.join(' / ')}）` };
    }
    if (seen.has(s as string)) return { ok: false, reasonCode: 'KEYMAP_INVALID', reason: `keymap.scope 重复：${s}` };
    seen.add(s as string);
  }
  const kp = parseKeyCombo(t.key);
  if (!kp.ok) return { ok: false, reasonCode: 'BAD_KEYMAP_KEY', reason: `keymap.key：${kp.error}` };
  const ar = actionParamError(t, 'keymap', { invalid: 'KEYMAP_INVALID', url: 'BAD_KEYMAP_URL' });
  if (!ar.ok) return ar;
  return { ok: true };
}

/** 取插件的**第一个** `keymap` 贡献项（未声明 → undefined；一个插件可声明多条，宿主按全部装配） */
export function keymapContributeOf(contributes: Contribute[] | undefined): KeymapContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'keymap');
  return c ? (c as unknown as KeymapContribute) : undefined;
}

// ---------- ★ 插件设置面板契约（`contributes.settings.panel`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.11。**L3 声明式 UI**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码** —— 只声明「一组受限字段」（label / type / default），宿主把它渲染成**宿主样式的表单**，
//     并**代插件持久化**字段值（按插件 id 分桶存 `<userData>/plugin-settings.json`）；**读取面留给 L4**
//     （`kind:"code"` 的沙箱代码经 `settings` 权限读 `winbox.settings`）—— 与 R1~R7「asset 先实装、code 形待 L4」同口径。
//   ★ 红线②：不做任意 React 组件注入 —— 仅 4 类**受限字段**，不含任意 HTML / 富文本 / 自定义组件。

/** 受限字段词表（4 类；**插件只能选**，不能自己写控件） */
export type SettingsFieldType = 'toggle' | 'select' | 'text' | 'number';
export const SETTINGS_FIELD_TYPES: readonly SettingsFieldType[] = ['toggle', 'select', 'text', 'number'];
/** 字段值（与 `type` 一一对应：toggle→boolean / select·text→string / number→number） */
export type SettingsValue = boolean | string | number;

/** `select` 的一个选项 */
export interface SettingsOption { value: string; label?: string }

/** 单个受限字段 */
export interface SettingsFieldContribute {
  /** 稳定 key（同面板内唯一；`[a-z0-9-]{1,40}`）—— L4 读取时按它取值 */
  key: string;
  /** 中文标签（1~40 字，不含换行） */
  label: string;
  /** 字段类型（词表；决定参数与值类型） */
  type: SettingsFieldType;
  /** 默认值（**必须与 type 匹配**） */
  default: SettingsValue;
  /** `select` 必填：1~50 个选项（`value` 唯一） */
  options?: SettingsOption[];
  /** `text` 可选：最大长度 1~200 */
  maxLength?: number;
  /** `text` 可选：占位符（≤60 字，不含换行） */
  placeholder?: string;
  /** `number` 可选：下限 */
  min?: number;
  /** `number` 可选：上限 */
  max?: number;
  /** `number` 可选：步长（正数） */
  step?: number;
  /** 可选：说明 / 悬停提示（≤120 字，不含换行） */
  hint?: string;
}

/** `contributes` 里 `type:"settings.panel"` 的结构（插件设置面板） */
export interface SettingsPanelContribute {
  type: 'settings.panel';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 面板标题（1~40 字，不含换行） */
  label: string;
  /** 可选：悬停提示（≤120 字） */
  title?: string;
  /** 字段（≥1、≤24；`key` 不得重复） */
  fields: SettingsFieldContribute[];
}

/** key 规则：1~40，且不以 `-` 开头/结尾 */
const SETTINGS_KEY_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SETTINGS_PANEL_FIELDS: readonly string[] = ['type', 'id', 'label', 'title', 'fields'];
const SETTINGS_FIELD_FIELDS: readonly string[] = [
  'key', 'label', 'type', 'default', 'options', 'maxLength', 'placeholder', 'min', 'max', 'step', 'hint',
];
const SETTINGS_MAX_FIELDS = 24;
const SETTINGS_MAX_OPTIONS = 50;
/** 各类型**只**允许自己的专属参数（写别的类型才认的参数 ⇒ 拒装，同 §5.9/§5.10 口径） */
const SETTINGS_TYPE_FIELDS: Record<SettingsFieldType, readonly string[]> = {
  toggle: [], select: ['options'], text: ['maxLength', 'placeholder'], number: ['min', 'max', 'step'],
};

/**
 * 字段**值**是否满足该字段的类型 / 约束（`set` 校验 与「有效值回落」**共用同一实现**）。
 * 返回错误描述；undefined = 合法。
 */
export function settingsValueError(
  f: Pick<SettingsFieldContribute, 'type' | 'options' | 'maxLength' | 'min' | 'max'>,
  value: unknown,
): string | undefined {
  if (f.type === 'toggle') return typeof value === 'boolean' ? undefined : '须是布尔';
  if (f.type === 'select') {
    if (typeof value !== 'string') return '须是字符串';
    return (f.options ?? []).some((o) => o.value === value) ? undefined : '须是 options 里的某个 value';
  }
  if (f.type === 'text') {
    if (typeof value !== 'string') return '须是字符串';
    if (/[\r\n]/.test(value)) return '不得含换行';
    if (f.maxLength != null && value.length > f.maxLength) return `超过最大长度 ${f.maxLength}`;
    return undefined;
  }
  // number
  if (typeof value !== 'number' || !Number.isFinite(value)) return '须是有限数字';
  if (f.min != null && value < f.min) return `低于下限 ${f.min}`;
  if (f.max != null && value > f.max) return `高于上限 ${f.max}`;
  return undefined;
}

/** 有效值 = 存过且合法 → 用存值；否则回落字段默认值（防记忆损坏 / 旧版本残留） */
export function settingsEffectiveValue(f: SettingsFieldContribute, stored: unknown): SettingsValue {
  return stored != null && settingsValueError(f, stored) === undefined ? (stored as SettingsValue) : f.default;
}

/** 单字段校验 */
function settingsFieldError(f: unknown, i: number): ValidateResult {
  const where = `settings.panel.fields[${i}]`;
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where} 非法` };
  }
  const t = f as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (!SETTINGS_FIELD_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where} 字段未知：${k}` };
    }
  }
  if (typeof t.key !== 'string' || !SETTINGS_KEY_RE.test(t.key)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.key 须匹配 [a-z0-9-]{1,40}` };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.label 必填（1~40 字，不含换行）` };
  }
  if (t.hint != null && (typeof t.hint !== 'string' || t.hint.length > 120 || /[\r\n]/.test(t.hint))) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.hint（若写）须是 ≤120 字且不含换行的字符串` };
  }
  const type = t.type as SettingsFieldType;
  if (!SETTINGS_FIELD_TYPES.includes(type)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.type 须为 ${SETTINGS_FIELD_TYPES.join(' | ')}` };
  }
  const allowed = SETTINGS_TYPE_FIELDS[type];
  for (const k of ['options', 'maxLength', 'placeholder', 'min', 'max', 'step']) {
    if (t[k] != null && !allowed.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.type=${type} 不接受字段 ${k}` };
    }
  }
  if (type === 'toggle') {
    if (typeof t.default !== 'boolean') {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是布尔（toggle）` };
    }
    return { ok: true };
  }
  if (type === 'select') {
    const opts = t.options;
    if (!Array.isArray(opts) || !opts.length || opts.length > SETTINGS_MAX_OPTIONS) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 须是 1~${SETTINGS_MAX_OPTIONS} 项数组（select）` };
    }
    const seen = new Set<string>();
    for (const o of opts) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 项非法` };
      }
      const ot = o as Record<string, unknown>;
      for (const k of Object.keys(ot)) {
        if (k !== 'value' && k !== 'label') {
          return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options 项字段未知：${k}` };
        }
      }
      if (typeof ot.value !== 'string' || !ot.value.trim() || ot.value.length > 60) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].value 必填（1~60 字）` };
      }
      if (seen.has(ot.value)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].value 重复：${ot.value}` };
      }
      seen.add(ot.value);
      if (ot.label != null && (typeof ot.label !== 'string' || !ot.label.trim() || ot.label.length > 40)) {
        return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.options[].label（若写）须是 1~40 字` };
      }
    }
    if (typeof t.default !== 'string' || !seen.has(t.default)) {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是 options 里的某个 value（select）` };
    }
    return { ok: true };
  }
  if (type === 'text') {
    if (t.maxLength != null && (typeof t.maxLength !== 'number' || !Number.isInteger(t.maxLength) || t.maxLength < 1 || t.maxLength > 200)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.maxLength 须是 1~200 整数` };
    }
    if (t.placeholder != null && (typeof t.placeholder !== 'string' || t.placeholder.length > 60 || /[\r\n]/.test(t.placeholder))) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.placeholder（若写）须是 ≤60 字且不含换行的字符串` };
    }
    if (
      typeof t.default !== 'string' || /[\r\n]/.test(t.default) ||
      (t.maxLength != null && t.default.length > (t.maxLength as number))
    ) {
      return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是字符串且不超过 maxLength（text）` };
    }
    return { ok: true };
  }
  // number
  const min = t.min, max = t.max, step = t.step;
  for (const [k, v] of [['min', min], ['max', max], ['step', step]] as const) {
    if (v != null && (typeof v !== 'number' || !Number.isFinite(v))) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.${k}（若写）须是有限数字` };
    }
  }
  if (min != null && max != null && (min as number) > (max as number)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.min 不得大于 max` };
  }
  if (step != null && (step as number) <= 0) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `${where}.step（若写）须是正数` };
  }
  const dflt = t.default;
  if (typeof dflt !== 'number' || !Number.isFinite(dflt)) {
    return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 须是有限数字（number）` };
  }
  if ((min != null && dflt < (min as number)) || (max != null && dflt > (max as number))) {
    return { ok: false, reasonCode: 'BAD_SETTINGS_DEFAULT', reason: `${where}.default 超出 [min, max]（number）` };
  }
  return { ok: true };
}

/** 校验 `contributes.settings.panel`（纯函数） */
export function validateSettingsPanelContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.label 必填（1~40 字，不含换行）' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: 'settings.panel.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!SETTINGS_PANEL_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel 字段未知：${k}` };
    }
  }
  const fs = t.fields;
  if (!Array.isArray(fs) || !fs.length || fs.length > SETTINGS_MAX_FIELDS) {
    return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel.fields 须是 1~${SETTINGS_MAX_FIELDS} 项数组` };
  }
  const seen = new Set<string>();
  for (let i = 0; i < fs.length; i++) {
    const r = settingsFieldError(fs[i], i);
    if (!r.ok) return r;
    const key = (fs[i] as Record<string, unknown>).key as string;
    if (seen.has(key)) {
      return { ok: false, reasonCode: 'SETTINGS_PANEL_INVALID', reason: `settings.panel.fields key 重复：${key}` };
    }
    seen.add(key);
  }
  return { ok: true };
}

/** 取插件的**第一个** `settings.panel` 贡献项（未声明 → undefined；一个插件可声明多个面板，宿主按全部装配） */
export function settingsPanelContributeOf(contributes: Contribute[] | undefined): SettingsPanelContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'settings.panel');
  return c ? (c as unknown as SettingsPanelContribute) : undefined;
}

// ---------- ★ 受限 UI 槽位契约（`contributes.ui.slot`）----------
// 唯一权威：`docs/design/插件制作规范.md` §5.12。**L3 声明式 UI**（`kind:"asset"`、`permissions` 恒空、无 `main`）。
//   ★ 插件**不跑代码、不注入任何 UI**（红线②：不做任意 React 组件注入）—— 只声明一棵**受限组件树**
//     （6 类组件），宿主把它渲染进**宿主既有页面的槽位**里（自己的样式、自己的交互）。
//   ★ `link` 组件**复用 §5.9 的动作词表**（与 `ui.command`/`keymap` 同一套），由渲染层同一执行器执行。

/** 宿主开放的槽位（页面语义名；渲染层据此把内容追加到对应页面） */
export type UiSlotId = 'discover' | 'home' | 'detail' | 'live' | 'history' | 'favorites';
export const UI_SLOT_IDS: readonly UiSlotId[] = ['discover', 'home', 'detail', 'live', 'history', 'favorites'];

/** 受限组件词表（6 类；**插件只能选**，不能自己写控件 / 注入 HTML） */
export type UiSlotItemType = 'heading' | 'text' | 'image' | 'divider' | 'kv' | 'link';
export const UI_SLOT_ITEM_TYPES: readonly UiSlotItemType[] = ['heading', 'text', 'image', 'divider', 'kv', 'link'];

/** `kv` 组件的一行 */
export interface UiSlotKvItem { label: string; value: string }

/** 受限组件（各类型只允许自己的字段 —— 写了别的类型才认的字段 ⇒ 拒装，同 §5.9~§5.11 口径） */
export interface UiSlotItem {
  type: UiSlotItemType;
  /** `heading`（1~80 字，不含换行）/ `text`（1~500 字，可含换行）必填 */
  text?: string;
  /** `image` 必填（仅 http/https）/ `link` 的 `open-url` 参数（同名同义，按 `type` 区分） */
  url?: string;
  /** `image` 可选：替代文本（≤80 字，不含换行） */
  alt?: string;
  /** `kv` 必填：1~12 行 */
  items?: UiSlotKvItem[];
  /** `link` 必填：按钮文字（1~40 字，不含换行） */
  label?: string;
  /** `link` 必填：动作（复用 §5.9 词表） */
  action?: UiCommandAction;
  /** `link` 的动作参数（与 `action` 匹配，规则同 §5.9） */
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** `contributes` 里 `type:"ui.slot"` 的结构（受限 UI 槽位） */
export interface UiSlotContribute {
  type: 'ui.slot';
  /** 稳定 id（同插件内唯一；跨插件同 id 先到先得） */
  id: string;
  /** 目标槽位（≥1；每项须在白名单） */
  slot: UiSlotId[];
  /** 可选：内容区小标题（1~40 字，不含换行） */
  label?: string;
  /** 可选：悬停提示（≤120 字） */
  title?: string;
  /** 组件树（≥1、≤24） */
  items: UiSlotItem[];
}

const UI_SLOT_FIELDS: readonly string[] = ['type', 'id', 'slot', 'label', 'title', 'items'];
const UI_SLOT_ITEM_FIELDS: readonly string[] = [
  'type', 'text', 'url', 'alt', 'items', 'label', 'action', 'to', 'section', 'template', 'theme', 'confirm',
];
/** 各组件类型**只**允许自己的字段 */
const UI_SLOT_ITEM_TYPE_FIELDS: Record<UiSlotItemType, readonly string[]> = {
  heading: ['text'], text: ['text'], divider: [],
  image: ['url', 'alt'], kv: ['items'],
  link: ['label', 'action', 'url', 'to', 'section', 'template', 'theme', 'confirm'],
};
const UI_SLOT_MAX_ITEMS = 24;
const UI_SLOT_MAX_KV = 12;
/** http/https 且不含空白 */
function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) && !/[\s\r\n]/.test(v);
}
const UI_SLOT_TEXT_MAX = 500;

/** 单组件校验 */
function uiSlotItemError(it: unknown, i: number): ValidateResult {
  const where = `ui.slot.items[${i}]`;
  if (!it || typeof it !== 'object' || Array.isArray(it)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where} 非法` };
  }
  const t = it as Record<string, unknown>;
  for (const k of Object.keys(t)) {
    if (!UI_SLOT_ITEM_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where} 字段未知：${k}` };
    }
  }
  const type = t.type as UiSlotItemType;
  if (!UI_SLOT_ITEM_TYPES.includes(type)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.type 须为 ${UI_SLOT_ITEM_TYPES.join(' | ')}` };
  }
  const allowed = UI_SLOT_ITEM_TYPE_FIELDS[type];
  for (const k of UI_SLOT_ITEM_FIELDS) {
    if (k === 'type' || t[k] == null) continue;
    if (!allowed.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.type=${type} 不接受字段 ${k}` };
    }
  }
  if (type === 'heading' || type === 'text') {
    const max = type === 'heading' ? 80 : UI_SLOT_TEXT_MAX;
    if (typeof t.text !== 'string' || !t.text.trim() || t.text.length > max || (type === 'heading' && /[\r\n]/.test(t.text))) {
      return {
        ok: false, reasonCode: 'UI_SLOT_INVALID',
        reason: `${where}.text 必填（1~${max} 字${type === 'heading' ? '，不含换行' : ''}）`,
      };
    }
    return { ok: true };
  }
  if (type === 'divider') return { ok: true };
  if (type === 'image') {
    if (typeof t.url !== 'string' || !isHttpUrl(t.url)) {
      return { ok: false, reasonCode: 'BAD_UI_SLOT_URL', reason: `${where}.url 须是 http:// 或 https:// 且不含空白` };
    }
    if (t.alt != null && (typeof t.alt !== 'string' || t.alt.length > 80 || /[\r\n]/.test(t.alt))) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.alt（若写）须是 ≤80 字且不含换行的字符串` };
    }
    return { ok: true };
  }
  if (type === 'kv') {
    const items = t.items;
    if (!Array.isArray(items) || !items.length || items.length > UI_SLOT_MAX_KV) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 须是 1~${UI_SLOT_MAX_KV} 行数组（kv）` };
    }
    for (const row of items) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 行非法` };
      }
      const r = row as Record<string, unknown>;
      for (const k of Object.keys(r)) {
        if (k !== 'label' && k !== 'value') {
          return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items 行字段未知：${k}` };
        }
      }
      if (typeof r.label !== 'string' || !r.label.trim() || r.label.length > 40 || /[\r\n]/.test(r.label)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items[].label 必填（1~40 字，不含换行）` };
      }
      if (typeof r.value !== 'string' || !r.value.trim() || r.value.length > 200 || /[\r\n]/.test(r.value)) {
        return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.items[].value 必填（1~200 字，不含换行）` };
      }
    }
    return { ok: true };
  }
  // link：label 必填 + 动作参数（★ **复用** §5.9 的共用校验，口径只有一处）
  if (typeof t.label !== 'string' || !t.label.trim() || t.label.trim().length > 40 || /[\r\n]/.test(t.label)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `${where}.label 必填（1~40 字，不含换行，link）` };
  }
  return actionParamError(t, 'ui.slot.link', { invalid: 'UI_SLOT_INVALID', url: 'BAD_UI_SLOT_URL' });
}

/** 校验 `contributes.ui.slot`（纯函数） */
export function validateUiSlotContribute(c: unknown): ValidateResult {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot 贡献项非法' };
  }
  const t = c as Record<string, unknown>;
  if (typeof t.id !== 'string' || !ID_RE.test(t.id)) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.id 须匹配 [a-z0-9-]{3,40}' };
  }
  if (t.label != null && (typeof t.label !== 'string' || !t.label.trim() || t.label.length > 40 || /[\r\n]/.test(t.label))) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.label（若写）须是 1~40 字且不含换行' };
  }
  if (t.title != null && (typeof t.title !== 'string' || t.title.length > 120 || /[\r\n]/.test(t.title))) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.title（若写）须是 ≤120 字且不含换行的字符串' };
  }
  for (const k of Object.keys(t)) {
    if (!UI_SLOT_FIELDS.includes(k)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot 字段未知：${k}` };
    }
  }
  const slots = t.slot;
  if (!Array.isArray(slots) || !slots.length) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: 'ui.slot.slot 须是非空数组' };
  }
  const seen = new Set<string>();
  for (const s of slots) {
    if (!UI_SLOT_IDS.includes(s as UiSlotId)) {
      return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.slot 取值非法：${s}（允许 ${UI_SLOT_IDS.join(' / ')}）` };
    }
    if (seen.has(s as string)) return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.slot 重复：${s}` };
    seen.add(s as string);
  }
  const items = t.items;
  if (!Array.isArray(items) || !items.length || items.length > UI_SLOT_MAX_ITEMS) {
    return { ok: false, reasonCode: 'UI_SLOT_INVALID', reason: `ui.slot.items 须是 1~${UI_SLOT_MAX_ITEMS} 项数组` };
  }
  for (let i = 0; i < items.length; i++) {
    const r = uiSlotItemError(items[i], i);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** 取插件的**第一个** `ui.slot` 贡献项（未声明 → undefined；一个插件可声明多个槽位，宿主按全部装配） */
export function uiSlotContributeOf(contributes: Contribute[] | undefined): UiSlotContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'ui.slot');
  return c ? (c as unknown as UiSlotContribute) : undefined;
}

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
export function playerEngineContributeOf(contributes: Contribute[] | undefined): PlayerEngineContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'player.engine');
  return c ? (c as unknown as PlayerEngineContribute) : undefined;
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
  | 'THEME_STYLE_NOT_ALLOWED' | 'BAD_THEME_LAYOUT'
  // 字幕源 / 元数据源（L2 声明式 provider）
  | 'SUBTITLE_PROVIDER_INVALID' | 'SUBTITLE_ID_TAKEN' | 'BAD_PROVIDER_URL' | 'BAD_PROVIDER_PATH'
  | 'META_PROVIDER_INVALID' | 'META_ID_TAKEN'
  | 'DISCOVER_PROVIDER_INVALID'
  | 'DANMAKU_PROVIDER_INVALID'
  // 直播输出模板（L2 声明式**输出**；不发请求）
  | 'LIVE_TEMPLATE_INVALID' | 'BAD_LIVE_TEMPLATE_LINE'
  // 受限动作按钮（L3 声明式 UI；动作词表 + 挂载点白名单）
  | 'UI_COMMAND_INVALID' | 'BAD_UI_COMMAND_URL'
  // 追加快捷键（L3 声明式 UI；动作复用上表；键位必须含 Ctrl/Alt/Meta）
  | 'KEYMAP_INVALID' | 'BAD_KEYMAP_KEY' | 'BAD_KEYMAP_URL'
  // 插件设置面板（L3 声明式 UI；4 类受限字段；宿主代持久化，读取面留 L4）
  | 'SETTINGS_PANEL_INVALID' | 'BAD_SETTINGS_DEFAULT'
  // 受限 UI 槽位（L3 声明式 UI；6 类受限组件；link 复用动作词表）
  | 'UI_SLOT_INVALID' | 'BAD_UI_SLOT_URL'
  // L4 权限说明（`permissionNotes`；键必须 ⊆ 已声明权限，值 1~200 字无换行）
  | 'BAD_PERMISSION_NOTES'
  // 第三方播放内核（`contributes.player.engine`；宿主托管进程 — 插件只给描述符）
  | 'PLAYER_ENGINE_INVALID' | 'BAD_ENGINE_ARGS';

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
    // ★ `subtitle.provider` 的**声明式**内容校验（仅 asset；code 形在 L4 轮再定契约）
    if (c.type === 'subtitle.provider' && p.kind === 'asset') {
      const sr = validateSubtitleProviderContribute(c);
      if (!sr.ok) return sr;
    }
    // ★ `meta.provider` 同上（仅 asset）
    if (c.type === 'meta.provider' && p.kind === 'asset') {
      const mr = validateMetaProviderContribute(c);
      if (!mr.ok) return mr;
    }
    // ★ `discover.source` 同上（仅 asset）
    if (c.type === 'discover.source' && p.kind === 'asset') {
      const dr = validateDiscoverSourceContribute(c);
      if (!dr.ok) return dr;
    }
    // ★ `danmaku.source` 同上（仅 asset）
    if (c.type === 'danmaku.source' && p.kind === 'asset') {
      const kr = validateDanmakuSourceContribute(c);
      if (!kr.ok) return kr;
    }
    // ★ `live.template` 同上（仅 asset）—— 它**不发请求**，只做输出侧格式化
    if (c.type === 'live.template' && p.kind === 'asset') {
      const lr = validateLiveTemplateContribute(c);
      if (!lr.ok) return lr;
    }
    // ★ `ui.command` 同上（仅 asset）—— 受限动作按钮，动作词表 / 挂载点白名单
    if (c.type === 'ui.command' && p.kind === 'asset') {
      const ur = validateUiCommandContribute(c);
      if (!ur.ok) return ur;
    }
    // ★ `keymap` 同上（仅 asset）—— 追加快捷键，动作复用 `ui.command` 词表
    if (c.type === 'keymap' && p.kind === 'asset') {
      const kr = validateKeymapContribute(c);
      if (!kr.ok) return kr;
    }
    // ★ `settings.panel` 同上 —— 面板是**声明式 UI**（与 kind 无关）⇒ **asset / code 都校验内容**
    //   （§5.11：code 插件也可声明面板，再经 `winbox.settings` 读）
    if (c.type === 'settings.panel') {
      const sr = validateSettingsPanelContribute(c);
      if (!sr.ok) return sr;
    }
    // ★ `ui.slot` 同上（仅 asset）—— 受限 UI 槽位（6 类受限组件）
    if (c.type === 'ui.slot' && p.kind === 'asset') {
      const ur = validateUiSlotContribute(c);
      if (!ur.ok) return ur;
    }
    // ★ 第三方播放内核（`player.engine`）恒为 `kind:"code"`（CONTRIBUTES 已冻结为 ['code']）⇒ 内容校验**不分 kind**
    if (c.type === 'player.engine') {
      const er = validatePlayerEngineContribute(c);
      if (!er.ok) return er;
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

/** 取插件的 `theme` 贡献项（未声明 → undefined） */
export function themeContributeOf(contributes: Contribute[] | undefined): ThemeContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'theme');
  return c ? (c as unknown as ThemeContribute) : undefined;
}

/** 取插件的 `subtitle.provider` 贡献项（未声明 → undefined） */
export function subtitleProviderContributeOf(contributes: Contribute[] | undefined): SubtitleProviderContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'subtitle.provider');
  return c ? (c as unknown as SubtitleProviderContribute) : undefined;
}

/** 取插件的 `meta.provider` 贡献项（未声明 → undefined） */
export function metaProviderContributeOf(contributes: Contribute[] | undefined): MetaProviderContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'meta.provider');
  return c ? (c as unknown as MetaProviderContribute) : undefined;
}

/** 取插件的 `discover.source` 贡献项（未声明 → undefined） */
export function discoverSourceContributeOf(contributes: Contribute[] | undefined): DiscoverSourceContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'discover.source');
  return c ? (c as unknown as DiscoverSourceContribute) : undefined;
}

/** 取插件的 `danmaku.source` 贡献项（未声明 → undefined） */
export function danmakuSourceContributeOf(contributes: Contribute[] | undefined): DanmakuSourceContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'danmaku.source');
  return c ? (c as unknown as DanmakuSourceContribute) : undefined;
}

/** 取插件的 `live.template` 贡献项（未声明 → undefined） */
export function liveTemplateContributeOf(contributes: Contribute[] | undefined): LiveTemplateContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'live.template');
  return c ? (c as unknown as LiveTemplateContribute) : undefined;
}

/** 取插件的**第一个** `ui.command` 贡献项（未声明 → undefined；一个插件可声明多个，宿主按全部装配） */
export function uiCommandContributeOf(contributes: Contribute[] | undefined): UiCommandContribute | undefined {
  const c = (contributes ?? []).find((x) => x.type === 'ui.command');
  return c ? (c as unknown as UiCommandContribute) : undefined;
}

// ---------- ★ 渲染层/管理器可见的**视图模型**（主进程组装，preload 与 client 共用类型） ----------

/** 插件沙箱（`kind:"code"`）运行态；asset 插件恒 undefined（★ R10） */
export interface PluginSandboxView {
  /** 沙箱 worker 是否存活 */
  running: boolean;
  /** 最近一次启动失败原因（成功 / 未启动 → undefined） */
  error?: string;
}

/** ★ R10：安装前**干跑**（`plugin:inspect`）结果 —— 供渲染层弹「权限确认」 */
export interface PluginInspectResult {
  ok: boolean;
  /** 用户取消了文件选择（不装） */
  canceled?: boolean;
  reason?: string;
  reasonCode?: string;
  /** 选中的文件路径（确认后原样回传给 `plugin:install`） */
  path?: string;
  id?: string;
  name?: string;
  version?: string;
  kind?: PluginKind;
  permissions?: string[];
  permissionNotes?: Record<string, string>;
}

/** 插件条目视图（管理器列表 / 播放器超分入口用） */
export interface PluginView {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'user';
  level: PluginLevel;
  /** ★ R10：能力形态（code 插件在沙箱里跑，配置页据此显示权限徽标） */
  kind: PluginKind;
  /** ★ R10：已声明权限（`kind:"code"` 非空；asset 恒空） */
  permissions: string[];
  /** ★ R10：`kind:"code"` 的沙箱运行态（asset 插件 → undefined） */
  sandbox?: PluginSandboxView;
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

/** 直播输出模板视图（导出面板消费；内置默认模板 `pluginId='builtin'`） */
export interface LiveTemplateView {
  id: string;
  pluginId: string;
  label: string;
  format: 'txt' | 'm3u';
  ext: string;
}

/** 受限动作按钮视图（配置页 / 播放器控制条消费；执行由渲染层按动作词表完成） */
export interface UiCommandView {
  id: string;
  pluginId: string;
  /** 来源插件显示名（按钮 tooltip / 来源标注用） */
  pluginName: string;
  label: string;
  title?: string;
  placement: UiCommandPlacement[];
  action: UiCommandAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 插件快捷键视图（配置页「快捷键」只读一览 / 播放器键位面板消费；动作由渲染层按词表执行） */
export interface KeymapView {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  title?: string;
  scope: KeymapScope[];
  /** **规范化**键位串（如 `Ctrl+Alt+F`）—— 渲染层据此匹配键盘事件 */
  key: string;
  action: KeymapAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 设置面板单字段视图（含**有效值** = 存值合法则用存值，否则回落 default） */
export interface SettingsFieldView {
  key: string;
  label: string;
  type: SettingsFieldType;
  value: SettingsValue;
  options?: SettingsOption[];
  maxLength?: number;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

/** 插件设置面板视图（配置页「插件」卡片内消费；渲染层负责表单渲染 + 写回宿主持久化） */
export interface SettingsPanelView {
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  title?: string;
  fields: SettingsFieldView[];
}

/** 受限组件视图（与贡献项同形；★ 只搬运白名单字段） */
export interface UiSlotItemView {
  type: UiSlotItemType;
  text?: string;
  url?: string;
  alt?: string;
  items?: UiSlotKvItem[];
  label?: string;
  action?: UiCommandAction;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

/** 受限 UI 槽位视图（渲染层 `<PluginSlot slot="…" />` 消费；link 由渲染层按动作词表执行） */
export interface UiSlotView {
  id: string;
  pluginId: string;
  pluginName: string;
  slot: UiSlotId[];
  label?: string;
  title?: string;
  items: UiSlotItemView[];
}

/**
 * ★ 第三方播放内核视图（渲染层内核列表消费；见 §6.3）。
 * `id` = **渲染层内核值** `engine:<contributeId>` —— 与 `Kernel` / `KernelPref` 的扩展口径一致。
 */
export interface PlayerEngineView {
  /** 渲染层内核值：`engine:<contributeId>` */
  id: string;
  pluginId: string;
  pluginName: string;
  label: string;
  capabilities: PlayerEngineCapability[];
  /** 二进制来源（内置 2 无此项；`local-path` 的引擎在配置页才显示「本机程序路径」输入框） */
  source?: PlayerEngineBinarySource;
  /** 是否已就绪（exe 解析成功）；未就绪 → 列表里显示不可选 + 原因 */
  ready: boolean;
  /** 就绪时的 exe 绝对路径（渲染层不碰文件系统，仅用于展示/排障） */
  path?: string;
  /** 未就绪原因（人话） */
  note?: string;
}
