// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SourcePicker from '../src/renderer/components/SourcePicker';
import type { SourcePickerPort } from '../src/renderer/features/subscriptions/application/sourcePickerPort';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('SourcePicker child repository switching', () => {
  function createPort(): SourcePickerPort {
    return {
      loadCurrentSources: vi.fn().mockResolvedValue({ sources: [{ key: 'live', name: '直播源' }], activeSourceKey: 'live' }),
      loadProfileSites: vi.fn().mockResolvedValue({
        activeId: 'live-only',
        profiles: [
          { id: 'live-only', name: '直播子仓', sites: [{ key: 'live', name: '直播源' }, { key: 'live-alt', name: '备用直播源' }] },
          { id: 'vod', name: '点播子仓', sites: [{ key: 'vod', name: '点播站点' }] },
        ],
      }),
      setActiveSource: vi.fn().mockResolvedValue(undefined),
      activateProfile: vi.fn().mockResolvedValue(undefined),
      switchProfileSource: vi.fn().mockResolvedValue(undefined),
      publishSourceChanged: vi.fn(),
      publishProfileChanged: vi.fn(),
      subscribeToCurrentSourcesRefresh: vi.fn(() => () => undefined),
      subscribeToProfileSitesRefresh: vi.fn(() => () => undefined),
    };
  }

  it('opens other children when the current repository has only live streams', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('region', { name: '订阅和来源' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '点播子仓' })).toBeTruthy();
    expect(port.loadProfileSites).toHaveBeenCalledOnce();
  });

  it('keeps the portaled panel open while the pointer is inside it', async () => {
    vi.useFakeTimers();
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    const panel = screen.getByRole('region', { name: '订阅和来源' });
    fireEvent.pointerLeave(document.querySelector('.srcpick')!);
    fireEvent.pointerEnter(panel);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByRole('region', { name: '订阅和来源' })).toBeTruthy();
  });

  it('atomically switches to the selected profile and source', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: '点播子仓' }));
    fireEvent.click(await screen.findByRole('button', { name: '点播站点' }));
    await act(async () => { await Promise.resolve(); });
    expect(port.switchProfileSource).toHaveBeenCalledWith('vod', 'vod');
    expect(port.publishProfileChanged).toHaveBeenCalledWith('vod');
  });

  it('changes the active source through the port and publishes one source event', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: '备用直播源' }));
    await act(async () => { await Promise.resolve(); });
    expect(port.setActiveSource).toHaveBeenCalledWith('live-alt');
    expect(port.publishSourceChanged).toHaveBeenCalledWith('live-alt');
  });
});
