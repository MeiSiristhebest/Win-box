// @vitest-environment happy-dom
// tests/playerEpisodePanel.spec.tsx
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerEpisodePanel } from '../src/renderer/features/playback/PlayerEpisodePanel';
import { usePlayerEpisodePanelPresenter } from '../src/renderer/features/playback/usePlayerEpisodePanelPresenter';

afterEach(cleanup);

describe('PlayerEpisodePanel', () => {
  const makeEpisodes = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      name: `第${i + 1}集`,
      url: `http://example.com/ep${i + 1}`,
    }));

  it('renders flat list without tabs when episodes <= 50', () => {
    const episodes = makeEpisodes(30);
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <PlayerEpisodePanel
        episodes={episodes}
        current={5}
        open={true}
        title="测试番剧"
        page={0}
        onClose={onClose}
        onSelect={onSelect}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tablist')).toBeNull();
    const items = screen.getAllByRole('button').filter((b) => b.className.includes('vp-epitem'));
    expect(items).toHaveLength(30);
  });

  it('renders the controlled page and delegates range changes', () => {
    const episodes = makeEpisodes(120);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onPageChange = vi.fn();

    // page=1 renders episodes 51-100; page selection is owned by the presenter.
    const { rerender } = render(
      <PlayerEpisodePanel
        episodes={episodes}
        current={75}
        open={true}
        title="海贼王"
        page={1}
        onClose={onClose}
        onSelect={onSelect}
        onPageChange={onPageChange}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3); // 1-50, 51-100, 101-120
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].textContent).toBe('51-100');

    // Currently rendered items should be 50 items (51 to 100)
    const items = screen.getAllByRole('button').filter((b) => b.className.includes('vp-epitem'));
    expect(items).toHaveLength(50);
    expect(items[0].textContent).toContain('51');

    // Click episode 76 (index 75 in global)
    fireEvent.click(items[25]); // 51 + 25 = 76
    expect(onSelect).toHaveBeenCalledWith(75);
    expect(onClose).toHaveBeenCalled();

    // Switching tabs changes visible range
    rerender(
      <PlayerEpisodePanel
        episodes={episodes}
        current={75}
        open={true}
        title="海贼王"
        page={1}
        onClose={onClose}
        onSelect={onSelect}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(tabs[2]); // click '101-120'
    expect(onPageChange).toHaveBeenCalledWith(2);
    rerender(
      <PlayerEpisodePanel
        episodes={episodes}
        current={75}
        open={true}
        title="海贼王"
        page={2}
        onClose={onClose}
        onSelect={onSelect}
        onPageChange={onPageChange}
      />,
    );
    const newItems = screen.getAllByRole('button').filter((b) => b.className.includes('vp-epitem'));
    expect(newItems).toHaveLength(20);
    expect(newItems[0].textContent).toContain('101');
  });

  it('resets to the selected episode page when opened and follows selection changes', () => {
    const setOpen = vi.fn();
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      (props: { current: number; open: boolean }) => usePlayerEpisodePanelPresenter({
        ...props,
        episodeCount: 120,
        setOpen,
        onSelect,
      }),
      { initialProps: { current: 75, open: false } },
    );

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    rerender({ current: 75, open: true });
    expect(result.current.page).toBe(1);
    act(() => result.current.setPage(0));
    rerender({ current: 110, open: true });
    expect(result.current.page).toBe(2);
    act(() => result.current.selectEpisode(4));
    expect(onSelect).toHaveBeenCalledWith(4);
  });
});
