import type { DiscoverItem } from '../../shared/types';
import { Icon } from './ui/Icon';

export function discoverCoverItem(item: DiscoverItem) {
  return { id: String(item.doubanId || item.tmdbId || `${item.mediaType}:${item.title}`), name: item.title, year: item.year ? String(item.year) : undefined, pic: item.poster };
}

export default function DiscoverItemCard({ it, poster, onError, onOpen, card, ratingLabel = '评分' }: {
  it: DiscoverItem;
  poster: string;
  onError: (url: string) => void;
  onOpen: () => void;
  card: { hoverPlayClass: string | null; hoverPlaySize: number; yearBadge: boolean; yearBadgeClass: string };
  ratingLabel?: string;
}) {
  return <button type="button" className="card-media ui-action card-media-button"
    aria-label={`${it.title}${it.year ? ` (${it.year})` : ''}${it.rating ? `，${ratingLabel} ${it.rating.toFixed(1)}` : ''}，搜索片源`}
    title={`${it.title} · 搜索片源`} onClick={onOpen}>
    <div className="card">
      <div className="media-poster">
        {poster ? <img src={poster} alt={it.title} loading="lazy" decoding="async" onError={event => onError(event.currentTarget.getAttribute('src') || '')} /> : <div className="no-cover">暂无封面</div>}
        {card.hoverPlayClass && <span className={card.hoverPlayClass} aria-hidden="true"><Icon name="search" size={card.hoverPlaySize} /></span>}
        {card.yearBadge && it.year ? <span className={`badge ${card.yearBadgeClass}`}>{it.year}</span> : null}
        {it.rank ? <span className="discover-card-rank" aria-label={`原站排名第 ${it.rank} 名`}>#{it.rank}</span> : null}
        <span className="media-card-action" aria-hidden="true"><Icon name="search" size={19} /></span>
      </div>
      <div className="meta">
        <div className="name" title={it.title}>{it.title}</div>
        <div className="remarks discover-card-facts">
          {it.year && !card.yearBadge ? <span>{it.year}</span> : null}
          {it.rating ? <span className="discover-card-rating" title={`${ratingLabel}（满分 10 分）`}>{it.rating.toFixed(1)} 分</span> : null}
        </div>
      </div>
    </div>
  </button>;
}
