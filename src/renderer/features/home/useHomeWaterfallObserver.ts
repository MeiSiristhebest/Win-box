import { useEffect, useLayoutEffect, useRef } from 'react';
import type { HomeWaterfallObserverPort } from './application/homeWaterfallObserverPort';

interface HomeWaterfallObserverOptions {
  active: boolean;
  refreshKey: string;
  rootRef: { current: HTMLDivElement | null };
  targetRef: { current: HTMLDivElement | null };
  onVisible: () => void;
  observer: HomeWaterfallObserverPort;
}

/** Owns the browser observer lifecycle while the browse controller owns page data and pagination. */
export function useHomeWaterfallObserver({ active, refreshKey, rootRef, targetRef, onVisible, observer }: HomeWaterfallObserverOptions): void {
  const onVisibleRef = useRef(onVisible);
  useLayoutEffect(() => { onVisibleRef.current = onVisible; }, [onVisible]);

  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    const target = targetRef.current;
    if (!root || !target) return;
    return observer.observe(root, target, () => onVisibleRef.current());
  }, [active, observer, refreshKey, rootRef, targetRef]);
}
