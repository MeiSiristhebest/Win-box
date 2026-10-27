import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readGlobalStyleComposition } from './helpers/globalStyles';

const DESKTOP_STYLES = new URL('../src/renderer/styles/desktop.css', import.meta.url);

function readRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing CSS rule: ${selector}`).toBeGreaterThanOrEqual(0);

  const bodyStart = css.indexOf('{', start) + 1;
  let depth = 1;
  for (let index = bodyStart; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(bodyStart, index);
  }

  throw new Error(`unterminated CSS rule: ${selector}`);
}

describe('player control style architecture', () => {
  it('keeps one compact shared play/pause style without shell overrides', async () => {
    const { css } = await readGlobalStyleComposition();
    const selector = '.vplayer > .vp-big';
    const rule = readRule(css, selector);

    expect(css.match(/\.vplayer > \.vp-big\s*\{/g) ?? []).toHaveLength(1);
    expect(css.match(/\.vplayer > \.vp-big:active\s*\{/g) ?? []).toHaveLength(1);
    expect(rule).toMatch(/\bwidth\s*:\s*40px\s*;/);
    expect(rule).toMatch(/\bheight\s*:\s*40px\s*;/);
    expect(rule).toMatch(/\bbackdrop-filter\s*:\s*none\s*;/);

    for (const shell of ['topbar', 'dualbar', 'sidebar', 'pillbar']) {
      expect(css).not.toContain(`:root[data-shell='${shell}'] .vp-big {`);
    }

    expect(css).not.toMatch(/大号中央播放键|中央大播放键|80px 大键/);
  });

  it('keeps the desktop player control compact and free of backdrop blur', async () => {
    const css = await readFile(DESKTOP_STYLES, 'utf8');
    expect(css).not.toMatch(/:root\[data-ui='desktop'\]\s+\.vplayer\s+\.vp-big\s*\{/);
    const { css: sharedCss } = await readGlobalStyleComposition();
    const rule = readRule(sharedCss, '.vplayer > .vp-big');

    expect(rule).toMatch(/\bwidth\s*:\s*40px\s*;/);
    expect(rule).toMatch(/\bheight\s*:\s*40px\s*;/);
    expect(rule).toMatch(/\bbackdrop-filter\s*:\s*none\s*;/);
  });

  it('uses semantic contrast tokens for the playback-rate menu in every theme', async () => {
    const { css } = await readGlobalStyleComposition();
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
    const track = readRule(css, '.vp-vtrack::-webkit-slider-runnable-track');
    const thumb = readRule(css, '.vp-vtrack::-webkit-slider-thumb');
    const trackHeight = Number(track.match(/\bheight\s*:\s*([\d.]+)px/)?.[1]);
    const thumbHeight = Number(thumb.match(/\bheight\s*:\s*([\d.]+)px/)?.[1]);
    const thumbOffset = Number(thumb.match(/\bmargin-top\s*:\s*(-?[\d.]+)px/)?.[1]);

    expect(range).toMatch(/\bleft\s*:\s*50%/);
    expect(range).toMatch(/\btop\s*:\s*50%/);
    expect(range).toMatch(/\btransform\s*:\s*translate\(-50%,\s*-50%\) rotate\(-90deg\)/);
    expect(trackHeight).toBeGreaterThan(0);
    expect(thumbHeight).toBeGreaterThan(trackHeight);
    expect(thumbOffset).toBe(-((thumbHeight - trackHeight) / 2));
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

  it('keeps global drive provider tabs readable and visibly selected', async () => {
    const { css } = await readGlobalStyleComposition();
    const providerTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab']");
    const selectedTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab'][aria-selected='true'],\n:root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab'][data-selected='true']");
    const focusTab = readRule(css, ":root[data-theme] .drive-bind-dialog .drive-provider-list [role='tab']:focus-visible");

    expect(providerTab).toMatch(/color:\s*var\(--text-primary/);
    expect(providerTab).toMatch(/background:\s*var\(--surface-2/);
    expect(providerTab).toMatch(/opacity:\s*1\s*;/);
    expect(providerTab).toMatch(/min-height:\s*48px/);
    expect(selectedTab).toMatch(/color:\s*var\(--on-accent\)/);
    expect(selectedTab).toMatch(/background:\s*var\(--color-accent/);
    expect(focusTab).toMatch(/outline:\s*2px solid var\(--focus-ring-color\)/);
  });
});
