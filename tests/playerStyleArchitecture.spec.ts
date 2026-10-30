import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readGlobalStyleComposition } from './helpers/globalStyles';

const DESKTOP_STYLES = new URL('../src/renderer/styles/desktop.css', import.meta.url);

function readRule(css: string, selector: string): string {
  const normalizedCss = css.replace(/\r\n?/g, '\n');
  const normalizedSelector = selector.replace(/\r\n?/g, '\n');
  const start = normalizedCss.indexOf(`${normalizedSelector} {`);
  expect(start, `missing CSS rule: ${normalizedSelector}`).toBeGreaterThanOrEqual(0);

  const bodyStart = normalizedCss.indexOf('{', start) + 1;
  let depth = 1;
  for (let index = bodyStart; index < normalizedCss.length; index += 1) {
    if (normalizedCss[index] === '{') depth += 1;
    if (normalizedCss[index] === '}') depth -= 1;
    if (depth === 0) return normalizedCss.slice(bodyStart, index);
  }

  throw new Error(`unterminated CSS rule: ${normalizedSelector}`);
}

describe('player control style architecture', () => {
  it('matches grouped selectors with Windows line endings', () => {
    const css = '.first,\r\n.second {\r\n  color: red;\r\n}';
    expect(readRule(css, '.first,\n.second')).toContain('color: red;');
  });

  it('uses named native groups for the player toolbar without fieldset browser spacing', async () => {
    const { css } = await readGlobalStyleComposition();
    const toolbar = await readFile(new URL('../src/renderer/features/playback/PlayerControlsBar.tsx', import.meta.url), 'utf8');
    const group = readRule(css, '.vp-bar-group');

    expect(toolbar.match(/<fieldset className="vp-bar-group" aria-label=/g) ?? []).toHaveLength(4);
    expect(toolbar).not.toContain('role="group"');
    expect(group).toMatch(/margin:\s*0/);
    expect(group).toMatch(/padding:\s*0/);
    expect(group).toMatch(/border:\s*0/);
  });

  it('keeps MPV mode labels and the playback clock from collapsing in a full toolbar', async () => {
    const { imports, css } = await readGlobalStyleComposition();
    const toolbar = await readFile(new URL('../src/renderer/features/playback/PlayerControlsBar.tsx', import.meta.url), 'utf8');
    const kernelControl = await readFile(new URL('../src/renderer/features/playback/PlayerKernelControl.tsx', import.meta.url), 'utf8');
    const controls = readRule(css, ':root[data-shell] .vplayer .vp-ctl.vp-kernel,\n:root[data-shell] .vplayer .vp-ctl.vp-ctl-label');
    const label = readRule(css, ':root[data-shell] .vplayer .vp-kernel-tag');
    const time = readRule(css, ':root[data-shell] .vplayer .vp-bar .vp-time');
    const compactToolbar = readRule(css, ':root[data-shell] .vplayer .vp-bar');

    expect(imports.at(-1)).toBe('player-toolbar-cascade.css');
    expect(controls).toMatch(/flex:\s*0 0 auto/);
    expect(controls).toMatch(/width:\s*auto/);
    expect(controls).toMatch(/min-width:\s*34px/);
    expect(controls).toMatch(/white-space:\s*nowrap/);
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(time).toMatch(/flex:\s*0 0 auto/);
    expect(time).toMatch(/white-space:\s*nowrap/);
    expect(compactToolbar).toMatch(/gap:\s*5px/);
    expect(kernelControl).toContain("className={'vp-ctl vp-kernel'");
    expect(toolbar.match(/className=\{'vp-ctl vp-ctl-label/g) ?? []).toHaveLength(2);
  });

  it('keeps player titlebar icons visible and playback hit targets stable when selected', async () => {
    const { imports, css } = await readGlobalStyleComposition();
    const titlebar = readRule(css, ':root[data-theme][data-theme] .app.pwin.pvwin .player-titlebar .tb-controls .tb-btn');
    const toolbarIcon = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-bar-group .vp-ctl:not(.vp-rate):not(.vp-ctl-label):not(.vp-kernel)');

    expect(imports.at(-1)).toBe('player-toolbar-cascade.css');
    expect(titlebar).toMatch(/background:\s*rgb\(24 28 35 \/ 96%\)/);
    expect(titlebar).toMatch(/color:\s*#f4f6fa/);
    expect(titlebar).toMatch(/flex:\s*0 0 38px/);
    expect(titlebar).not.toMatch(/:not\(\[data-mpv\]\)/);
    expect(toolbarIcon).toMatch(/flex:\s*0 0 36px/);
    expect(toolbarIcon).toMatch(/min-width:\s*36px/);
    expect(css).toContain(':root[data-theme][data-theme] .vplayer .vp-bar-group .vp-ctl:is(.vp-on, [aria-expanded=\'true\'], [aria-pressed=\'true\']):not(.vp-rate):not(.vp-ctl-label):not(.vp-kernel)');
  });

  it('gives the danmaku settings panel readable labels, text and selected controls', async () => {
    const { css } = await readGlobalStyleComposition();
    const row = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-row');
    const label = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-label');
    const button = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-btn,\n:root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vp-panel-toggle');
    const selected = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-btn:is(.active, [aria-pressed=\'true\']),\n:root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vp-panel-toggle[aria-pressed=\'true\']');
    const message = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-message');
    const primary = readRule(css, ':root[data-theme][data-theme] .vplayer .vp-subpanel.vp-dmpanel .vsp-btn.primary');

    expect(row).toMatch(/flex-wrap:\s*nowrap/);
    expect(label).toMatch(/flex:\s*0 0 56px/);
    expect(label).toMatch(/white-space:\s*nowrap/);
    expect(button).toMatch(/font:\s*600 14px/);
    expect(button).toMatch(/min-height:\s*36px/);
    expect(selected).toMatch(/border:\s*2px solid/);
    expect(selected).not.toMatch(/content:\s*["']✓/);
    expect(message).toMatch(/text-overflow:\s*ellipsis/);
    expect(primary).toMatch(/background:\s*var\(--color-accent/);
  });

  it('keeps paused play feedback compact and immune to global shell button styles', async () => {
    const { imports, css } = await readGlobalStyleComposition();
    const selector = ':root[data-theme] .vplayer > .vp-big';
    const rule = readRule(css, selector);
    const feedbackStyle = await readFile(new URL('../src/renderer/styles/player-feedback.css', import.meta.url), 'utf8');
    const statusOverlay = await readFile(new URL('../src/renderer/features/playback/PlayerStatusOverlays.tsx', import.meta.url), 'utf8');
    const icon = readRule(css, ':root[data-theme] .vplayer > .vp-big svg');

    expect(imports.at(-2)).toBe('player-feedback.css');
    expect(feedbackStyle.replace(/\/\*[\s\S]*?\*\//g, '').trimStart()).not.toMatch(/^@layer\b/);
    expect(css.match(/:root\[data-theme\] \.vplayer > \.vp-big\s*\{/g) ?? []).toHaveLength(1);
    expect(css).not.toMatch(/(?:^|\n)\s*\.vplayer > \.vp-big\s*\{/);
    expect(statusOverlay).toMatch(/paused\s*&&\s*!mini\s*&&\s*!episodePanelOpen/);
    expect(statusOverlay).toContain('className="vp-big"');
    expect(statusOverlay).toContain('<svg width="14" height="14"');
    expect(icon).toMatch(/\bwidth\s*:\s*14px\s*;/);
    expect(icon).toMatch(/\bheight\s*:\s*14px\s*;/);
    expect(statusOverlay).toContain('d="M8 5.5v13l11-6.5z"');
    expect(rule).toMatch(/\bwidth\s*:\s*28px\s*;/);
    expect(rule).toMatch(/\bheight\s*:\s*28px\s*;/);
    expect(rule).toMatch(/\bborder-radius\s*:\s*50%\s*;/);
    expect(rule).toMatch(/\bbox-shadow\s*:\s*none\s*;/);
    expect(rule).toMatch(/\bbackground\s*:\s*#14171d\s*;/);
    expect(rule).toMatch(/\bbackdrop-filter\s*:\s*none\s*;/);
    expect(rule).toMatch(/-webkit-backdrop-filter\s*:\s*none\s*;/);

    for (const shell of ['topbar', 'dualbar', 'sidebar', 'pillbar']) {
      expect(css).not.toContain(`:root[data-shell='${shell}'] .vp-big {`);
    }

    expect(css).not.toMatch(/大号中央播放键|中央大播放键|80px 大键/);
  });

  it('keeps unlayered player feedback rules after shell-specific button rules', async () => {
    const css = await readFile(DESKTOP_STYLES, 'utf8');
    expect(css).not.toMatch(/:root\[data-ui='desktop'\]\s+\.vplayer\s+\.vp-big\s*\{/);
    const { css: sharedCss } = await readGlobalStyleComposition();
    const rule = readRule(sharedCss, ':root[data-theme] .vplayer > .vp-big');

    expect(sharedCss.lastIndexOf(":root[data-shell='pillbar'] button {")).toBeLessThan(sharedCss.lastIndexOf(':root[data-theme] .vplayer > .vp-big {'));
    expect(rule).toMatch(/\bwidth\s*:\s*28px\s*;/);
    expect(rule).toMatch(/\bheight\s*:\s*28px\s*;/);
    expect(rule).toMatch(/\bbackdrop-filter\s*:\s*none\s*;/);
  });

  it('uses semantic contrast tokens for the playback-rate menu in every theme', async () => {
    const { css } = await readGlobalStyleComposition();
    const rateCascade = await readFile(new URL('../src/renderer/styles/player-rate-cascade.css', import.meta.url), 'utf8');
    const trigger = readRule(css, '.vp-ctl.vp-rate');
    const menu = readRule(css, '.vp-rate-menu');
    const option = readRule(css, '.vp-rate-option');
    const selected = readRule(css, '.vp-rate-option.selected, .vp-rate-option[aria-checked=\'true\']');

    expect(trigger).toMatch(/color:\s*var\(--text-primary/);
    expect(trigger).toMatch(/background:\s*var\(--surface-elevated/);
    expect(menu).toMatch(/color:\s*var\(--text-primary/);
    expect(menu).toMatch(/background:\s*var\(--surface-elevated/);
    expect(option).toMatch(/color:\s*var\(--text-primary/);
    expect(selected).toMatch(/color:\s*var\(--on-accent/);
    expect(selected).toMatch(/background:\s*var\(--color-accent/);
    expect(`${trigger}${menu}${option}${selected}`).not.toMatch(/#[\da-f]{3,8}/i);

    const shellReset = css.lastIndexOf(":root[data-shell='pillbar'] button {");
    const themedOption = readRule(css, ':root[data-shell] .vp-rate-menu button.vp-rate-option');
    const themedHover = readRule(css, ':root[data-shell] .vp-rate-menu button.vp-rate-option:hover');
    const themedSelected = readRule(css, ":root[data-shell] .vp-rate-menu button.vp-rate-option.selected,\n:root[data-shell] .vp-rate-menu button.vp-rate-option[aria-checked='true']");
    const themedFocus = readRule(css, ':root[data-shell] .vp-rate-menu button.vp-rate-option:focus-visible');

    expect(css.lastIndexOf(':root[data-shell] .vp-rate-menu button.vp-rate-option {')).toBeGreaterThan(shellReset);
    expect(themedOption).toMatch(/color:\s*var\(--text-primary/);
    expect(themedOption).toMatch(/background:\s*transparent/);
    expect(themedHover).toMatch(/background:\s*color-mix/);
    expect(themedSelected).toMatch(/color:\s*var\(--on-accent\)/);
    expect(themedSelected).toMatch(/background:\s*var\(--color-accent/);
    expect(themedFocus).toMatch(/outline:\s*2px solid var\(--focus-ring-color/);

    const unlayeredRateCascade = rateCascade.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(unlayeredRateCascade).not.toMatch(/@layer\b/);
    expect(unlayeredRateCascade).toMatch(/:root\[data-shell\] \.vplayer \.vp-rate-menu\s*\{[^}]*color:\s*var\(--text-primary/);
    expect(unlayeredRateCascade).toMatch(/:root\[data-shell\] \.vplayer \.vp-rate-menu\s*\{[^}]*background:\s*var\(--surface-elevated/);
    expect(unlayeredRateCascade).toMatch(/:root\[data-shell\] \.vp-rate-menu button\.vp-rate-option\s*\{[^}]*color:\s*var\(--text-primary/);
  });

  it('keeps media loading text readable over the brightest video frame', async () => {
    const { css } = await readGlobalStyleComposition();
    const status = readRule(css, '.vp-loading .vp-load-text');
    const background = status.match(/background:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/i);
    const opacity = Number(background?.[1]);

    expect(status).toMatch(/color:\s*var\(--on-media\)/);
    expect(status).toMatch(/padding:\s*5px\s+10px/);
    expect(status).toMatch(/border-radius:\s*999px/);
    expect(background, 'loading status needs an opaque dark surface').not.toBeNull();
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(1);

    // Worst case: white text and an underlying pure-white frame.
    const remainingWhite = 1 - opacity;
    const linearBackground = remainingWhite <= 0.04045
      ? remainingWhite / 12.92
      : ((remainingWhite + 0.055) / 1.055) ** 2.4;
    const contrast = 1.05 / (linearBackground + 0.05);
    expect(contrast, 'status text must meet WCAG AA on a bright frame').toBeGreaterThanOrEqual(4.5);
  });

  it('keeps technical badges readable over the brightest video frame', async () => {
    const { css } = await readGlobalStyleComposition();
    const row = readRule(css, '.vp-tech');
    const badge = readRule(css, '.vp-tech-chip');
    const background = badge.match(/background:\s*rgba\(9,\s*11,\s*15,\s*([\d.]+)\)/i);
    const opacity = Number(background?.[1]);

    expect(row).toMatch(/color:\s*var\(--on-media/);
    expect(background, 'technical badges need a dark media-safe surface').not.toBeNull();
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(1);

    // Worst case: the badge is over a pure-white video frame and uses opaque white text.
    const backdrop = [9, 11, 15].map((channel) => channel * opacity + 255 * (1 - opacity));
    const linearBackground = backdrop.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const backgroundLuminance = 0.2126 * linearBackground[0] + 0.7152 * linearBackground[1] + 0.0722 * linearBackground[2];
    const contrast = 1.05 / (backgroundLuminance + 0.05);
    expect(contrast, 'badge text must meet WCAG AA on a bright frame').toBeGreaterThanOrEqual(4.5);
  });

  it('keeps mini-player title and controls readable without dimming the whole strip', async () => {
    const { css } = await readGlobalStyleComposition();
    const strip = readRule(css, '.mini-strip');
    const button = readRule(css, '.mini-btn');
    const hover = readRule(css, '.mini-btn:hover');
    const closeHover = readRule(css, '.mini-strip-close:hover');

    expect(strip).toMatch(/color:\s*var\(--on-media/);
    expect(strip).not.toMatch(/opacity\s*:/);
    expect(css).not.toMatch(/\.mini-strip:hover\s*\{[^}]*opacity/s);
    expect(button).toMatch(/color:\s*inherit/);
    expect(hover).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(hover).toMatch(/color:\s*var\(--text-accent/);
    expect(closeHover).toMatch(/background:\s*var\(--danger\)/);
    expect(closeHover).toMatch(/color:\s*var\(--on-danger\)/);

    for (const shell of ['dualbar', 'pillbar']) {
      expect(css).toContain(`:root[data-shell='${shell}']:not([data-mpv]) .app.pwin.pvwin .mini-strip`);
    }
  });

  it('centers the volume thumb on the rotated vertical track', async () => {
    const { css } = await readGlobalStyleComposition();
    const range = readRule(css, '.vp-vtrack');
    const shellSafeRange = readRule(css, '.vplayer .vp-vol .vp-vpanel input.vp-vtrack');
    const desktopRange = readRule(css, ":root[data-ui='desktop'] .vplayer .vp-vol .vp-vpanel input.vp-vtrack");
    const track = readRule(css, '.vp-vtrack::-webkit-slider-runnable-track');
    const thumb = readRule(css, '.vp-vtrack::-webkit-slider-thumb');
    const trackHeight = Number(track.match(/\bheight\s*:\s*([\d.]+)px/)?.[1]);
    const thumbHeight = Number(thumb.match(/\bheight\s*:\s*([\d.]+)px/)?.[1]);
    const thumbOffset = Number(thumb.match(/\bmargin-top\s*:\s*(-?[\d.]+)px/)?.[1]);

    expect(range).toMatch(/\bwidth\s*:\s*92px\s*;/);
    expect(range).toMatch(/\bheight\s*:\s*16px\s*;/);
    expect(range).toMatch(/\bleft\s*:\s*50%/);
    expect(range).toMatch(/\btop\s*:\s*50%/);
    expect(range).toMatch(/\btransform\s*:\s*translate\(-50%,\s*-50%\) rotate\(-90deg\)/);
    expect(shellSafeRange).toMatch(/\bbackground\s*:\s*transparent/);
    expect(shellSafeRange).toMatch(/\bborder\s*:\s*0/);
    expect(shellSafeRange).toMatch(/\bbox-shadow\s*:\s*none/);
    expect(css).toMatch(/@layer reset,\s*legacy,\s*tokens,\s*base,\s*components,\s*layouts,\s*utilities,\s*desktop\s*;/);
    expect(css).toMatch(/@layer desktop\s*\{\s*:root\[data-ui='desktop'\] \.vplayer \.vp-vol \.vp-vpanel input\.vp-vtrack\s*\{/);
    expect(desktopRange).toMatch(/\bmin-height\s*:\s*0/);
    expect(desktopRange).toMatch(/\bbackground\s*:\s*transparent/);
    expect(desktopRange).toMatch(/\bborder\s*:\s*0/);
    expect(desktopRange).toMatch(/\bbox-shadow\s*:\s*none/);
    expect(track).toMatch(/\bwidth\s*:\s*100%\s*;/);
    expect(trackHeight).toBeGreaterThan(0);
    expect(thumbHeight).toBeGreaterThan(trackHeight);
    expect(thumbOffset).toBe(-((thumbHeight - trackHeight) / 2));
  });

  it('uses the theme contrast boundary for the unfilled volume rail in both engines', async () => {
    const { css } = await readGlobalStyleComposition();
    const webkitTrack = readRule(css, '.vp-vtrack::-webkit-slider-runnable-track');
    const firefoxTrack = readRule(css, '.vp-vtrack::-moz-range-track');

    expect(webkitTrack).toMatch(/var\(--border\)/);
    expect(firefoxTrack).toMatch(/background:\s*var\(--border\)/);
    expect(`${webkitTrack}${firefoxTrack}`).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0?\.48\)/i);
  });

  it('uses one readable semantic disabled style across player shells', async () => {
    const { css } = await readGlobalStyleComposition();
    const rules = css.match(/(?:^|\n)\.vp-ctl:disabled\s*\{/g) ?? [];
    const disabled = readRule(css, '.vp-ctl:disabled');
    const castItemDisabled = readRule(css, '.vp-citem:disabled');

    expect(rules, 'shell-specific opacity overrides must not hide disabled player controls').toHaveLength(1);
    expect(disabled).toMatch(/color:\s*#c5cedc/i);
    expect(disabled).toMatch(/opacity:\s*1\s*;/);
    expect(css).not.toMatch(/:root\[data-shell=['"](?:topbar|dualbar|sidebar|pillbar)['"]\]\s*\.vp-ctl:disabled\s*\{[^}]*rgba\(/s);
    expect(castItemDisabled).toMatch(/color:\s*var\(--text-disabled/);
    expect(castItemDisabled).toMatch(/opacity:\s*1\s*;/);
  });

  it('keeps the episode drawer opaque and uses theme text colors', async () => {
    const { css } = await readGlobalStyleComposition();
    const panel = readRule(css, ':root[data-theme] .vp-eppanel');
    const count = readRule(css, ':root[data-theme] .vp-epcount');
    const item = readRule(css, ':root[data-theme] .vp-epitem');
    const index = readRule(css, ':root[data-theme] .vp-epno');

    expect(panel).toMatch(/background:\s*var\(--surface-elevated/);
    expect(panel).toMatch(/backdrop-filter:\s*none/);
    expect(count).toMatch(/color:\s*var\(--text-secondary/);
    expect(item).toMatch(/color:\s*var\(--text-primary/);
    expect(index).toMatch(/color:\s*var\(--text-secondary/);
  });

  it('pairs the selected episode range tab with the theme accent foreground', async () => {
    const { css } = await readGlobalStyleComposition();
    const selected = readRule(css, ':root[data-theme] .vp-ep-range-tab.active');

    expect(selected).toMatch(/background:\s*var\(--color-accent,\s*var\(--accent/);
    expect(selected).toMatch(/color:\s*var\(--on-accent/);
    expect(selected).not.toMatch(/background:\s*var\(--text-accent/);
    expect(selected).not.toMatch(/color:\s*#fff/i);
  });

  it('keeps global drive provider tabs readable and visibly selected', async () => {
    const { css } = await readGlobalStyleComposition();
    const dialog = await readFile(new URL('../src/renderer/components/DriveBindModal.tsx', import.meta.url), 'utf8');
    const providerTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab']");
    const selectedTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab'][aria-selected='true'],\n:root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab'][data-selected='true']");
    const focusTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab']:focus-visible");

    expect(providerTab).toMatch(/color:\s*var\(--text-primary/);
    expect(providerTab).toMatch(/background:\s*var\(--surface-2/);
    expect(providerTab).toMatch(/opacity:\s*1\s*;/);
    expect(providerTab).toMatch(/min-height:\s*48px/);
    expect(dialog).toContain('PROVIDERS.map((p) => (');
    expect(dialog).toContain('未绑定');
    expect(dialog).not.toMatch(/<FluentTab\b[^>]*\bdisabled(?:\s|=|>)/s);
    expect(selectedTab).toMatch(/color:\s*var\(--on-accent\)/);
    expect(selectedTab).toMatch(/background:\s*var\(--color-accent/);
    expect(focusTab).toMatch(/outline:\s*2px solid var\(--focus-ring-color\)/);
  });
});
