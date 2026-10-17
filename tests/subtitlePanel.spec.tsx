// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitlePanel } from '../src/renderer/features/playback/SubtitlePanel';
import type { SubtitleCandidate } from '../src/shared/subtitle';

afterEach(() => cleanup());

const candidate: SubtitleCandidate = {
  file: 'https://subtitles.example/file',
  subname: '候选字幕.srt',
  format: 'srt',
  lang: '简中',
  provider: 'subtitlecat',
  hitKeyword: '测试作品',
};

function Harness({ onSearch = vi.fn(), onSelectCandidate = vi.fn() }: {
  onSearch?: () => void;
  onSelectCandidate?: (value: SubtitleCandidate) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [fontSize, setFontSize] = useState(20);
  const [bottom, setBottom] = useState(40);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('测试作品');
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <output data-testid="subtitle-settings">{JSON.stringify({ enabled, fontSize, bottom, offset })}</output>
      <SubtitlePanel
        enabled={enabled}
        open
        activeSubtitle="当前字幕.srt"
        fontSize={fontSize}
        bottom={bottom}
        offset={offset}
        query={query}
        searching={false}
        tokenHint={false}
        message=""
        candidates={[candidate]}
        resourceName="测试作品 第2集"
        panelRef={panelRef}
        onAnchorPointerEnter={vi.fn()}
        onAnchorPointerLeave={vi.fn()}
        onPanelPointerEnter={vi.fn()}
        onPanelPointerLeave={vi.fn()}
        onToggle={() => setEnabled((value) => !value)}
        setFontSize={setFontSize}
        setBottom={setBottom}
        setOffset={setOffset}
        onQueryChange={setQuery}
        onSearch={onSearch}
        onSelectCandidate={onSelectCandidate}
      />
    </>
  );
}

function readSettings(): { enabled: boolean; fontSize: number; bottom: number; offset: number } {
  return JSON.parse(screen.getByTestId('subtitle-settings').textContent || '{}') as { enabled: boolean; fontSize: number; bottom: number; offset: number };
}

describe('SubtitlePanel', () => {
  it('sends toggle, query, search, and candidate actions to the play session', () => {
    const onSearch = vi.fn();
    const onSelectCandidate = vi.fn();
    render(<Harness onSearch={onSearch} onSelectCandidate={onSelectCandidate} />);

    fireEvent.click(screen.getByRole('button', { name: '字幕：开' }));
    expect(readSettings().enabled).toBe(false);
    const query = screen.getByPlaceholderText('剧名（可改）');
    fireEvent.change(query, { target: { value: '常见剧名' } });
    expect((query as HTMLInputElement).value).toBe('常见剧名');
    fireEvent.keyDown(query, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /候选字幕\.srt/ }));

    expect(onSearch).toHaveBeenCalledOnce();
    expect(onSelectCandidate).toHaveBeenCalledWith(candidate);
  });

  it('updates subtitle size, position, and time offset through the supplied setters', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'A−' }));
    fireEvent.click(screen.getByRole('button', { name: '上移' }));
    fireEvent.click(screen.getByRole('button', { name: '+0.5s' }));

    expect(readSettings()).toMatchObject({ fontSize: 18, bottom: 32, offset: 0.5 });
  });
});
