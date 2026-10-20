import { useLayoutEffect, useState, type RefObject } from 'react';
import { BOARD_PAGE_SIZE } from '../../../shared/discoverBoards';
import { usePageActive } from '../../lib/keepAlive';

export function useBoardPageCapacity(ref: RefObject<HTMLDivElement | null>): number {
  const active = usePageActive();
  const [capacity, setCapacity] = useState(40);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const style = getComputedStyle(element);
      const grid = element.querySelector<HTMLElement>('.board-items');
      const card = grid?.querySelector<HTMLElement>('.card-media');
      const root = getComputedStyle(document.documentElement);
      const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const poster = card?.getBoundingClientRect().width || parseFloat(root.getPropertyValue('--poster-width')) || 160;
      const gap = grid ? parseFloat(getComputedStyle(grid).columnGap) || 18 : 18;
      const columns = Math.max(1, Math.floor((width + gap) / (poster + gap)));
      const top = grid ? grid.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop : 180;
      const rowHeight = card?.getBoundingClientRect().height || poster * 1.5 + 53;
      const rows = Math.max(1, Math.ceil(Math.max(1, element.clientHeight - top) / (rowHeight + 22)));
      const next = Math.max(40, Math.min(120, Math.ceil(columns * rows / BOARD_PAGE_SIZE) * BOARD_PAGE_SIZE));
      setCapacity(previous => previous === next ? previous : next);
    };
    measure();
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const content = new MutationObserver(schedule);
    content.observe(element, { childList: true, subtree: true });
    const appearance = new MutationObserver(schedule);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-poster-size', 'data-theme'] });
    window.addEventListener('resize', schedule);
    schedule();
    return () => { resize.disconnect(); content.disconnect(); appearance.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, [active, ref]);
  return capacity;
}
