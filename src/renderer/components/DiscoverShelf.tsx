import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DiscoverPresentationView } from '../lib/presentationRegistry';
import HScrollRow from './HScrollRow';
import { Icon } from './ui/Icon';
import { Link } from 'react-router-dom';

export default function DiscoverShelf({ title, count, view, children, boardId }: {
  title: string;
  count: number;
  view: DiscoverPresentationView['row'];
  children: ReactNode;
  boardId: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });
  const updateEdges = useCallback(() => {
    const element = track.current;
    if (!element) return;
    const back = element.scrollLeft > 1;
    const forward = element.scrollLeft < element.scrollWidth - element.clientWidth - 1;
    setEdges(previous => previous.back === back && previous.forward === forward ? previous : { back, forward });
  }, []);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, updateEdges]);

  const scroll = (direction: number) => {
    const element = track.current;
    if (!element) return;
    const reduced = document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({ left: direction * element.clientWidth * .8, behavior: reduced ? 'auto' : 'smooth' });
  };

  return <section className={`discovery-shelf ${view.containerClass || ''}`} style={view.containerStyle} aria-label={title}>
    <header className="discovery-shelf-heading">
      <h2 className={view.titleClass}>{title}</h2>
      <div className="discovery-shelf-controls">
        <Link className="discovery-shelf-link" to={`/boards/${encodeURIComponent(boardId)}`} aria-label={`查看${title}列表`}>查看全部<Icon name="right" size={13} /></Link>
        <button type="button" aria-label={`向左浏览${title}`} disabled={!edges.back} onClick={() => scroll(-1)}><Icon name="left" size={15} /></button>
        <button type="button" aria-label={`向右浏览${title}`} disabled={!edges.forward} onClick={() => scroll(1)}><Icon name="right" size={15} /></button>
      </div>
    </header>
    <HScrollRow scrollRef={track} onScroll={updateEdges} className={`discovery-shelf-track ${view.scrollClass || ''}`} style={view.scrollStyle}>{children}</HScrollRow>
  </section>;
}
