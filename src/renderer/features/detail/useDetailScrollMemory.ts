import { useEffect, useLayoutEffect, type MutableRefObject } from 'react';
import type { VodDetail } from '../../../shared/types';
import type { DetailScrollMemoryPort } from './application/detailScrollMemory';

export interface DetailScrollMemoryInput {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  memoryKey: string;
  flag: string;
  episodeIndex: number;
  detail: VodDetail | null;
}

/** Keeps detail scroll restoration and persistence out of the page component. */
export function useDetailScrollMemory(input: DetailScrollMemoryInput, port: DetailScrollMemoryPort): void {
  const { containerRef, memoryKey, flag, episodeIndex, detail } = input;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rememberScroll = () => {
      port.rememberSelection(memoryKey, { flag, ep: episodeIndex, scrollTop: container.scrollTop });
    };
    container.addEventListener('scroll', rememberScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', rememberScroll);
      port.persistSelection();
    };
  }, [containerRef, episodeIndex, flag, memoryKey, port]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selection = port.readSelection(memoryKey);
    if (selection?.scrollTop) container.scrollTop = selection.scrollTop;
  }, [containerRef, detail, memoryKey, port]);
}
