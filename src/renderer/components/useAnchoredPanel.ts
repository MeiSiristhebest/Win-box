import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/** Position a body portal next to its trigger and keep it inside the viewport. */
export function useAnchoredPanel(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  width: number,
  side: 'top' | 'bottom' = 'bottom',
  align: 'start' | 'end' = 'end',
): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const panelWidth = Math.min(width, window.innerWidth - margin * 2);
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const placeAbove = side === 'top' ? above >= Math.min(200, below) : below < Math.min(200, above);
      const left = align === 'start' ? rect.left : rect.right - panelWidth;
      setPosition({
        position: 'fixed',
        visibility: 'visible',
        left: Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin)),
        right: 'auto',
        top: placeAbove ? 'auto' : rect.bottom + gap,
        bottom: placeAbove ? window.innerHeight - rect.top + gap : 'auto',
        width: panelWidth,
        minWidth: 0,
        maxWidth: panelWidth,
        maxHeight: Math.max(0, placeAbove ? above : below),
        transformOrigin: placeAbove ? 'bottom center' : 'top center',
      });
    };
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) update();
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchorRef, panelRef, width, side, align]);

  return position;
}
