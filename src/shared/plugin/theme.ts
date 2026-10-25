import { ID_RE, type ValidateResult } from './core';

import { wcagContrastRatio } from '../ui/colorContrast';

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

const BASE_THEME_COLORS: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--surface-0': '#0a0c10', '--surface-1': 'rgba(15,18,24,.85)',
    '--surface-2': 'rgba(20,24,31,.82)', '--surface-3': 'rgba(27,32,42,.82)',
    '--accent': '#5b8cff', '--accent-strong': '#4d7fff', '--on-accent': '#0a0c10',
    '--text': '#e8ecf4', '--text-dim': '#8a93a6',
  },
  light: {
    '--surface-0': '#f5f5f7', '--surface-1': 'rgba(255,255,255,.8)',
    '--surface-2': 'rgba(255,255,255,.92)', '--surface-3': '#ffffff',
    '--accent': '#0069d9', '--accent-strong': '#0057ba', '--on-accent': '#ffffff',
    '--text': '#1d1d1f', '--text-dim': '#6e6e73',
  },
};

function resolveThemeColor(
  name: string,
  tokens: Record<string, unknown>,
  base: 'dark' | 'light',
  seen = new Set<string>(),
): string | null {
  if (seen.has(name)) return null;
  const raw = tokens[name] ?? BASE_THEME_COLORS[base][name];
  if (typeof raw !== 'string') return null;
  const reference = VAR_REF_RE.exec(raw.trim());
  if (!reference) return raw;
  const next = new Set(seen);
  next.add(name);
  return resolveThemeColor(reference[1], tokens, base, next);
}

function themeContrastError(base: 'dark' | 'light', tokens: Record<string, unknown>): string | undefined {
  const backdrop = resolveThemeColor('--surface-0', tokens, base);
  if (!backdrop) return '无法解析 --surface-0，不能验证文字对比度';

  const textForegrounds = ['--text', '--text-dim'];
  // `--text-faint` is optional because the base theme supplies it, but when a
  // plugin overrides it, it is still used for visible labels/placeholders and
  // must meet the same normal-text contrast requirement.
  if (tokens['--text-faint'] != null) textForegrounds.push('--text-faint');

  for (const foregroundName of textForegrounds) {
    const foreground = resolveThemeColor(foregroundName, tokens, base);
    if (!foreground) return `${foregroundName} 引用循环或无法解析，不能验证文字对比度`;
    for (const backgroundName of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) {
      const background = resolveThemeColor(backgroundName, tokens, base);
      if (!background) return `${backgroundName} 引用循环或无法解析，不能验证文字对比度`;
      const ratio = wcagContrastRatio(foreground, background, backdrop);
      if (ratio == null) return `${foregroundName} / ${backgroundName} 的颜色格式无法计算对比度`;
      if (ratio < 4.5) return `${foregroundName} 在 ${backgroundName} 上的对比度为 ${ratio.toFixed(2)}:1，低于 WCAG AA 4.5:1`;
    }
  }

  const onAccent = resolveThemeColor('--on-accent', tokens, base);
  if (!onAccent) return '--on-accent 引用循环或无法解析，不能验证按钮对比度';
  for (const accentName of ['--accent', '--accent-strong']) {
    const accent = resolveThemeColor(accentName, tokens, base);
    if (!accent) return `${accentName} 引用循环或无法解析，不能验证按钮对比度`;
    const ratio = wcagContrastRatio(onAccent, accent, backdrop);
    if (ratio == null) return `--on-accent / ${accentName} 的颜色格式无法计算对比度`;
    if (ratio < 4.5) return `--on-accent 在 ${accentName} 上的对比度为 ${ratio.toFixed(2)}:1，低于 WCAG AA 4.5:1`;
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
  const contrastError = themeContrastError(t.base, tokens as Record<string, unknown>);
  if (contrastError) return { ok: false, reasonCode: 'BAD_THEME_TOKEN_VALUE', reason: contrastError };
  const lErr = layoutError(t.layout);
  if (lErr) return { ok: false, reasonCode: 'BAD_THEME_LAYOUT', reason: lErr };
  return { ok: true };
}
