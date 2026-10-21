import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { MetaExtra, MetaHit } from '../../shared/types';
import { client } from '../api/client';
import BackButton from '../components/BackButton';
import { MovieSourcesPanel } from '../features/detail/MovieSourcesPanel';
import '../features/discovery/movie.css';

export default function DiscoverDetailPage() {
  const [params] = useSearchParams();
  const name = params.get('name')?.trim() || '';
  const year = params.get('year') || '';
  const key = JSON.stringify([name, year]);
  const [metadata, setMetadata] = useState<{ key: string; meta: MetaHit | null; extra: MetaExtra | null; error: string } | null>(null);
  useEffect(() => {
    if (!name) return;
    let alive = true;
    void Promise.allSettled([client.metaSearch(name, year || undefined), client.metaExtra(name, year || undefined)]).then(([hit, details]) => {
      if (!alive) return;
      setMetadata({ key, meta: hit.status === 'fulfilled' ? hit.value : null, extra: details.status === 'fulfilled' ? details.value : null, error: hit.status === 'rejected' ? '影片简介暂时无法获取，仍可从下方选择片源。' : '' });
    });
    return () => { alive = false; };
  }, [name, year, key]);
  const current = metadata?.key === key ? metadata : null;
  const meta = current?.meta;
  const extra = current?.extra;
  const metaLoading = Boolean(name) && !current;
  const metaError = current?.error;
  const poster = meta?.poster || params.get('pic') || '';
  return <div className="content movie-detail-content">
    <BackButton fallback="/" />
    <section className="movie-overview" aria-label="影片资料">
      {poster && <img className="movie-overview-poster" src={poster} alt={name} />}
      <div><h1>{name || '影片详情'}</h1><p className="muted">{year} {params.get('type') === 'tv' ? '剧集' : '电影'}{params.get('rating') ? ` · 评分 ${params.get('rating')}` : ''}</p>
        {extra?.genres.length ? <p>{extra.genres.join(' · ')}</p> : null}
        {extra?.directors.length ? <p>导演：{extra.directors.join('、')}</p> : null}
        {extra?.cast.length ? <p>主演：{extra.cast.slice(0, 12).map(person => person.name).join('、')}</p> : null}
        <p className="movie-overview-text">{meta?.overview || (metaLoading ? '正在获取影片简介…' : metaError || '元数据来源暂未提供简介。请选择下方片源查看详情和剧集。')}</p>
      </div>
    </section>
    <MovieSourcesPanel key={name} title={name} />
  </div>;
}
