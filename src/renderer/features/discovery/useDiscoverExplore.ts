import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePageActive } from '../../lib/keepAlive';
import { ALL_TAG, BUILTIN_VOCAB, DISCOVER_MEDIA, type DiscoverMediaId, type ExploreVocabulary } from '../../../shared/discover';
import type { DiscoverItem } from '../../../shared/types';
import type { CascadeLevel, CascadeOption } from '../../components/CascadeBarView';
import { DISCOVER_BATCH_SIZE, DISCOVER_MAX_ITEMS, loadDiscoverExploreBatch } from './application/discoverExploreUseCase';
import type { DiscoverExplorePort } from './application/discoveryPorts';

export function useDiscoverExplore(load: () => void, port: DiscoverExplorePort) {
  const [vocab, setVocab] = useState<ExploreVocabulary>(BUILTIN_VOCAB);
  /** 一级「分类」：null = 未选（此时展示榜单） */
  const [media, setMedia] = useState<DiscoverMediaId | null>(null);
  /** 各维度已选值（维度名 → 选项文本；`全部` = 不参与筛选）；缺失 = 该级未选、不展开下级 */
  const [dims, setDims] = useState<Record<string, string>>({});
  const [sortId, setSortId] = useState('');
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [bLoading, setBLoading] = useState(false);
  const [bErr, setBErr] = useState('');
  const [errorPhase, setErrorPhase] = useState<'initial' | 'more' | 'refresh'>('initial');
  const reqRef = useRef(0);
  const itemsRef = useRef<DiscoverItem[]>([]);
  const cursor = useRef({ key: '', next: 0, count: 0, loading: false });
  const [hasMore, setHasMore] = useState(false);

  const [format, setFormat] = useState<'movie' | 'tv'>('tv');
  const location = useLocation();
  const active = usePageActive();
  const appliedLocation = useRef('');
  const requestedMedia = DISCOVER_MEDIA.find(option => option.id === new URLSearchParams(location.search).get('media'))?.id;
  useEffect(() => {
    const destination = location.key + location.pathname + location.search;
    if (!active || location.pathname !== '/' || !requestedMedia || appliedLocation.current === destination) return;
    appliedLocation.current = destination;
    setMedia(requestedMedia); setDims({}); setFormat('tv');
  }, [active, location.pathname, location.search, location.key, requestedMedia]);
  const baseMediaOpt = DISCOVER_MEDIA.find(m => m.id === media) || null;
  const mediaOpt = baseMediaOpt?.formats ? { ...baseMediaOpt, mediaType: format } : baseMediaOpt;
  const mediaType: 'movie' | 'tv' = mediaOpt?.mediaType || 'movie';
  useEffect(() => {
    let alive = true;
    const request = reqRef;
    void Promise.resolve().then(() => port.loadVocabulary()).then((value) => {
      if (!alive) return;
      setVocab(value);
      setSortId(previous => previous || value.movie.defaultSort);
    }).catch(() => undefined);
    return () => { alive = false; ++request.current; };
  }, [port]);
  /** 当前分类可用的维度（综艺没有「类型」——它本身就是类型） */
  const dimensions = useMemo(() => {
    if (!media) return [];
    const available = vocab[mediaType].dimensions;
    return media === 'movie' || media === 'tv' ? available : available.filter(d => d.key !== '类型');
  }, [vocab, media, mediaType]);
  const sorts = vocab[mediaType].sorts;

  /** 当前选择对应的豆瓣 tags（跳过「全部」） */
  const tagsOf = (sel: Record<string, string>): string[] =>
    [mediaOpt?.baseTag || '', ...Object.values(sel).filter(v => v && v !== ALL_TAG)].filter(Boolean);

  const queryKey = (sel: Record<string, string>): string => JSON.stringify([mediaType, tagsOf(sel), sortId]);
  const fetchPage = (pg: number, sel = dims, append = false): void => {
    if (!active || !media || !mediaOpt) return;
    const key = queryKey(sel);
    if (cursor.current.loading && cursor.current.key === key) return;
    const previous = { ...cursor.current };
    const preserving = !append && previous.key === key && previous.count > 0;
    const start = append ? cursor.current.next : (pg - 1) * DISCOVER_BATCH_SIZE;
    const id = ++reqRef.current;
    cursor.current = { ...cursor.current, key, next: start, loading: true };
    setBLoading(true); setBErr(''); setErrorPhase(preserving ? 'refresh' : append ? 'more' : 'initial');
    void (async () => {
      try {
        const result = await loadDiscoverExploreBatch(port, {
          query: { mediaType, tags: tagsOf(sel), ...(sortId ? { sort: sortId } : {}), ...(preserving ? { refresh: true } : {}) },
          start,
          existingItems: append ? itemsRef.current : [],
          initialTotal: total,
          preserveUntilComplete: preserving,
        }, snapshot => {
          if (id !== reqRef.current) return;
          itemsRef.current = snapshot.items;
          setItems(snapshot.items);
          cursor.current = { key, next: snapshot.nextStart, count: snapshot.items.length, loading: true };
          setTotal(snapshot.total); setPage(pg); setHasMore(snapshot.hasMore);
        });
        if (id !== reqRef.current) return;
        itemsRef.current = result.items; setItems(result.items);
        cursor.current = { key, next: result.nextStart, count: result.items.length, loading: false };
        setTotal(result.total); setPage(pg); setHasMore(result.hasMore);
        if (!result.items.length) setBErr('该分类暂无内容，可调整筛选后重试');
      } catch (error: unknown) {
        if (id !== reqRef.current) return;
        if (preserving) cursor.current = { ...previous, loading: false };
        setBErr(error instanceof Error ? error.message : '暂时无法加载分类内容');
      } finally {
        if (id === reqRef.current) { cursor.current.loading = false; setBLoading(false); }
      }
    })();
  };
  const loadMore = (): void => { if (hasMore && !bLoading) fetchPage(page + 1, dims, true); };
  const retryPage = (): void => { if (errorPhase === 'refresh') fetchPage(1); else if (itemsRef.current.length) fetchPage(page + 1, dims, true); else fetchPage(1); };

  useEffect(() => {
    if (!active) { ++reqRef.current; cursor.current.loading = false; setBLoading(false); return; }
    if (!media) {
      ++reqRef.current; itemsRef.current = []; cursor.current = { key: '', next: 0, count: 0, loading: false };
      setItems([]); setPage(1); setTotal(0); setBErr(''); setBLoading(false); setHasMore(false); return;
    }
    const key = queryKey(dims);
    if (cursor.current.key === key && (cursor.current.count > 0 || cursor.current.loading)) return;
    ++reqRef.current; itemsRef.current = []; cursor.current = { key, next: 0, count: 0, loading: false };
    setItems([]); setPage(1); setTotal(0); setHasMore(false);
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, format, dims, sortId, active]);

  /** 级联点选：同级再点 = 取消（同时清掉其下各维度，保证「上级一变，下级重来」） */
  const onPick = (levelKey: string, id: string): void => {
    if (levelKey === 'media') {
      setMedia(media === id ? null : id as DiscoverMediaId);
      setDims({});
      setFormat('tv');
      return;
    }
    if (levelKey === 'format' && (id === 'movie' || id === 'tv')) { setFormat(id); setDims({}); return; }
    if (levelKey === 'sort') { setSortId(id); return; }
    const order: string[] = dimensions.map(d => d.key);
    const idx = order.indexOf(levelKey);
    const next: Record<string, string> = {};
    for (let i = 0; i < idx; i++) {
      const k = order[i];
      if (dims[k] !== undefined) next[k] = dims[k];
    }
    if (dims[levelKey] !== id) next[levelKey] = id;
    setDims(next);
  };

  const backToRecommend = (): void => {
    setMedia(null); setDims({});
    void load();
  };

  /** 级联各级：**只把该出现的级放进来**（上一级选定后才出现），即「点击后才展开下级分类」 */
  const levels: CascadeLevel[] = [{ key: 'media', label: '分类', value: media, options: DISCOVER_MEDIA.map(m => ({ id: m.id, label: m.name })) }];
  {
    if (mediaOpt?.formats) levels.push({ key: 'format', label: '形式', value: format, options: mediaOpt.formats.map(id => ({ id, label: id === 'movie' ? '电影' : '剧集' })) });
    let prevChosen = media !== null;
    for (const d of dimensions) {
      if (!prevChosen) break;
      const v = dims[d.key];
      levels.push({
        key: d.key,
        label: d.label,
        value: v === undefined ? null : v,
        options: d.values.filter(x => x !== ALL_TAG).map(x => ({ id: x, label: x })) as CascadeOption[],
        allLabel: ALL_TAG,
      });
      prevChosen = v !== undefined;
    }
    if (prevChosen && sorts && sorts.length) {
      levels.push({ key: 'sort', label: '排序', value: sortId, options: sorts.map(s => ({ id: s.id, label: s.label })) });
    }
  }

  /** 当前选择的摘要（「电影 · 喜剧 · 中国大陆 · 2024 · 综合排序」），不写废话 */
  const summary = ((): string => {
    if (!mediaOpt) return '';
    const parts = [mediaOpt.name];
    if (mediaOpt.formats) parts.push(mediaType === 'movie' ? '电影' : '剧集');
    for (const d of dimensions) {
      const v = dims[d.key];
      if (v !== undefined) parts.push(v === ALL_TAG ? `全部${d.label}` : v);
    }
    const s = sorts?.find(x => x.id === sortId);
    if (s) parts.push(s.label);
    return parts.join(' · ');
  })();

  const totalPages = Math.max(1, Math.ceil(Math.min(total, DISCOVER_MAX_ITEMS) / DISCOVER_BATCH_SIZE));

  return { media, mediaOpt, items, page, totalPages, total, hasMore, loading: bLoading, error: bErr, errorPhase, levels, summary, onPick, fetchPage, loadMore, retryPage, refreshPage: () => fetchPage(1), backToRecommend };
}
