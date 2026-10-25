import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDialog } from '../components/AppDialog';
import { createFavoritesPageAdapter } from '../features/favorites/adapters/favoritesPageAdapter';
import { favoriteCoverItem, type FavoritesPagePorts } from '../features/favorites/application/favoritesPage';
import { useFavoritesPagePresenter } from '../features/favorites/useFavoritesPagePresenter';
import { useCovers } from '../features/covers/useCovers';
import { FavoritesPageView } from './FavoritesPageView';

/** Composition root for the favorites workflow, renderer adapters and passive view. */
export default function FavoritesPage() {
  const dialog = useAppDialog();
  const navigate = useNavigate();
  const adapters = useMemo(() => createFavoritesPageAdapter(navigate), [navigate]);
  const ports = useMemo<FavoritesPagePorts>(() => ({
    ...adapters,
    confirmations: {
      confirmClearAll: (count) => dialog.confirm('清空全部 ' + count + ' 条收藏？', {
        title: '清空收藏',
        confirmLabel: '清空收藏',
        tone: 'danger',
      }),
    },
  }), [adapters, dialog]);
  const presenter = useFavoritesPagePresenter(ports);
  const coverItems = useMemo(() => presenter.filtered.map(favoriteCoverItem), [presenter.filtered]);
  const covers = useCovers(coverItems);

  return (
    <FavoritesPageView
      rows={presenter.rows}
      filtered={presenter.filtered}
      groups={presenter.groups}
      visibleGroups={presenter.visibleGroups}
      activeCategory={presenter.activeCategory}
      keyword={presenter.keyword}
      query={presenter.query}
      sort={presenter.sort}
      editing={presenter.editing}
      lastDeleted={presenter.lastDeleted}
      notice={presenter.notice}
      coverFor={(item) => covers.picOf(favoriteCoverItem(item))}
      onCoverError={(item, url) => covers.onError(favoriteCoverItem(item), url)}
      onQueryChange={presenter.setQuery}
      onSortChange={presenter.setSort}
      onSelectCategory={presenter.setCategory}
      onOpenDetail={(item) => { void presenter.openDetail(item); }}
      onRemove={presenter.remove}
      onClearAll={() => { void presenter.clearAll(); }}
      onUndoRemove={presenter.undoRemove}
      onDismissDeleted={presenter.dismissDeleted}
      onDismissNotice={presenter.dismissNotice}
      onStartEdit={presenter.startEdit}
      onSaveEdit={presenter.saveEdit}
      onSetEditTitle={presenter.setEditTitle}
      onSetEditNote={presenter.setEditNote}
      onCancelEdit={presenter.cancelEdit}
      onBrowse={() => navigate('/home')}
    />
  );
}
