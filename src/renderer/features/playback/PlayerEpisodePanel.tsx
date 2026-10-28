import { useId, useRef, type KeyboardEvent } from 'react';
import { EP_PAGE_SIZE, epPageRanges, epPageSlice } from '../../lib/epPager';

export function PlayerEpisodePanel({ episodes, current, open, title, page, onClose, onSelect, onPageChange }: {
  episodes: { name: string; url: string }[]; current: number; open: boolean; title: string; page: number;
  onClose(): void; onSelect(index: number): void; onPageChange(page: number): void;
}) {
  const paged = epPageSlice(episodes, page, EP_PAGE_SIZE);
  const ranges = epPageRanges(episodes.length, EP_PAGE_SIZE);
  const id = useId();
  const rangeTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveRangeFocus(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let nextIndex: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % ranges.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + ranges.length) % ranges.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = ranges.length - 1;
    else return;

    event.preventDefault();
    const nextRange = ranges[nextIndex];
    onPageChange(nextRange.page);
    rangeTabRefs.current[nextIndex]?.focus();
  }

  const selectedRangeId = `${id}-range-${paged.page}`;
  const episodeListId = `${id}-episodes`;

  return (
    <aside className={'vp-eppanel' + (open ? ' open' : '')} aria-label="选集" aria-hidden={!open} inert={!open}>
      <div className="vp-ephead">
        <span className="vp-eptitle" title={title}>{title}</span>
        <span className="vp-epcount">{current >= 0 ? (current + 1) + ' / ' + episodes.length : episodes.length + ' 集'}</span>
        <button type="button" className="vp-epclose" title="收起选集" onClick={onClose}>×</button>
      </div>
      {ranges.length > 1 && (
        <div className="vp-ep-ranges" role="tablist" aria-label="剧集分组">
          {ranges.map((range, index) => (
            <button
              key={range.page}
              ref={(element) => { rangeTabRefs.current[index] = element; }}
              type="button"
              id={`${id}-range-${range.page}`}
              role="tab"
              aria-selected={range.page === paged.page}
              aria-controls={episodeListId}
              tabIndex={range.page === paged.page ? 0 : -1}
              className={'vp-ep-range-tab' + (range.page === paged.page ? ' active' : '')}
              onKeyDown={(event) => moveRangeFocus(event, index)}
              onClick={() => onPageChange(range.page)}
            >
              {range.label}
            </button>
          ))}
        </div>
      )}
      <div id={episodeListId} className="vp-eplist" role={ranges.length > 1 ? 'tabpanel' : undefined} aria-labelledby={ranges.length > 1 ? selectedRangeId : undefined} tabIndex={ranges.length > 1 ? 0 : undefined}>{paged.items.map((episode, index) => {
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
