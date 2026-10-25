import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HomePageMemoryPort } from './application/homePageMemoryPort';
import type { HomeMutableCell } from './application/homePorts';

type HomePageMemorySessionOptions = {
  contentRef: { current: HTMLDivElement | null };
  memory: HomePageMemoryPort;
  keyRef: HomeMutableCell<string>;
  profileIdRef: HomeMutableCell<string>;
  restorePendingRef: HomeMutableCell<boolean>;
  items: unknown[];
  loading: boolean;
  categoryId: string;
  page: number;
  filters: Record<string, string>;
  waterfall: boolean;
  aggregateMode: boolean;
};

/** Keeps scroll DOM events and home browse restoration/persistence at the page lifecycle boundary. */
export function useHomePageMemorySession({
  contentRef,
  memory,
  keyRef,
  profileIdRef,
  restorePendingRef,
  items,
  loading,
  categoryId,
  page,
  filters,
  waterfall,
  aggregateMode,
}: HomePageMemorySessionOptions) {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const categoryIdRef = useRef(categoryId);
  const pageRef = useRef(page);
  const filtersRef = useRef(filters);

  useEffect(() => {
    categoryIdRef.current = categoryId;
    pageRef.current = page;
  }, [categoryId, page]);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const onScroll = (): void => {
      memory.update({ scrollTop: element.scrollTop });
      const visible = element.scrollTop > 520;
      setShowBackToTop((current) => current === visible ? current : visible);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      memory.update({
        scrollTop: element.scrollTop,
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- This mutable session cell is read at cleanup so the latest source selection is persisted.
        key: keyRef.current,
        // oxlint-disable-next-line react-hooks/exhaustive-deps -- This mutable session cell is read at cleanup so the latest profile is persisted.
        profileId: profileIdRef.current,
        tid: categoryIdRef.current,
        pg: pageRef.current,
        filters: filtersRef.current,
      });
      memory.persist();
    };
  }, [contentRef, keyRef, memory, profileIdRef]);

  useLayoutEffect(() => {
    if (!restorePendingRef.current || !contentRef.current) return;
    const top = memory.read().scrollTop;
    if (top > 0) contentRef.current.scrollTop = top;
    restorePendingRef.current = false;
  }, [contentRef, items, loading, memory, restorePendingRef]);

  const scrollToTop = useCallback(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [contentRef]);

  return {
    backToTop: {
      visible: waterfall && showBackToTop && !aggregateMode,
      onClick: scrollToTop,
    },
  };
}
