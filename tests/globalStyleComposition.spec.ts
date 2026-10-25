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
    ]);
    expect(css).toContain('@layer reset, legacy, tokens, base, components, layouts, utilities, desktop;');
    expect(css.indexOf('@layer legacy {')).toBeLessThan(css.indexOf('@layer tokens {'));
    expect(css.indexOf('@layer tokens {')).toBeLessThan(css.indexOf('@layer components {'));
    expect(css.indexOf('@layer components {')).toBeLessThan(css.indexOf('@layer layouts {'));
    expect(css.lastIndexOf(':root[data-shell] .vp-rate-menu button.vp-rate-option {'))
      .toBeGreaterThan(css.indexOf('@layer layouts {'));
  });
});
