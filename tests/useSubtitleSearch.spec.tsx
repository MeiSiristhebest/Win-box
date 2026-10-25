// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SubtitleCandidate, SubtitleFetchResult, SubtitleProviderView, SubtitleSearchReport } from '../src/shared/subtitle';
import type { SubtitleSearchDependencies } from '../src/renderer/features/playback/application/subtitleSearchPorts';
import { useSubtitleSearch } from '../src/renderer/features/playback/useSubtitleSearch';

const candidate = { file: 'episode.srt', subname: 'episode.srt' } as SubtitleCandidate;

function createDependencies(): SubtitleSearchDependencies {
  let memory: Record<string, string> = {};
  return {
    service: {
      listProviders: vi.fn<() => Promise<SubtitleProviderView[]>>().mockResolvedValue([{ id: 'test', name: 'Test', needsToken: false, enabled: true, available: true }]),
      search: vi.fn<(query: string) => Promise<SubtitleSearchReport>>().mockResolvedValue({ candidates: [candidate], providers: [] }),
      fetch: vi.fn<(_: SubtitleCandidate) => Promise<SubtitleFetchResult>>().mockResolvedValue({
        text: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
        fileName: 'episode.srt',
        format: 'srt',
        entries: 1,
      }),
      enableSubtitles: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    },
    queryMemory: {
      load: vi.fn(() => ({ ...memory })),
      save: vi.fn((next) => { memory = { ...next }; }),
    },
  };
}

function Harness({ url, onApply, dependencies }: {
  url: string;
  onApply: (cues: Array<{ start: number; end: number; text: string }>) => void;
  dependencies: SubtitleSearchDependencies;
}) {
  const subtitle = useSubtitleSearch({ url, resourceName: 'Example series 第 2 集', onApply, dependencies });
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
});

describe('useSubtitleSearch', () => {
  it('searches, parses the selected subtitle, and applies its cues', async () => {
    const dependencies = createDependencies();
    const onApply = vi.fn();

    render(<Harness url='episode-1' onApply={onApply} dependencies={dependencies} />);
    fireEvent.change(screen.getByRole('textbox', { name: '字幕搜索词' }), { target: { value: 'Example series alternate' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索字幕' }));
    fireEvent.click(await screen.findByRole('button', { name: 'episode.srt' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ start: 1, end: 2, text: 'Hello' }]));
    expect(dependencies.service.search).toHaveBeenCalledOnce();
    expect(screen.getByTestId('active-subtitle').textContent).toBe('episode.srt');
    expect(screen.getByRole('status').textContent).toBe('字幕已挂载（1 条）');
    expect(dependencies.service.enableSubtitles).toHaveBeenCalledOnce();
    expect(dependencies.queryMemory.save).toHaveBeenCalledWith({ 'Example series 第 2 集': 'Example series alternate' });
  });

  it('drops search results from a previous episode', async () => {
    const dependencies = createDependencies();
    let resolveSearch!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveSearch = resolve; });
    vi.mocked(dependencies.service.search).mockReturnValue(pending as Promise<SubtitleSearchReport>);
    const onApply = vi.fn();
    const view = render(<Harness url='episode-1' onApply={onApply} dependencies={dependencies} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索字幕' }));
    view.rerender(<Harness url='episode-2' onApply={onApply} dependencies={dependencies} />);
    resolveSearch({ candidates: [candidate] });

    await waitFor(() => expect(dependencies.service.search).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'episode.srt' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('ignores an in-flight search after the player unmounts', async () => {
    const dependencies = createDependencies();
    let resolveSearch!: (value: SubtitleSearchReport) => void;
    const pending = new Promise<SubtitleSearchReport>((resolve) => { resolveSearch = resolve; });
    vi.mocked(dependencies.service.search).mockReturnValue(pending);
    const onApply = vi.fn();
    const view = render(<Harness url='episode-1' onApply={onApply} dependencies={dependencies} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索字幕' }));
    await waitFor(() => expect(dependencies.service.search).toHaveBeenCalledOnce());
    view.unmount();
    resolveSearch({ candidates: [candidate], providers: [] });
    await pending;
    await Promise.resolve();

    expect(dependencies.queryMemory.save).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
