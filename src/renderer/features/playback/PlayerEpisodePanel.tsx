import { useEffect, useState } from 'react';
import { EP_PAGE_SIZE, epPageRanges, epPageSlice } from '../../lib/epPager';

export function PlayerEpisodePanel({ episodes, current, open, title, onClose, onSelect }: {
  episodes: { name: string; url: string }[]; current: number; open: boolean; title: string; onClose(): void; onSelect(index: number): void;
}) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open) {
      const targetPage = Math.floor(Math.max(0, current) / EP_PAGE_SIZE);
      setPage(targetPage);
    }
  }, [open, current]);

  const paged = epPageSlice(episodes, page, EP_PAGE_SIZE);
  const ranges = epPageRanges(episodes.length, EP_PAGE_SIZE);

  return (
    <aside className={'vp-eppanel' + (open ? ' open' : '')} aria-hidden={!open} inert={!open}>
      <div className="vp-ephead">
        <span className="vp-eptitle" title={title}>{title}</span>
        <span className="vp-epcount">{current >= 0 ? (current + 1) + ' / ' + episodes.length : episodes.length + ' 集'}</span>
        <button type="button" className="vp-epclose" title="收起选集" onClick={onClose}>×</button>
      </div>
      {ranges.length > 1 && (
        <div className="vp-ep-ranges" role="tablist" aria-label="剧集分组">
          {ranges.map((range) => (
            <button
              key={range.page}
              type="button"
              role="tab"
              aria-selected={range.page === paged.page}
              className={'vp-ep-range-tab' + (range.page === paged.page ? ' active' : '')}
              onClick={() => setPage(range.page)}
            >
              {range.label}
            </button>
          ))}
        </div>
      )}
      <div className="vp-eplist">{paged.items.map((episode, index) => {
        const globalIndex = paged.start + index;
        return (
          <button
            key={globalIndex + ':' + episode.url}
            type="button"
            className={'vp-epitem' + (globalIndex === current ? ' cur' : '')}
            aria-pressed={globalIndex === current}
            title={episode.name || '第' + (globalIndex + 1) + '集'}
            onClick={() => { onSelect(globalIndex); onClose(); }}
          >
            <span className="vp-epno">{globalIndex + 1}</span>
            <span className="vp-epname">{episode.name || '第' + (globalIndex + 1) + '集'}</span>
          </button>
        );
      })}</div>
    </aside>
  );
}
