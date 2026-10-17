// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DanmakuPanel } from '../src/renderer/features/playback/DanmakuPanel';
import type { DanmakuCandidate, DanmakuSettings } from '../src/shared/danmaku';

afterEach(() => cleanup());

const candidate: DanmakuCandidate = {
  episodeId: 12,
  title: '测试作品',
  episodeTitle: '第2集',
  episodeNumber: '2',
  source: 'https://danmaku.example',
  sourceName: '测试源',
};

function initialSettings(): DanmakuSettings {
  return {
    enabled: true,
    region: 'full',
    fontSize: 24,
    opacity: 0.85,
    density: 1,
    speed: 110,
    offset: 0,
    endpoints: [
      { name: '源一', url: 'https://one.example', enabled: true },
      { name: '源二', url: 'https://two.example', enabled: false },
    ],
  };
}

function Harness({ onSearch = vi.fn(), onCandidateSelect = vi.fn() }: {
  onSearch?: () => void;
  onCandidateSelect?: (value: DanmakuCandidate) => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [settings, setSettings] = useState(initialSettings);
  const [query, setQuery] = useState('测试作品');
  const [episode, setEpisode] = useState('S1E02');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <output data-testid="settings">{JSON.stringify(settings)}</output>
      <output data-testid="enabled">{String(enabled)}</output>
      <DanmakuPanel
        enabled={enabled}
        open
        activeEpisodeId={null}
        message=""
        settings={settings}
        candidates={[candidate]}
        searching={false}
        query={query}
        episode={episode}
        sourcesOpen={sourcesOpen}
        customText={customText}
        panelRef={panelRef}
        onAnchorPointerEnter={vi.fn()}
        onAnchorPointerLeave={vi.fn()}
        onPanelPointerEnter={vi.fn()}
        onPanelPointerLeave={vi.fn()}
        onToggle={() => setEnabled((value) => !value)}
        onSettingsChange={setSettings}
        onQueryChange={setQuery}
        onEpisodeChange={setEpisode}
        setSourcesOpen={setSourcesOpen}
        setCustomText={setCustomText}
        onSearch={onSearch}
        onCandidateSelect={onCandidateSelect}
      />
    </>
  );
}

function readSettings(): DanmakuSettings {
  return JSON.parse(screen.getByTestId('settings').textContent || '{}') as DanmakuSettings;
}

describe('DanmakuPanel', () => {
  it('sends toggle, search, query, episode, and candidate actions to the play session', () => {
    const onSearch = vi.fn();
    const onCandidateSelect = vi.fn();
    render(<Harness onSearch={onSearch} onCandidateSelect={onCandidateSelect} />);

    fireEvent.click(screen.getByRole('button', { name: '弹幕：开' }));
    expect(screen.getByTestId('enabled').textContent).toBe('false');

    const query = screen.getByPlaceholderText('剧名（自动清洗；可改输常见名）…');
    fireEvent.change(query, { target: { value: '另一个作品' } });
    expect((query as HTMLInputElement).value).toBe('另一个作品');
    const episode = screen.getByPlaceholderText('集（如 S1E01 / 第1集 / 1）');
    fireEvent.change(episode, { target: { value: 'S2E03' } });
    expect((episode as HTMLInputElement).value).toBe('S2E03');
    fireEvent.click(screen.getByRole('button', { name: '匹配弹幕' }));
    fireEvent.keyDown(episode, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /测试源/ }));

    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onCandidateSelect).toHaveBeenCalledWith(candidate);
  });

  it('updates region and endpoint settings through the supplied settings setter', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '半屏' }));
    expect(readSettings().region).toBe('half');
    fireEvent.click(screen.getByRole('button', { name: '弹幕源 1/2 启用 ▼' }));
    fireEvent.click(screen.getByLabelText('源一'));
    expect(readSettings().endpoints[0].enabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '全开' }));
    expect(readSettings().endpoints.every((endpoint) => endpoint.enabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /弹幕源 2\/2 启用/ }));
    fireEvent.click(screen.getByRole('button', { name: '全关' }));
    expect(readSettings().endpoints.every((endpoint) => !endpoint.enabled)).toBe(true);
  });
});
