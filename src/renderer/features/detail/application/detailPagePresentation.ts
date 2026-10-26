export type DetailPageSurface = 'main-window' | 'detail-window';

export interface DetailPageChromeModel {
  showTopbar: boolean;
  title: string;
  backFallback: '/home';
}

/** Keep window-specific chrome decisions independent from React and Electron. */
export function detailPageChromeModel(surface: DetailPageSurface, displayName: string): DetailPageChromeModel {
  return {
    showTopbar: surface === 'main-window',
    title: displayName,
    backFallback: '/home',
  };
}
