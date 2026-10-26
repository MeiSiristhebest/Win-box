import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDialog } from '../components/AppDialog';
import { createHistoryPageAdapters } from '../features/history/adapters/historyPageAdapters';
import { historyCoverItem, type HistoryPagePorts } from '../features/history/application/historyPage';
import { useHistoryPagePresenter } from '../features/history/useHistoryPagePresenter';
import type { WatchHistory } from '../lib/uiMemoryTypes';
import { useCovers } from '../features/covers/useCovers';
import { HistoryPageView } from './HistoryPageView';
import { usePosterSizePreference } from '../features/display/adapters/posterSizePreferenceAdapter';

/** Composition root: connects history use cases to renderer adapters and the passive page view. */
export default function HistoryPage() {
  const dialog = useAppDialog();
  const navigate = useNavigate();
  const ports = useMemo<HistoryPagePorts>(() => {
    const adapters = createHistoryPageAdapters(navigate);
    return {
      ...adapters,
      playback: {
        ...adapters.playback,
        confirmBuiltinFallback: (reason) => dialog.confirm(reason + '\n\n是否继续使用应用内播放器？', {
          title: '无法直接交给外部播放器',
          confirmLabel: '应用内播放',
          cancelLabel: '取消',
        }),
      },
      confirmations: {
        confirmClearAll: (count) => dialog.confirm('清空全部观看历史和播放进度？当前共 ' + count + ' 条。', {
          title: '清空观看历史',
          confirmLabel: '清空历史',
          tone: 'danger',
        }),
      },
    };
  }, [dialog, navigate]);
  const presenter = useHistoryPagePresenter(ports);
  const coverItems = useMemo(() => presenter.items.map(historyCoverItem), [presenter.items]);
  const covers = useCovers(coverItems);
  const posterSize = usePosterSizePreference();

  return (
    <HistoryPageView
      posterSize={posterSize.size}
      onPosterSizeChange={posterSize.changeSize}
      items={presenter.items}
      groups={presenter.groups}
      visibleGroups={presenter.visibleGroups}
      activeCategory={presenter.activeCategory}
      lastDeleted={presenter.lastDeleted}
      notice={presenter.notice}
      updated={presenter.updated}
      resumeCount={presenter.resumeCount}
      coverFor={(item) => covers.picOf(historyCoverItem(item))}
      onCoverError={(item, url) => covers.onError(historyCoverItem(item), url)}
      onSelectCategory={presenter.setCategory}
      onPlay={(item: WatchHistory) => { void presenter.play(item); }}
      onOpenDetail={(item: WatchHistory) => { void presenter.openDetail(item); }}
      onRemove={presenter.remove}
      onClearAll={() => { void presenter.clearAll(); }}
      onUndoRemove={presenter.undoRemove}
      onDismissDeleted={presenter.dismissDeleted}
      onDismissNotice={presenter.dismissNotice}
      onBrowse={() => navigate('/home')}
    />
  );
}
