// @vitest-environment happy-dom
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { client } from '../src/renderer/api/client';
import { useSubtitlePlayback } from '../src/renderer/features/playback/useSubtitlePlayback';
import type { SubtitleCandidate } from '../src/shared/subtitle';

const candidate = { file: 'episode.srt', subname: 'episode.srt' } as SubtitleCandidate;

function Harness({
  url = 'episode-1',
  allowMpv = true,
  kernel = 'mpv',
}: {
  url?: string;
  allowMpv?: boolean;
  kernel?: 'html5' | 'mpv';
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const subtitle = useSubtitlePlayback({
    videoRef,
    url,
    resourceName: 'Example series E01',
    allowMpv,
    kernel,
    initialOffset: 0,
  });

  return (
    <div>
      <output data-testid='enabled'>{String(subtitle.enabled)}</output>
      <button onClick={() => void subtitle.search()}>Search subtitles</button>
      {subtitle.candidates.map((item) => (
        <button key={item.file} onClick={() => void subtitle.selectCandidate(item)}>{item.subname}</button>
      ))}
      <button onClick={() => subtitle.setOffset(1.5)}>Offset 1.5</button>
      <button onClick={subtitle.toggle}>Toggle</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSubtitlePlayback', () => {
  it('waits for stored subtitle settings before writing a snapshot', async () => {
    vi.spyOn(client, 'subtitleProviders').mockResolvedValue([] as never);
    let resolveSettings!: (value: unknown) => void;
    const pendingSettings = new Promise((resolve) => { resolveSettings = resolve; });
    vi.spyOn(client, 'subtitleGet').mockReturnValue(pendingSettings as never);
    const save = vi.spyOn(client, 'subtitleSet').mockResolvedValue(undefined as never);

    render(<Harness allowMpv={false} kernel='html5' />);
    expect(save).not.toHaveBeenCalled();

    resolveSettings({ enabled: true, fontSize: 28, bottom: 35 });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, fontSize: 28, bottom: 35 }));
  });

  it('keeps a user toggle made while stored settings are loading', async () => {
    vi.spyOn(client, 'subtitleProviders').mockResolvedValue([{ available: false }] as never);
    let resolveSettings!: (value: unknown) => void;
    const pendingSettings = new Promise((resolve) => { resolveSettings = resolve; });
    vi.spyOn(client, 'subtitleGet').mockReturnValue(pendingSettings as never);
    const save = vi.spyOn(client, 'subtitleSet').mockResolvedValue(undefined as never);

    render(<Harness allowMpv={false} kernel='html5' />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('enabled').textContent).toBe('true');
    expect(save).not.toHaveBeenCalled();

    resolveSettings({ enabled: false, fontSize: 28, bottom: 35 });
    await waitFor(() => expect(screen.getByTestId('enabled').textContent).toBe('true'));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ enabled: true, fontSize: 20, bottom: 40 }));
  });

  it('applies shifted cues to mpv and clears them when subtitles are disabled', async () => {
    vi.spyOn(client, 'subtitleProviders').mockResolvedValue([] as never);
    vi.spyOn(client, 'subtitleGet').mockResolvedValue({ enabled: false, fontSize: 20, bottom: 40 } as never);
    vi.spyOn(client, 'subtitleSet').mockResolvedValue(undefined as never);
    vi.spyOn(client, 'subtitleSearch').mockResolvedValue({ candidates: [candidate] } as never);
    vi.spyOn(client, 'subtitleFetch').mockResolvedValue({
      text: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
      fileName: 'episode.srt',
      format: 'srt',
      entries: 1,
    } as never);
    const mpvCmd = vi.spyOn(client, 'mpvCmd').mockResolvedValue(undefined as never);

    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Search subtitles' }));
    fireEvent.click(await screen.findByRole('button', { name: 'episode.srt' }));
    await waitFor(() => {
      const hasSubtitle = mpvCmd.mock.calls.some(([command]) =>
        command.type === 'sub-add' && command.text.includes('00:00:01,000 --> 00:00:02,000'),
      );
      expect(hasSubtitle).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Offset 1.5' }));
    await waitFor(() => {
      const hasShiftedSubtitle = mpvCmd.mock.calls.some(([command]) =>
        command.type === 'sub-add' && command.text.includes('00:00:02,500 --> 00:00:03,500'),
      );
      expect(hasShiftedSubtitle).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await waitFor(() => expect(mpvCmd).toHaveBeenCalledWith({ type: 'sub-clear' }));
  });
});
