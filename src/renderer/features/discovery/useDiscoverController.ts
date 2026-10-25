import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoverGenre, DiscoverItem, DiscoverSection } from '../../../shared/types';
import type { DiscoverLandingPort } from './application/discoveryPorts';

type DiscoverMedia = 'movie' | 'tv';

export function useDiscoverController(port: DiscoverLandingPort) {
  const [sections, setSections] = useState<DiscoverSection[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [media, setMedia] = useState<DiscoverMedia | null>(null);
  const [genres, setGenres] = useState<{ movie: DiscoverGenre[]; tv: DiscoverGenre[] }>({ movie: [], tv: [] });
  const [gSel, setGSel] = useState<DiscoverGenre | null>(null);
  const [gPage, setGPage] = useState(1);
  const [gItems, setGItems] = useState<DiscoverItem[]>([]);
  const [gTotal, setGTotal] = useState(1);
  const [gLoading, setGLoading] = useState(false);
  const [genreError, setGenreError] = useState('');
  const genreRequest = useRef(0);
  const autoRetriedRef = useRef(false);
  const sectionsRequest = useRef(0);

  const fetchSections = useCallback((refresh = false): Promise<void> => {
    const requestId = ++sectionsRequest.current;
    return port.loadSections(refresh).then(nextSections => {
      if (requestId !== sectionsRequest.current) return;
      if (nextSections.length) { setSections(nextSections); setErr(''); }
      else {
        setSections(previous => previous?.length ? previous : nextSections);
        setErr('本次推荐未能加载，请稍后重试或检查元数据来源设置');
      }
    }).catch((error: unknown) => {
      if (requestId === sectionsRequest.current) setErr(error instanceof Error ? error.message : '推荐加载失败');
    }).finally(() => {
      if (requestId === sectionsRequest.current) setLoading(false);
    });
  }, [port]);

  const load = useCallback((): void => { setLoading(true); setErr(''); void fetchSections(true); }, [fetchSections]);

  const retry = useCallback((): void => {
    autoRetriedRef.current = true;
    load();
  }, [load]);

  useEffect(() => {
    if (loading || sections === null || sections.length > 0 || autoRetriedRef.current) return;
    autoRetriedRef.current = true;
    const timer = setTimeout(load, 1200);
    return () => clearTimeout(timer);
  }, [load, loading, sections]);

  useEffect(() => {
    void fetchSections();
    void port.loadGenres().then(setGenres).catch(() => undefined);
  }, [fetchSections, port]);

  const loadGenre = useCallback((genre: DiscoverGenre, page: number, mediaType: DiscoverMedia | null = media): void => {
    if (!mediaType) return;
    const requestId = ++genreRequest.current;
    setGSel(genre);
    setGPage(page);
    setGLoading(true);
    setGenreError('');
    setGItems([]);
    void port
      .loadGenrePage(mediaType, genre.id, page)
      .then((result) => {
        if (requestId !== genreRequest.current) return;
        setGItems(result.items);
        setGTotal(result.totalPages);
        if (!result.items.length) setGenreError('该分类暂时无法获取，请稍后重试');
      })
      .catch(() => {
        if (requestId !== genreRequest.current) return;
        setGenreError('分类请求失败，请稍后重试');
        setGTotal(1);
      })
      .finally(() => {
        if (requestId === genreRequest.current) setGLoading(false);
      });
  }, [media, port]);

  const switchMedia = useCallback((nextMedia: DiscoverMedia): void => {
    ++genreRequest.current;
    setGLoading(false);
    setMedia(media === nextMedia ? null : nextMedia);
    setGSel(null);
    setGItems([]);
    setGTotal(1);
  }, [media]);

  const backToRecommend = useCallback((): void => {
    ++genreRequest.current;
    setGLoading(false);
    setGSel(null);
    setGItems([]);
  }, []);

  const genreList = media === 'movie' ? genres.movie : media === 'tv' ? genres.tv : [];
  const hasGenres = genres.movie.length > 0 || genres.tv.length > 0;

  return {
    sections,
    err,
    loading,
    media,
    genres,
    gSel,
    gPage,
    gItems,
    gTotal,
    gLoading,
    genreError,
    load,
    retry,
    loadGenre,
    switchMedia,
    backToRecommend,
    genreList,
    hasGenres,
  };
}
