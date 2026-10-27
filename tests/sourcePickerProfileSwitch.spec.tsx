// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SourcePicker from '../src/renderer/features/subscriptions/SourcePicker';
import type { SourcePickerPort } from '../src/renderer/features/subscriptions/application/sourcePickerPort';
import type { SourceBean } from '../src/shared/types';

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

  it('labels the active profile and source in addition to the visual selection state', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));

    const activeProfile = await screen.findByRole('button', { name: '直播子仓 当前使用' });
    const activeSource = await screen.findByRole('button', { name: '直播源 当前' });
    expect(activeProfile.getAttribute('aria-current')).toBe('true');
    expect(activeProfile.getAttribute('aria-pressed')).toBe('true');
    expect(activeSource.getAttribute('aria-current')).toBe('true');
    expect(activeSource.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses controlled sources and current selection without self-loading or changing the source through the port', async () => {
    const port = createPort();
    const onPick = vi.fn();
    const sites = [
      { key: 'live', name: '直播源' },
      { key: 'live-alt', name: '备用直播源' },
    ] as SourceBean[];
    render(<SourcePicker sites={sites} current="live" onPick={onPick} port={port} />);

    expect(screen.getByRole('button', { name: '切换站点，当前：直播源' })).toBeTruthy();
    expect(port.loadCurrentSources).not.toHaveBeenCalled();
    expect(port.subscribeToCurrentSourcesRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '切换站点，当前：直播源' }));
    const activeSource = await screen.findByRole('button', { name: '直播源 当前' });
    expect(activeSource.getAttribute('aria-current')).toBe('true');
    expect(activeSource.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(await screen.findByRole('button', { name: '备用直播源' }));

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith('live-alt');
    expect(port.loadCurrentSources).not.toHaveBeenCalled();
    expect(port.setActiveSource).not.toHaveBeenCalled();
    expect(port.switchProfileSource).not.toHaveBeenCalled();
    expect(port.publishSourceChanged).not.toHaveBeenCalled();
    expect(port.publishProfileChanged).not.toHaveBeenCalled();
  });

  it('selects the first filtered source with Enter', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByRole('textbox', { name: '筛选订阅源' });
    fireEvent.change(input, { target: { value: '备用' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });

    expect(port.setActiveSource).toHaveBeenCalledWith('live-alt');
    expect(port.publishSourceChanged).toHaveBeenCalledWith('live-alt');
  });

  it('closes with Escape and restores focus to the trigger', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    const trigger = screen.getByRole('button', { name: /切换站点/ });
    fireEvent.click(trigger);
    const input = await screen.findByRole('textbox', { name: '筛选订阅源' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: '订阅和来源' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it('closes after the pointer leave delay and exit animation', async () => {
    vi.useFakeTimers();
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    const panel = screen.getByRole('region', { name: '订阅和来源' });
    fireEvent.pointerLeave(panel);
    await act(async () => { await vi.advanceTimersByTimeAsync(3280); });

    expect(screen.queryByRole('region', { name: '订阅和来源' })).toBeNull();
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
