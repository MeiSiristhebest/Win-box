import { useRef } from 'react';
import type { Episode } from '../../../shared/types';
import { formatEpisodeLabel } from '../../lib/epName';
import { epPageRanges, epPageSlice } from '../../lib/epPager';

type DetailEpisodeListProps = {
  episodes: readonly Episode[];
  page: number;
  selectedEpisode: number;
  onPageChange: (page: number) => void;
  onChooseEpisode: (episodeIndex: number) => void;
  onPlayEpisode: (episodeIndex: number) => void;
};

export function DetailEpisodeList({
  episodes,
  page,
  selectedEpisode,
  onPageChange,
  onChooseEpisode,
  onPlayEpisode,
}: DetailEpisodeListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const paged = epPageSlice(episodes, page);

  function goToPage(nextPage: number): void {
    onPageChange(nextPage);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => listRef.current?.scrollIntoView?.({ block: 'start' }));
    }
  }

  return (
    <>
      {paged.pageCount > 1 && (
        <section className="quick-picks ep-ranges" aria-label="集数区间">
          {epPageRanges(episodes.length).map((range) => (
            <button
              type="button"
              key={range.page}
              className={`tag ui-action ${paged.page === range.page ? 'active' : ''}`}
              aria-pressed={paged.page === range.page}
              onClick={() => goToPage(range.page)}
            >
              {range.label}
            </button>
          ))}
        </section>
      )}
      <div className="ep-list" ref={listRef}>
        {paged.items.map((episode, index) => {
          const globalIndex = paged.start + index;
          return (
            <button
              type="button"
              key={globalIndex}
              className={`ep ui-action ${globalIndex === selectedEpisode ? 'active' : ''}`}
              aria-pressed={globalIndex === selectedEpisode}
              onClick={() => onChooseEpisode(globalIndex)}
              onDoubleClick={() => onPlayEpisode(globalIndex)}
              title={`${episode.name || episode.url}（单击选择，双击播放）`}
            >
              {formatEpisodeLabel(episode.name, globalIndex)}
            </button>
          );
        })}
      </div>
    </>
  );
}
