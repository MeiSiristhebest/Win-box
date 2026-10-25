// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WatchHistory } from '../src/renderer/lib/uiMemoryTypes';
import { HistoryPageView } from '../src/renderer/pages/HistoryPageView';

vi.mock('../src/renderer/components/PosterSizeControl', () => ({ default: () => null }));
vi.mock('../src/renderer/components/PluginSlot', () => ({ default: () => null }));
vi.mock('../src/renderer/components/ui/Tabs', () => ({ Tabs: () => null }));

afterEach(cleanup);

const item: WatchHistory = {
  name: '示例剧 - 第01集',
  url: 'https://media.example/episode-1',
  rawUrl: 'https://source.example/episode-1',
  sourceName: '南风线路',
  sourceKey: 'source-a',
  profileId: 'profile-a',
  vodId: 'vod-1',
  time: 62,
  updatedAt: 1_729_500_000_000,
};

function renderHistory(historyItem: WatchHistory = item) {
  const onPlay = vi.fn();
  const onOpenDetail = vi.fn();
  const onRemove = vi.fn();
  const group = { key: 'profile-a:source-a', label: '主档案 - 南风线路', items: [historyItem] };
  const viewProps: Parameters<typeof HistoryPageView>[0] = {
    items: [historyItem],
    groups: [group],
    visibleGroups: [group],
    activeCategory: '',
    lastDeleted: null,
    notice: '',
    updated: {},
    resumeCount: 1,
    coverFor: () => '',
    onCoverError: () => undefined,
    onSelectCategory: () => undefined,
    onPlay,
    onOpenDetail,
    onRemove,
    onClearAll: () => undefined,
    onUndoRemove: () => undefined,
    onDismissDeleted: () => undefined,
    onDismissNotice: () => undefined,
    onBrowse: () => undefined,
  };

  const result = render(<HistoryPageView {...viewProps} />);
  return { ...result, onPlay, onOpenDetail, onRemove };
}

describe('HistoryPageView card actions', () => {
  it('keeps one in-flow remove action separate from play and detail', () => {
    const { container, onPlay, onOpenDetail, onRemove } = renderHistory();
    const remove = screen.getByRole('button', { name: '从观看历史移除 示例剧 - 第01集' });
    const play = screen.getByRole('button', { name: '播放 示例剧 - 第01集' });
    const detail = screen.getByRole('button', { name: '详情' });

    expect(container.querySelectorAll('.history-card-media .hist-remove-action')).toHaveLength(1);
    expect(container.querySelectorAll('.history-card-media .hist-del')).toHaveLength(0);
    expect(remove.closest('.hist-actions')).toBeTruthy();
    expect(remove.closest('.media-poster')).toBeNull();

    fireEvent.click(play);
    fireEvent.click(detail);
    fireEvent.click(remove);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows details only when both source identity and VOD id are available', () => {
    renderHistory({ ...item, sourceKey: undefined, vodId: undefined });

    expect(screen.queryByRole('button', { name: '详情' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '从观看历史移除 示例剧 - 第01集' })).toHaveLength(1);
  });
});
