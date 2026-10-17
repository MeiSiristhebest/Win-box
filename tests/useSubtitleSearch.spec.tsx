// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { client } from '../src/renderer/api/client';
import type { SubtitleCandidate } from '../src/shared/subtitle';
import { useSubtitleSearch } from '../src/renderer/features/playback/useSubtitleSearch';

const candidate = { file: 'episode.srt', subname: 'episode.srt' } as SubtitleCandidate;

function Harness({ url, onApply }: { url: string; onApply: (cues: Array<{ start: number; end: number; text: string }>) => void }) {
  const subtitle = useSubtitleSearch({ url, resourceName: 'Example series 第 2 集', onApply });
  return (
    <div>
      <input aria-label='字幕搜索词' value={subtitle.query} onChange={(event) => subtitle.setQuery(event.target.value)} />
      <button onClick={() => void subtitle.search()}>搜索字幕</button>
      {subtitle.candidates.map((item) => <button key={item.file} onClick={() => void subtitle.selectCandidate(item)}>{item.subname}</button>)}
      <div role='status'>{subtitle.message}</div>
      <div data-testid='active-subtitle'>{subtitle.activeSubtitle}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('useSubtitleSearch', () => {
  it('searches, parses the selected subtitle, and applies its cues', async () => {
    vi.spyOn(client, 'subtitleProviders').mockResolvedValue([{ available: true }] as never);
    const search = vi.spyOn(client, 'subtitleSearch').mockResolvedValue({ candidates: [candidate] } as never);
    vi.spyOn(client, 'subtitleFetch').mockResolvedValue({
      text: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
      fileName: 'episode.srt',
      format: 'srt',
      entries: 1,
    } as never);
    const setEnabled = vi.spyOn(client, 'subtitleSet').mockResolvedValue(undefined as never);
    const onApply = vi.fn();

    render(<Harness url='episode-1' onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '搜索字幕' }));
    fireEvent.click(await screen.findByRole('button', { name: 'episode.srt' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ start: 1, end: 2, text: 'Hello' }]));
    expect(search).toHaveBeenCalledOnce();
    expect(screen.getByTestId('active-subtitle').textContent).toBe('episode.srt');
    expect(screen.getByRole('status').textContent).toBe('字幕已挂载（1 条）');
    expect(setEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it('drops search results from a previous episode', async () => {
    vi.spyOn(client, 'subtitleProviders').mockResolvedValue([{ available: true }] as never);
    let resolveSearch!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveSearch = resolve; });
    const search = vi.spyOn(client, 'subtitleSearch').mockReturnValue(pending as never);
    const onApply = vi.fn();
    const view = render(<Harness url='episode-1' onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索字幕' }));
    view.rerender(<Harness url='episode-2' onApply={onApply} />);
    resolveSearch({ candidates: [candidate] });

    await waitFor(() => expect(search).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'episode.srt' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});
