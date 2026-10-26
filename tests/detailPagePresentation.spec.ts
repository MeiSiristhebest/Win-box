import { describe, expect, it } from 'vitest';
import { detailPageChromeModel } from '../src/renderer/features/detail/application/detailPagePresentation';

describe('detailPageChromeModel', () => {
  it('shows the back/title bar in the primary window', () => {
    expect(detailPageChromeModel('main-window', 'Film')).toEqual({
      showTopbar: true,
      title: 'Film',
      backFallback: '/home',
    });
  });

  it('hides duplicate navigation chrome in a reused detail window', () => {
    expect(detailPageChromeModel('detail-window', 'Film')).toEqual({
      showTopbar: false,
      title: 'Film',
      backFallback: '/home',
    });
  });
});
