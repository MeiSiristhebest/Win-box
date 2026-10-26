import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetaSuggestion } from '../../../shared/meta';
import type { MovieHotList } from '../../../shared/types';
import type { SearchPanelPorts } from './application/searchPanel';

const SUGGESTION_DEBOUNCE_MS = 250;

export function useSearchPanelPresenter(ports: SearchPanelPorts) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hotList, setHotList] = useState<MovieHotList | null>(null);
  const [hotLoading, setHotLoading] = useState(false);
  const [hotAttempt, setHotAttempt] = useState(0);
  const [suggestions, setSuggestions] = useState<MetaSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void ports.recommendations.loadHotList()
      .then((result) => { if (active) setHotList(result); })
      .catch(() => undefined)
      .finally(() => { if (active) setHotLoading(false); });
    return () => { active = false; };
  }, [open, hotAttempt, ports]);

  useEffect(() => {
    let active = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    const term = query.trim();
    if (!open || !term) return;
    timer.current = window.setTimeout(() => {
      void ports.recommendations.suggest(term)
        .then((result) => { if (active) setSuggestions(result || []); })
        .catch(() => { if (active) setSuggestions([]); })
        .finally(() => { if (active) setSuggestionsLoading(false); });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      active = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [open, ports, query]);

  const show = useCallback(() => {
    setHistory(ports.history.load());
    setHotLoading(true);
    setSuggestions([]);
    setSuggestionsLoading(Boolean(query.trim()));
    setOpen(true);
  }, [ports, query]);

  const search = useCallback(async (value: string): Promise<void> => {
    const term = value.trim();
    if (!term) return;
    setHistory(ports.history.record(term));
    setOpen(false);
    setQuery('');
    setSuggestions([]);
    setSuggestionsLoading(false);
    try {
      await ports.navigation.openSearch(term);
    } catch (error) {
      setQuery(term);
      setSuggestions([]);
      setSuggestionsLoading(true);
      setHotLoading(true);
      setOpen(true);
      throw error;
    }
  }, [ports]);

  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setSuggestions([]);
    setSuggestionsLoading(Boolean(value.trim()));
  }, []);

  const removeHistory = useCallback((term: string) => {
    setHistory((current) => ports.history.remove(current, term));
  }, [ports]);

  const clearHistory = useCallback(() => {
    ports.history.clear();
    setHistory([]);
  }, [ports]);

  const retryHotList = useCallback(() => {
    setHotLoading(true);
    setHotAttempt((attempt) => attempt + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return {
    open,
    query,
    hotList,
    hotLoading,
    suggestions,
    suggestionsLoading,
    history,
    show,
    close,
    search,
    changeQuery,
    removeHistory,
    clearHistory,
    retryHotList,
  };
}
