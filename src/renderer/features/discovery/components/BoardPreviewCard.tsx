import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiscoverItem } from '../../../../shared/types';
import { BOARD_CATEGORIES, boardSourceName, type DiscoverBoard } from '../../../../shared/discoverBoards';
import type { DiscoverBoardPreviewPort } from '../application/discoveryPorts';
import { useCovers } from '../../covers/useCovers';
import { discoverCoverItem } from '../../../components/DiscoverItemCard';
import { Icon } from '../../../components/ui/Icon';

export interface BoardPreview { items: DiscoverItem[]; stale?: boolean; total?: number | null }

export default function BoardPreviewCard({ board, seed, active, previewPort }: { board: DiscoverBoard; seed?: BoardPreview; active: boolean; previewPort: DiscoverBoardPreviewPort }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ data?: BoardPreview; error?: string }>({});
  useEffect(() => {
    if (!active || visible || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [active, visible]);
  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    void previewPort.loadPreview(board.id)
      .then(data => { if (!cancelled) setResult({ data }); })
      .catch(() => { if (!cancelled) setResult({ error: '预览暂不可用' }); });
    return () => { cancelled = true; };
  }, [active, visible, board.id, previewPort]);
  const preview = result.data || seed;
  const items = preview?.items.slice(0, 3) || [];
  const first = items[0];
  const cover = first ? discoverCoverItem(first) : undefined;
  const covers = useCovers(cover ? [cover] : [], active && visible, true);
  const poster = cover ? covers.picOf(cover) : '';
  const category = BOARD_CATEGORIES.find(option => option.id === board.category)?.label;
  return <Link ref={ref} className="board-preview-card" to={'/boards/' + encodeURIComponent(board.id)} aria-label={board.title}>
    <div className="board-preview-heading">
      <div><h3>{board.title}</h3><span className="board-preview-source">{boardSourceName(board)}{category && ' · ' + category}{preview?.total != null && ' · 共 ' + preview.total + ' 部'}{preview?.stale && ' · 缓存'}</span></div>
      <Icon name="right" size={15} />
    </div>
    <div className="board-preview-body" aria-busy={!preview && !result.error}>
      <div className="board-preview-cover">{poster && cover ? <img src={poster} alt="" loading="lazy" decoding="async" onError={event => covers.onError(cover, event.currentTarget.getAttribute('src') || '')} /> : <span>{preview || result.error ? '暂无封面' : ''}</span>}</div>
      {items.length > 0 ? <ol className="board-preview-list" aria-label="榜单预览">{items.map((item, index) => <li key={String(item.doubanId || item.tmdbId || item.title) + '-' + index}><span className="board-preview-number" aria-hidden="true">{index + 1}</span><span className="board-preview-name" title={item.title}>{item.title}</span>{item.rating ? <span className="board-preview-rating" aria-label={item.rating.toFixed(1) + ' 分'}>{item.rating.toFixed(1)}</span> : null}</li>)}</ol>
        : result.error || preview ? <span className="board-preview-unavailable">{result.error || '暂无预览'}<span>打开榜单查看</span></span>
          : <span className="board-preview-skeleton" aria-label="正在读取榜单预览"><i /><i /><i /></span>}
    </div>
  </Link>;
}
