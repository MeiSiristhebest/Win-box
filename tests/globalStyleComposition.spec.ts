import { describe, expect, it } from 'vitest';
import { readGlobalStyleComposition } from './helpers/globalStyles';

describe('global stylesheet composition', () => {
  it('loads style responsibilities in cascade order', async () => {
    const { imports, css } = await readGlobalStyleComposition();

    expect(imports).toEqual([
      'global-foundation.css',
      'global-common.css',
      'global-player.css',
      'global-pages.css',
      'global-shell-base.css',
      'shell-topbar.css',
      'shell-dualbar.css',
      'shell-sidebar.css',
      'shell-pillbar.css',
      'global-tokens.css',
      'global-components.css',
      'global-layouts.css',
      'player-rate-cascade.css',
      'drive-account-cascade.css',
      'player-feedback.css',
    ]);
    expect(css).toContain('@layer reset, legacy, tokens, base, components, layouts, utilities, desktop;');
    expect(css.indexOf('@layer legacy {')).toBeLessThan(css.indexOf('@layer tokens {'));
    expect(css.indexOf('@layer tokens {')).toBeLessThan(css.indexOf('@layer components {'));
    expect(css.indexOf('@layer components {')).toBeLessThan(css.indexOf('@layer layouts {'));
    expect(css.lastIndexOf(':root[data-shell] .vp-rate-menu button.vp-rate-option {'))
      .toBeGreaterThan(css.indexOf('@layer layouts {'));
  });

  it('defines the pause affordance once in the final player feedback stylesheet', async () => {
    const { imports, css } = await readGlobalStyleComposition();
    const componentStart = css.indexOf('@layer components {');
    const selector = ':root[data-theme] .vplayer > .vp-big {';
    const ruleStart = css.lastIndexOf(selector);
    const ruleEnd = css.indexOf('}', ruleStart);
    const pauseRule = css.slice(ruleStart, ruleEnd);

    expect(imports.at(-1)).toBe('player-feedback.css');
    expect(ruleStart).toBeGreaterThan(componentStart);
    expect(pauseRule).toContain('width: 28px;');
    expect(pauseRule).toContain('height: 28px;');
    expect(pauseRule).toContain('border-radius: 50%;');
    expect(pauseRule).toContain('background: #14171d;');
    expect(pauseRule).toContain('padding: 0;');
    expect(pauseRule).toContain('backdrop-filter: none;');
    expect(pauseRule).toContain('-webkit-backdrop-filter: none;');
    expect(pauseRule).not.toMatch(/backdrop-filter:\s*blur\(/);
    expect(css.match(/:root\[data-theme\] \.vplayer > \.vp-big\s*\{/g)).toHaveLength(1);
    expect(css).not.toMatch(/(?:^|\n)\s*\.vplayer > \.vp-big\s*\{/);
    expect(css).not.toMatch(/:root\[data-shell=['"](?:topbar|dualbar|sidebar|pillbar)['"]\]\s+\.vp-big\s*\{/);
    expect(css).not.toContain('player-pause-cascade.css');
  });

  it('gives playback toggle and selected options a persistent non-color state', async () => {
    const { css } = await readGlobalStyleComposition();
    const toggleState = css.match(/\.vplayer \.vp-ctl:is\([^}]+\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionState = css.match(/\.vp-subpanel \.vsp-btn:is\([^}]+\)\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(toggleState).toContain('border: 1px solid var(--on-accent)');
    expect(toggleState).toContain('box-shadow: inset');
    expect(optionState).toContain('border: 2px solid var(--text-accent)');
    expect(optionState).toContain('font-weight: 700');
    expect(css).not.toMatch(/:root\[data-shell=['"](?:topbar|dualbar|sidebar|pillbar)['"]\]\s+\.vp-ctl\.vp-on/);
  });
});
