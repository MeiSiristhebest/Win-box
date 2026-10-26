import type { HomeWaterfallObserverPort } from '../application/homeWaterfallObserverPort';

export const homeWaterfallObserverAdapter: HomeWaterfallObserverPort = {
  observe(root, target, onVisible) {
    if (typeof IntersectionObserver === 'undefined') return () => undefined;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) onVisible();
      },
      { root, rootMargin: '700px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  },
};
