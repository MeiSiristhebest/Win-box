import { useMemo } from 'react';
import { createSearchPanelAdapters } from '../features/search/adapters/searchPanelAdapters';
import { useSearchPanelPresenter } from '../features/search/useSearchPanelPresenter';
import { useAppDialog } from './AppDialog';
import { SearchPanelView } from './SearchPanelView';

/** Composition point for search recommendations, local history and search-window navigation. */
export default function SearchPanel({ bar = false }: { bar?: boolean }) {
  const dialog = useAppDialog();
  const ports = useMemo(() => createSearchPanelAdapters(), []);
  const presenter = useSearchPanelPresenter(ports);

  const search = (term: string): void => {
    void presenter.search(term).catch((cause) => {
      void dialog.alert(`无法打开搜索窗口：${cause instanceof Error ? cause.message : String(cause)}`, { title: '无法打开搜索窗口' });
    });
  };

  return (
    <SearchPanelView
      bar={bar}
      open={presenter.open}
      query={presenter.query}
      hotList={presenter.hotList}
      hotLoading={presenter.hotLoading}
      suggestions={presenter.suggestions}
      suggestionsLoading={presenter.suggestionsLoading}
      history={presenter.history}
      onShow={presenter.show}
      onClose={presenter.close}
      onSearch={search}
      onQueryChange={presenter.changeQuery}
      onRemoveHistory={presenter.removeHistory}
      onClearHistory={presenter.clearHistory}
      onRetryHotList={presenter.retryHotList}
    />
  );
}
