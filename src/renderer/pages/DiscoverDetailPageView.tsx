import type { MetaExtra, MetaHit } from '../../shared/types';
import BackButton from '../components/BackButton';
import { MovieSourcesPanel } from '../features/detail/MovieSourcesPanel';

interface DiscoverDetailPageViewProps {
  title: string;
  year: string;
  type: string;
  rating: string;
  fallbackPoster: string;
  meta: MetaHit | null;
  extra: MetaExtra | null;
  loading: boolean;
  error: string;
}

export function DiscoverDetailPageView(props: DiscoverDetailPageViewProps) {
  const poster = props.meta?.poster || props.fallbackPoster;
  return <div className="content movie-detail-content">
    <BackButton fallback="/" />
    <section className="movie-overview" aria-label="影片资料">
      {poster && <img className="movie-overview-poster" src={poster} alt={props.title} />}
      <div><h1>{props.title || '影片详情'}</h1><p className="muted">{props.year} {props.type === 'tv' ? '剧集' : '电影'}{props.rating ? ` · 评分 ${props.rating}` : ''}</p>
        {props.extra?.genres.length ? <p>{props.extra.genres.join(' · ')}</p> : null}
        {props.extra?.directors.length ? <p>导演：{props.extra.directors.join('、')}</p> : null}
        {props.extra?.cast.length ? <p>主演：{props.extra.cast.slice(0, 12).map(person => person.name).join('、')}</p> : null}
        <p className="movie-overview-text">{props.meta?.overview || (props.loading ? '正在获取影片简介…' : props.error || '元数据来源暂未提供简介。请选择下方片源查看详情和剧集。')}</p>
      </div>
    </section>
    <MovieSourcesPanel key={props.title} title={props.title} poster={poster} />
  </div>;
}
