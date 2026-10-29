import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface Color {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface ThemeTokens {
  [name: string]: string;
}

const stylesDirectory = new URL('../src/renderer/styles/', import.meta.url);
const themes = [
  { name: 'Netflix dark', file: 'netflix.css', selector: ":root[data-theme='netflix']" },
  { name: 'Bilibili light', file: 'bilibili.css', selector: ":root[data-theme='bilibili']" },
  { name: 'Apple light', file: 'apple.css', selector: ":root[data-theme='apple']" },
  { name: 'Douban light', file: 'douban.css', selector: ":root[data-theme='douban']" },
  { name: 'Desktop dark', file: 'desktop.css', selector: ":root[data-ui='desktop']" },
  { name: 'Desktop light', file: 'desktop.css', selector: ":root[data-ui='desktop'][data-theme='light']" },
] as const;

const textTokens = [
  '--text',
  '--text-dim',
  '--text-faint',
  '--text-disabled',
  '--text-accent',
  '--text-accent-secondary',
  '--text-danger',
  '--text-warn',
  '--text-success',
] as const;
const surfaceTokens = ['--surface-0', '--surface-1', '--surface-2', '--surface-3'] as const;

function readRootTokens(css: string, selector: string): ThemeTokens {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing theme token block: ${selector}`);
  const bodyStart = css.indexOf('{', start) + 1;
  let depth = 1;
  let end = bodyStart;

  for (; end < css.length && depth > 0; end += 1) {
    if (css[end] === '{') depth += 1;
    if (css[end] === '}') depth -= 1;
  }

  const body = css.slice(bodyStart, end - 1).replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens: ThemeTokens = {};
  for (const declaration of body.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim();
    if (name.startsWith('--')) tokens[name] = declaration.slice(separator + 1).trim();
  }
  return tokens;
}

function parseColor(value: string | undefined): Color | null {
  if (!value) return null;
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const rgb = expanded.slice(0, 6);
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    return {
      red: Number.parseInt(rgb.slice(0, 2), 16),
      green: Number.parseInt(rgb.slice(2, 4), 16),
      blue: Number.parseInt(rgb.slice(4, 6), 16),
      alpha,
    };
  }

  const channels = value.match(/^rgba?\(([^)]+)\)$/i)?.[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
  return { red: channels[0], green: channels[1], blue: channels[2], alpha: channels[3] ?? 1 };
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha;
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
    alpha: 1,
  };
}

function luminance(color: Color): number {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: Color, second: Color): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function mixSrgb(first: Color, second: Color, firstWeight: number): Color {
  return {
    red: first.red * firstWeight + second.red * (1 - firstWeight),
    green: first.green * firstWeight + second.green * (1 - firstWeight),
    blue: first.blue * firstWeight + second.blue * (1 - firstWeight),
    alpha: 1,
  };
}

function lastRuleForSelector(css: string, selector: string, property?: string): string {
  const normalizedTarget = selector.replace(/\s+/g, ' ').trim();
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const matches = rules.filter(([, rawSelector]) => rawSelector
    .split(',')
    .some((part) => part.replace(/\s+/g, ' ').trim() === normalizedTarget))
    .filter(([, , declarations]) => !property || new RegExp(`(?:^|;)\\s*${property}\\s*:`).test(declarations));
  return matches.at(-1)?.[2] ?? '';
}

describe('theme text contrast tokens', () => {
  for (const theme of themes) {
    it(`${theme.name} meets WCAG AA contrast for text on every base surface`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      expect(baseSurface, `${theme.name} needs an opaque base surface token`).not.toBeNull();

      for (const textToken of textTokens) {
        const rawText = parseColor(tokens[textToken]);
        expect(rawText, `${theme.name} needs a concrete ${textToken} token`).not.toBeNull();
        for (const surfaceToken of surfaceTokens) {
          const rawSurface = parseColor(tokens[surfaceToken]);
          expect(rawSurface, `${theme.name} needs a concrete ${surfaceToken} token`).not.toBeNull();
          const surface = composite(rawSurface!, baseSurface!);
          const text = composite(rawText!, surface);
          const ratio = contrastRatio(text, surface);
          expect(ratio, `${theme.name}: ${textToken} on ${surfaceToken} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${theme.name} keeps accent foreground readable`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const accent = parseColor(tokens['--accent']);
      const onAccent = parseColor(tokens['--on-accent']);
      expect(accent, `${theme.name} needs an accent token`).not.toBeNull();
      expect(onAccent, `${theme.name} needs an on-accent token`).not.toBeNull();
      expect(contrastRatio(onAccent!, accent!), `${theme.name} --on-accent contrast`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme.name} keeps functional boundaries visible on every base surface`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const boundary = parseColor(tokens['--border']);
      expect(baseSurface, `${theme.name} needs an opaque base surface token`).not.toBeNull();
      expect(boundary, `${theme.name} needs a concrete --border token`).not.toBeNull();

      for (const surfaceToken of surfaceTokens) {
        const rawSurface = parseColor(tokens[surfaceToken]);
        expect(rawSurface, `${theme.name} needs a concrete ${surfaceToken} token`).not.toBeNull();
        const surface = composite(rawSurface!, baseSurface!);
        const visibleBoundary = composite(boundary!, surface);
        const ratio = contrastRatio(visibleBoundary, surface);
        expect(ratio, `${theme.name}: --border on ${surfaceToken} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${theme.name} keeps keyboard focus visible on every base surface`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const focusRing = parseColor(tokens['--focus-ring-color']) ?? parseColor(tokens['--text-accent']);
      expect(baseSurface, `${theme.name} needs an opaque base surface token`).not.toBeNull();
      expect(focusRing, `${theme.name} needs a concrete focus ring or accent token`).not.toBeNull();

      for (const surfaceToken of surfaceTokens) {
        const rawSurface = parseColor(tokens[surfaceToken]);
        expect(rawSurface, `${theme.name} needs a concrete ${surfaceToken} token`).not.toBeNull();
        const surface = composite(rawSurface!, baseSurface!);
        const visibleFocusRing = composite(focusRing!, surface);
        const ratio = contrastRatio(visibleFocusRing, surface);
        expect(ratio, `${theme.name}: focus ring on ${surfaceToken} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('interactive state contrast combinations', () => {
  for (const theme of themes) {
    it(`${theme.name} keeps player menus, history actions, and drive provider tabs readable`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const raisedSurface = parseColor(tokens['--surface-2']);
      const elevatedSurface = parseColor(tokens['--surface-3']);
      const text = parseColor(tokens['--text']);
      const textDim = parseColor(tokens['--text-dim']);
      const textSuccess = parseColor(tokens['--text-success']);
      const accent = parseColor(tokens['--accent']);
      const onAccent = parseColor(tokens['--on-accent']);

      expect(baseSurface, `${theme.name} needs an opaque base surface`).not.toBeNull();
      expect(raisedSurface, `${theme.name} needs a raised surface`).not.toBeNull();
      expect(elevatedSurface, `${theme.name} needs an elevated surface`).not.toBeNull();
      expect(text, `${theme.name} needs primary text`).not.toBeNull();
      expect(textDim, `${theme.name} needs secondary text`).not.toBeNull();
      expect(textSuccess, `${theme.name} needs success text`).not.toBeNull();
      expect(accent, `${theme.name} needs an accent`).not.toBeNull();
      expect(onAccent, `${theme.name} needs an accent foreground`).not.toBeNull();

      const raised = composite(raisedSurface!, baseSurface!);
      const elevated = composite(elevatedSurface!, baseSurface!);
      const primaryText = composite(text!, raised);
      const menuHover = mixSrgb(accent!, elevated, 0.16);
      expect(contrastRatio(primaryText, elevated), `${theme.name}: playback-rate option`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(primaryText, menuHover), `${theme.name}: playback-rate hover`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(onAccent!, accent!), `${theme.name}: selected playback-rate option`).toBeGreaterThanOrEqual(4.5);

      const accentSoft = parseColor(tokens['--accent-soft']);
      const accentText = parseColor(tokens['--text-accent']);
      expect(accentSoft, `${theme.name} needs an accent-soft surface`).not.toBeNull();
      expect(accentText, `${theme.name} needs accent text`).not.toBeNull();
      const detailBackground = composite(accentSoft!, raised);
      expect(contrastRatio(composite(accentText!, detailBackground), detailBackground), `${theme.name}: history detail action`).toBeGreaterThanOrEqual(4.5);

      const danger = parseColor(tokens['--color-danger'] ?? tokens['--danger']);
      const dangerText = parseColor(tokens['--text-danger']);
      expect(danger, `${theme.name} needs a danger color`).not.toBeNull();
      expect(dangerText, `${theme.name} needs danger text`).not.toBeNull();
      for (const [state, weight] of [['resting', 0.08], ['hover', 0.14]] as const) {
        const removeBackground = mixSrgb(danger!, raised, weight);
        expect(
          contrastRatio(composite(dangerText!, removeBackground), removeBackground),
          `${theme.name}: history remove ${state}`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      // Desktop tabs use the secondary-text token; other themes inherit primary text.
      const providerText = theme.name.startsWith('Desktop') ? parseColor(tokens['--text-dim']) : text;
      expect(providerText, `${theme.name} needs readable provider-tab text`).not.toBeNull();
      expect(contrastRatio(composite(providerText!, raised), raised), `${theme.name}: unselected drive provider tab`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(composite(textDim!, raised), raised), `${theme.name}: unbound drive provider icon`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(composite(textSuccess!, raised), raised), `${theme.name}: bound drive provider icon`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(onAccent!, accent!), `${theme.name}: selected drive provider tab`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('disabled control state contrast', () => {
  for (const theme of themes) {
    it(`${theme.name} keeps disabled actions and form fields readable`, async () => {
      const css = await readFile(new URL(theme.file, stylesDirectory), 'utf8');
      const tokens = readRootTokens(css, theme.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const disabledSurface = parseColor(tokens['--surface-3']);
      const disabledText = parseColor(tokens['--text-disabled']);
      expect(baseSurface, `${theme.name} needs a base surface`).not.toBeNull();
      expect(disabledSurface, `${theme.name} needs a disabled surface`).not.toBeNull();
      expect(disabledText, `${theme.name} needs a disabled text token`).not.toBeNull();

      const effectiveDisabledSurface = composite(disabledSurface!, baseSurface!);
      const effectiveDisabledText = composite(disabledText!, effectiveDisabledSurface);
      const ratio = contrastRatio(effectiveDisabledText, effectiveDisabledSurface);
      expect(ratio, `${theme.name}: disabled text on disabled surface is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

      const componentStyles = await readFile(new URL('global-components.css', stylesDirectory), 'utf8');
      const globalStyles = await readFile(new URL('global.css', stylesDirectory), 'utf8');
      const disabledPrimary = lastRuleForSelector(componentStyles, ':root button.primary:disabled', 'background');
      expect(disabledPrimary, `${theme.name}: final disabled primary rule`).toMatch(/background:\s*var\(--surface-3\)/);
      expect(disabledPrimary).toMatch(/color:\s*var\(--text-disabled,\s*var\(--text-dim\)\)/);

      for (const selector of [
        ":root input:not([type='checkbox']):not([type='radio']):disabled",
        ':root select:disabled',
        ':root textarea:disabled',
      ]) {
        const fieldRule = lastRuleForSelector(componentStyles, selector, 'background');
        expect(fieldRule, `${theme.name}: ${selector}`).toMatch(/background:\s*var\(--surface-3\)/);
        expect(fieldRule).toMatch(/color:\s*var\(--text-disabled,\s*var\(--text-dim\)\)/);
      }

      expect(globalStyles.indexOf("@import './global-foundation.css';")).toBeLessThan(
        globalStyles.indexOf("@import './global-components.css';"),
      );
    });
  }
});

describe('failure-state text contrast', () => {
  it('keeps desktop error alerts readable on the danger-tinted surface in dark and light themes', async () => {
    const css = await readFile(new URL('desktop.css', stylesDirectory), 'utf8');
    const alertRule = css.match(/:root\[data-ui='desktop'\] \.desktop-main :is\(\[role='alert'\], div\.err\)\s*\{([^}]*)\}/);
    expect(alertRule, 'desktop failure alert style').not.toBeNull();
    expect(alertRule![1]).toMatch(/color:\s*var\(--text-danger\)/);
    expect(alertRule![1]).toMatch(/background:\s*color-mix\(in srgb, var\(--color-danger\) 10%, var\(--surface-raised\)\)/);

    const palettes = [
      { name: 'Desktop dark', selector: ":root[data-ui='desktop']" },
      { name: 'Desktop light', selector: ":root[data-ui='desktop'][data-theme='light']" },
    ] as const;

    for (const palette of palettes) {
      const tokens = readRootTokens(css, palette.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const raisedSurface = parseColor(tokens['--surface-2']);
      const danger = parseColor(tokens['--danger']);
      const dangerText = parseColor(tokens['--text-danger']);
      expect(baseSurface, `${palette.name} needs a base surface`).not.toBeNull();
      expect(raisedSurface, `${palette.name} needs an alert surface`).not.toBeNull();
      expect(danger, `${palette.name} needs a danger color`).not.toBeNull();
      expect(dangerText, `${palette.name} needs danger text`).not.toBeNull();

      const surface = composite(raisedSurface!, baseSurface!);
      const failureSurface = mixSrgb(danger!, surface, 0.1);
      const ratio = contrastRatio(composite(dangerText!, failureSurface), failureSurface);
      expect(ratio, `${palette.name}: error text on danger alert is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('global focus ring token', () => {
  it('provides a theme-aware focus color when a theme does not override it', async () => {
    const css = await readFile(new URL('global-tokens.css', stylesDirectory), 'utf8');
    const tokens = readRootTokens(css, ':root');
    expect(tokens['--focus-ring-color']).toBe('var(--text-accent)');
  });
});

describe('base primary action contrast', () => {
  it('uses theme foreground tokens and keeps default dark/light accents readable', async () => {
    const foundation = await readFile(new URL('global-foundation.css', stylesDirectory), 'utf8');
    const tokenAliases = await readFile(new URL('global-tokens.css', stylesDirectory), 'utf8');
    const darkTokens = readRootTokens(foundation, ':root');
    const lightTokens = readRootTokens(foundation, ":root[data-base='light']");
    const globalAliases = readRootTokens(tokenAliases, ':root');

    expect(foundation).toMatch(/button\.primary\s*\{[^}]*background:\s*var\(--color-accent,\s*var\(--accent\)\)[^}]*color:\s*var\(--on-accent\)/s);
    expect(globalAliases['--on-accent']).toBeUndefined();

    for (const [name, tokens] of [['dark', darkTokens], ['light', lightTokens]] as const) {
      const accent = parseColor(tokens['--accent']);
      const foreground = parseColor(tokens['--on-accent']);
      expect(accent, `${name} baseline needs an accent`).not.toBeNull();
      expect(foreground, `${name} baseline needs an on-accent foreground`).not.toBeNull();
      expect(contrastRatio(foreground!, accent!), `${name} primary action contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('shell semantic warning colors', () => {
  it('uses the theme-aware warning text token for the sidebar banner', async () => {
    const css = await readFile(new URL('shell-sidebar.css', stylesDirectory), 'utf8');
    const banner = css.match(/:root\[data-shell='sidebar'\] \.banner\s*\{([^}]*)\}/);

    expect(banner, 'sidebar warning banner rule').not.toBeNull();
    expect(banner![1]).toContain('color: var(--text-warn)');
    expect(banner![1]).not.toMatch(/color:\s*#[\da-f]{3,8}/i);
  });
});

describe('dualbar shell theme contrast wiring', () => {
  it('pairs legacy shell foregrounds, surfaces, and boundaries through semantic tokens', async () => {
    const css = await readFile(new URL('shell-dualbar.css', stylesDirectory), 'utf8');
    const lastRule = (selector: string): string => {
      const matches = [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g'))];
      return matches.at(-1)?.[1] ?? '';
    };

    const header = lastRule(":root\\[data-shell='dualbar'\\] \\.bb-head");
    expect(header).toMatch(/background:\s*var\(--surface-1\)/);
    expect(header).toMatch(/border-bottom:\s*1px\s+solid\s+var\(--text-dim\)/);

    const navigation = lastRule(":root\\[data-shell='dualbar'\\] \\.bb-tab");
    expect(navigation).toMatch(/color:\s*var\(--text-dim\)/);
    const selectedNavigation = lastRule(":root\\[data-shell='dualbar'\\] \\.bb-tab\\.active");
    expect(selectedNavigation).toMatch(/background:\s*var\(--color-accent\)/);
    expect(selectedNavigation).toMatch(/color:\s*var\(--on-accent\)/);

    const categoryPanel = lastRule(":root\\[data-shell='dualbar'\\] \\.cascade");
    expect(categoryPanel).toMatch(/background:\s*var\(--surface-2\)/);
    expect(categoryPanel).toMatch(/border:\s*1px\s+solid\s+var\(--text-dim\)/);

    const mediaCard = lastRule(":root\\[data-shell='dualbar'\\] \\.card-media \\.card");
    expect(mediaCard).toMatch(/background:\s*var\(--surface-2\)/);
    expect(mediaCard).toMatch(/border:\s*1px\s+solid\s+var\(--text-dim\)/);

    const spotlight = lastRule(":root\\[data-shell='dualbar'\\] \\.spot");
    expect(spotlight).toMatch(/--surface-1/);
    expect(spotlight).toMatch(/--accent/);
    expect(spotlight).toMatch(/border:\s*1px\s+solid\s+var\(--text-dim\)/);
    expect(lastRule(":root\\[data-shell='dualbar'\\] \\.spot-veil")).toMatch(/var\(--surface-0\)/);
    expect(lastRule(":root\\[data-shell='dualbar'\\] \\.spot-title")).toMatch(/color:\s*var\(--text\)/);

    const playerChrome = lastRule(":root\\[data-shell='dualbar'\\]:not\\(\\[data-mpv\\]\\) \\.app\\.pwin\\.pvwin \\.mini-strip");
    expect(playerChrome).toMatch(/background:\s*var\(--surface-1\)/);
    expect(playerChrome).toMatch(/color:\s*var\(--text\)/);
  });

  it('keeps semantic text and control boundaries readable on dark and light base palettes', async () => {
    const css = await readFile(new URL('global-foundation.css', stylesDirectory), 'utf8');
    const palettes = [
      { name: 'dark base', selector: ':root' },
      { name: 'light base', selector: ":root[data-base='light']" },
    ] as const;

    for (const palette of palettes) {
      const tokens = readRootTokens(css, palette.selector);
      const baseSurface = parseColor(tokens['--surface-0']);
      const controlText = parseColor(tokens['--text-dim']);
      const bodyText = parseColor(tokens['--text']);
      expect(baseSurface, `${palette.name} needs a base surface`).not.toBeNull();
      expect(controlText, `${palette.name} needs control text`).not.toBeNull();
      expect(bodyText, `${palette.name} needs body text`).not.toBeNull();

      for (const surfaceToken of surfaceTokens) {
        const rawSurface = parseColor(tokens[surfaceToken]);
        expect(rawSurface, `${palette.name} needs ${surfaceToken}`).not.toBeNull();
        const surface = composite(rawSurface!, baseSurface!);
        expect(contrastRatio(bodyText!, surface), `${palette.name}: --text on ${surfaceToken}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(controlText!, surface), `${palette.name}: --text-dim on ${surfaceToken}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(controlText!, surface), `${palette.name}: --text-dim boundary on ${surfaceToken}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('remaining shell theme contrast wiring', () => {
  it('uses semantic foreground and surface tokens for topbar shell chrome', async () => {
    const css = await readFile(new URL('shell-topbar.css', stylesDirectory), 'utf8');
    const navLink = lastRuleForSelector(css, ":root[data-shell='topbar'] .nf-link.active");
    expect(navLink).toMatch(/color:\s*var\(--text\)/);

    const pageButton = lastRuleForSelector(css, ':root[data-shell=\'topbar\'] .topbar button');
    expect(pageButton).toMatch(/background:\s*var\(--surface-2\)/);
    expect(pageButton).toMatch(/border:\s*1px\s+solid\s+var\(--border\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='topbar'] .tag")).toMatch(/color:\s*var\(--text\)/);

    const fields = lastRuleForSelector(css, ":root[data-shell='topbar'] textarea", 'background');
    expect(fields).toMatch(/background:\s*var\(--surface-2\)/);
    expect(fields).toMatch(/color:\s*var\(--text\)/);
    expect(fields).toMatch(/border:\s*1px\s+solid\s+var\(--border\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='topbar'] select:focus")).toMatch(/var\(--accent-soft\)/);
  });

  it('uses semantic foreground and surface tokens for sidebar navigation, fields, and popovers', async () => {
    const css = await readFile(new URL('shell-sidebar.css', stylesDirectory), 'utf8');
    expect(lastRuleForSelector(css, ":root[data-shell='sidebar'] .ap-toolbar")).toMatch(/background:\s*var\(--surface-glass\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='sidebar'] .ap-sidebar")).toMatch(/background:\s*var\(--surface-1\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='sidebar'] .ap-navbtn")).toMatch(/color:\s*var\(--text\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='sidebar'] .back-btn")).toMatch(/background:\s*var\(--surface-2\)/);

    const fields = lastRuleForSelector(css, ":root[data-shell='sidebar'] textarea", 'background');
    expect(fields).toMatch(/background:\s*var\(--surface-2\)/);
    expect(fields).toMatch(/color:\s*var\(--text\)/);
    const popover = lastRuleForSelector(css, ":root[data-shell='sidebar'] .srcpick-pop");
    expect(popover).toMatch(/background:\s*var\(--surface-3\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='sidebar'] .banner")).toMatch(/color:\s*var\(--text-warn\)/);
  });

  it('keeps pillbar navigation, media cards, filters, and spotlight readable across base palettes', async () => {
    const css = await readFile(new URL('shell-pillbar.css', stylesDirectory), 'utf8');
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .db-head")).toMatch(/background:\s*var\(--surface-glass\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .db-nav")).toMatch(/background:\s*var\(--surface-2\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .db-fab-orb")).toMatch(/color:\s*var\(--text\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .card-media .name")).toMatch(/color:\s*var\(--text\)/);
    expect(lastRuleForSelector(css, ":root[data-filter='card'] .db-filters")).toMatch(/background:\s*var\(--surface-2\)/);
    expect(lastRuleForSelector(css, ":root[data-detail='poster'] .db-hero")).toMatch(/background:\s*var\(--surface-2\)/);

    const spotlight = lastRuleForSelector(css, ":root[data-shell='pillbar'] .spot");
    expect(spotlight).toMatch(/background:\s*var\(--surface-2\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .spot-title")).toMatch(/color:\s*var\(--text\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .spot-meta")).toMatch(/color:\s*var\(--text-dim\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] .spot-veil")).toMatch(/var\(--surface-0\)/);

    const fields = lastRuleForSelector(css, ":root[data-shell='pillbar'] textarea", 'background');
    expect(fields).toMatch(/background:\s*var\(--surface-2\)/);
    expect(fields).toMatch(/color:\s*var\(--text\)/);
    expect(lastRuleForSelector(css, ":root[data-shell='pillbar'] select:focus")).toMatch(/var\(--accent-soft\)/);
  });
});

describe('native option popup readability', () => {
  it('sets explicit themed foreground, surface, selected, and disabled colors outside desktop mode', async () => {
    const css = await readFile(new URL('global-foundation.css', stylesDirectory), 'utf8');

    expect(css).toMatch(/:root\s+:where\(option,\s*optgroup\)\s*\{[^}]*color:\s*var\(--text-primary,\s*var\(--text\)\)/s);
    expect(css).toMatch(/:root\s+:where\(option,\s*optgroup\)\s*\{[^}]*background-color:\s*var\(--surface-elevated,\s*var\(--surface-3\)\)/s);
    expect(css).toMatch(/:root\s+option:checked\s*\{[^}]*color:\s*var\(--on-accent\)[^}]*background-color:\s*var\(--accent\)/s);
    expect(css).toMatch(/:root\s+option:disabled\s*\{[^}]*color:\s*var\(--text-disabled,\s*var\(--text-dim\)\)/s);
  });
});

describe('disabled control readability', () => {
  it('gives the runtime-sync retry button a token-based disabled surface without dimming', async () => {
    const css = await readFile(new URL('global-components.css', stylesDirectory), 'utf8');
    const rule = css.match(/\.config-runtime-sync-notice > button:disabled\s*\{([^}]*)\}/);

    expect(rule, 'runtime-sync retry disabled style').not.toBeNull();
    expect(rule![1]).toMatch(/opacity:\s*1\b/);
    expect(rule![1]).toMatch(/color:\s*var\(--text-disabled\)/);
    expect(rule![1]).toMatch(/background:\s*var\(--surface-3\)/);
    expect(rule![1]).toMatch(/border:\s*1px\s+solid\s+var\(--border\)/);
  });

  it('does not dim disabled controls with element opacity', async () => {
    const files = (await readdir(stylesDirectory)).filter((file) => file.endsWith('.css'));
    const dimmedRules: string[] = [];

    for (const file of files) {
      const css = (await readFile(new URL(file, stylesDirectory), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, rawSelector, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rawSelector.replace(/:not\([^)]*\)/g, '');
        if (!/:disabled\b/.test(selector)) continue;

        const opacity = declarations.match(/\bopacity\s*:\s*([\d.]+)/i)?.[1];
        if (opacity !== undefined && Number(opacity) < 1) {
          dimmedRules.push(`${file}: ${rawSelector.trim()} uses opacity ${opacity}`);
        }
      }
    }

    expect(dimmedRules).toEqual([]);
  });
});
