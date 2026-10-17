import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../../api/client';
import type { DiscoverGenre, DiscoverItem, DiscoverSection } from '../../../shared/types';

type DiscoverMedia = 'movie' | 'tv';

export function useDiscoverController() {
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

  const fetchSections = useCallback((): Promise<void> => {
    return client
      .metaDiscover(false)
      .then((nextSections) => {
        if (nextSections.length) setSections(nextSections);
        else setSections(previous => previous?.length ? previous : nextSections);
        if (nextSections.length === 0) setErr('榜单暂时获取失败，请稍后重试；如已配置 TMDB，请检查自己的凭据和网络');
      })
      .catch((e: unknown) => setErr((e as Error).message));
  }, []);

  const load = useCallback((): void => {
    setLoading(true);
    setErr('');
    void fetchSections().finally(() => setLoading(false));
  }, [fetchSections]);

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
    void fetchSections().finally(() => setLoading(false));
    void client.metaGenres().then(setGenres).catch(() => undefined);
  }, [fetchSections]);

  const loadGenre = useCallback((genre: DiscoverGenre, page: number, mediaType: DiscoverMedia | null = media): void => {
    if (!mediaType) return;
    const requestId = ++genreRequest.current;
    setGSel(genre);
    setGPage(page);
    setGLoading(true);
    setGenreError('');
    setGItems([]);
    void client
      .metaGenrePage(mediaType, genre.id, page)
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
  }, [media]);

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
