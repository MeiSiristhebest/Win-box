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

  it('keeps the episode range tabs in a labelled panel and supports tab-key navigation', () => {
    const episodes = makeEpisodes(120);
    const onPageChange = vi.fn();
    const props = {
      episodes,
      current: 75,
      open: true,
      title: '海贼王',
      onClose: vi.fn(),
      onSelect: vi.fn(),
      onPageChange,
    };
    const { rerender } = render(<PlayerEpisodePanel {...props} page={0} />);

    const firstTab = screen.getByRole('tab', { name: '1-50' });
    const secondTab = screen.getByRole('tab', { name: '51-100' });
    const panel = screen.getByRole('tabpanel');
    expect(firstTab.getAttribute('aria-selected')).toBe('true');
    expect(firstTab.getAttribute('tabindex')).toBe('0');
    expect(secondTab.getAttribute('tabindex')).toBe('-1');
    expect(firstTab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(firstTab.id);

    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(onPageChange).toHaveBeenCalledWith(1);
    expect(document.activeElement).toBe(secondTab);

    rerender(<PlayerEpisodePanel {...props} page={1} />);
    expect(screen.getByRole('tab', { name: '51-100' }).getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(screen.getByRole('tab', { name: '51-100' }), { key: 'Home' });
    expect(onPageChange).toHaveBeenLastCalledWith(0);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '1-50' }));
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
