import { useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../../api/client';
import { ALL_TAG, DISCOVER_MEDIA, type DiscoverMediaId, type ExploreVocabulary } from '../../../shared/discover';
import type { DiscoverItem } from '../../../shared/types';
import type { CascadeLevel, CascadeOption } from '../../components/CascadeBar';
const PAGE_SIZE = 20;
const MAX_TOTAL = 500;

export function useDiscoverExplore(load: () => void) {
  const [vocab, setVocab] = useState<ExploreVocabulary | null>(null);
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
  const reqRef = useRef(0);

  const mediaOpt = DISCOVER_MEDIA.find(m => m.id === media) || null;
  const mediaType: 'movie' | 'tv' = mediaOpt?.mediaType || 'movie';
  useEffect(() => {
    let alive = true;
    const request = reqRef;
    void Promise.resolve().then(() => client.metaExploreVocab()).then((value) => {
      if (!alive) return;
      setVocab(value);
      setSortId(previous => previous || value.movie.defaultSort);
    }).catch(() => undefined);
    return () => { alive = false; ++request.current; };
  }, []);
  /** 当前分类可用的维度（综艺没有「类型」——它本身就是类型） */
  const dimensions = useMemo(() => {
    if (!vocab || !media) return [];
    if (media === 'movie') return vocab.movie.dimensions;
    if (media === 'tv') return vocab.tv.dimensions;
    return vocab.tv.dimensions.filter(d => d.key !== '类型');
  }, [vocab, media]);
  const sorts = media === 'tv' || media === 'variety' ? vocab?.tv.sorts : vocab?.movie.sorts;

  /** 当前选择对应的豆瓣 tags（跳过「全部」） */
  const tagsOf = (sel: Record<string, string>): string[] =>
    [mediaOpt?.baseTag || '', ...Object.values(sel).filter(v => v && v !== ALL_TAG)].filter(Boolean);

  const fetchPage = (pg: number, sel = dims): void => {
    if (!media || !mediaOpt) return;
    const id = ++reqRef.current;
    setBLoading(true);
    setBErr('');
    client
      .metaDiscoverQuery({
        mediaType,
        tags: tagsOf(sel),
        ...(sortId ? { sort: sortId } : {}),
        start: (pg - 1) * PAGE_SIZE,
        count: PAGE_SIZE,
      })
      .then((r) => {
        if (id !== reqRef.current) return;
        setItems(r.items);
        setTotal(r.total);
        setPage(pg);
        if (r.items.length === 0) setBErr('该组合暂无结果，可放宽「类型 / 地区 / 年代」，或换一种「排序」再试');
      })
      .catch(() => { if (id === reqRef.current) { setItems([]); setBErr('豆瓣分类请求失败，请稍后重试'); } })
      .finally(() => { if (id === reqRef.current) setBLoading(false); });
  };

  /** 筛选变化 → 从第 1 页重取（★ 逐级点击才走到这里：每级选定都会即时出结果） */
  useEffect(() => {
    if (!media) {
      ++reqRef.current;
      setItems([]); setPage(1); setTotal(0); setBErr(''); setBLoading(false);
      return;
    }
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, dims, sortId]);

  /** 级联点选：同级再点 = 取消（同时清掉其下各维度，保证「上级一变，下级重来」） */
  const onPick = (levelKey: string, id: string): void => {
    if (levelKey === 'media') {
      setMedia(media === id ? null : id as DiscoverMediaId);
      setDims({});
      return;
    }
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
    for (const d of dimensions) {
      const v = dims[d.key];
      if (v !== undefined) parts.push(v === ALL_TAG ? `全部${d.label}` : v);
    }
    const s = sorts?.find(x => x.id === sortId);
    if (s) parts.push(s.label);
    return parts.join(' · ');
  })();

  const totalPages = Math.max(1, Math.ceil(Math.min(total, MAX_TOTAL) / PAGE_SIZE));

  return { media, mediaOpt, items, page, totalPages, loading: bLoading, error: bErr, levels, summary, onPick, fetchPage, backToRecommend };
}
