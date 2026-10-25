import { useCallback, useState } from 'react';
import { EP_PAGE_SIZE, clampEpPage } from '../../lib/epPager';

type PagingState = {
  open: boolean;
  current: number;
  episodeCount: number;
  page: number;
};

type PlayerEpisodePanelOptions = {
  current: number;
  episodeCount: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelect: (index: number) => void;
};

function pageForEpisode(index: number, episodeCount: number): number {
  return clampEpPage(Math.floor(Math.max(0, index) / EP_PAGE_SIZE), episodeCount);
}

/** Owns episode-panel paging and its synchronization with the selected episode. */
export function usePlayerEpisodePanelPresenter({ current, episodeCount, open, setOpen, onSelect }: PlayerEpisodePanelOptions) {
  const [paging, setPaging] = useState<PagingState>(() => ({
    open,
    current,
    episodeCount,
    page: pageForEpisode(current, episodeCount),
  }));

  const opening = open && !paging.open;
  const selectionChangedWhileOpen = open && paging.current !== current;
  const countChanged = paging.episodeCount !== episodeCount;
  if (paging.open !== open || selectionChangedWhileOpen || countChanged) {
    setPaging({
      open,
      current,
      episodeCount,
      page: opening || selectionChangedWhileOpen
        ? pageForEpisode(current, episodeCount)
        : clampEpPage(paging.page, episodeCount),
    });
  }

  const setPage = useCallback((page: number) => {
    setPaging({ open, current, episodeCount, page: clampEpPage(page, episodeCount) });
  }, [current, episodeCount, open]);
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const selectEpisode = useCallback((index: number) => {
    setPaging({ open, current: index, episodeCount, page: pageForEpisode(index, episodeCount) });
    onSelect(index);
  }, [episodeCount, onSelect, open]);

  return { page: paging.page, setPage, toggle, close, selectEpisode };
}
