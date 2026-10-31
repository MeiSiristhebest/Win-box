// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(await screen.findByRole('button', { name: /^点播子仓，1 个点播源$/ })).toBeTruthy();
    expect(port.loadCurrentSources).toHaveBeenCalledTimes(1);
    expect(port.loadProfileSites).toHaveBeenCalledOnce();
  });

  it('activates a profile immediately when its profile row is clicked', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(await screen.findByRole('button', { name: /^点播子仓，1 个点播源$/ }));

    expect(port.activateProfile).toHaveBeenCalledTimes(1);
    expect(port.activateProfile).toHaveBeenCalledWith('vod');
    expect(port.switchProfileSource).not.toHaveBeenCalled();
    await act(async () => { await Promise.resolve(); });
    expect(port.publishProfileChanged).toHaveBeenCalledTimes(1);
  });

  it('labels the active profile and source in addition to the visual selection state', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));

    const activeProfile = await screen.findByRole('button', { name: '直播子仓，2 个点播源 · 当前使用' });
    const previewAction = screen.getByRole('button', { name: '仅预览直播子仓来源' });
    const activeSource = await screen.findByRole('button', { name: '直播源 当前' });
    expect(activeProfile.getAttribute('aria-current')).toBe('true');
    expect(activeProfile.getAttribute('aria-pressed')).toBe('true');
    expect(within(activeProfile).getByText('当前')).toBeTruthy();
    expect(previewAction.hasAttribute('aria-pressed')).toBe(false);
    expect(activeSource.getAttribute('aria-current')).toBe('true');
    expect(activeSource.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps an empty valid profile switchable and prevents activation of an unreadable profile', async () => {
    const port = createPort();
    port.loadProfileSites = vi.fn().mockResolvedValue({
      activeId: 'active',
      profiles: [
        { id: 'active', name: '当前子仓', sites: [{ key: 'live', name: '直播源' }], restorable: true },
        { id: 'empty', name: '空子仓', sites: [], restorable: true },
        { id: 'broken', name: '损坏子仓', sites: [], restorable: false, unavailableReason: '保存的配置快照无法解析' },
      ],
    });
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));

    const emptyProfile = await screen.findByRole('button', { name: '空子仓，0 个点播源' });
    const brokenProfile = await screen.findByRole('button', { name: '损坏子仓，无法切换，保存的配置快照无法解析' });
    expect((emptyProfile as HTMLButtonElement).disabled).toBe(false);
    expect((brokenProfile as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '仅预览损坏子仓来源' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '仅预览空子仓来源' }));
    expect(screen.getByText('该子仓暂无点播源；直播线路不显示在这里')).toBeTruthy();

    fireEvent.click(emptyProfile);
    expect(port.activateProfile).toHaveBeenCalledWith('empty');
    expect(port.activateProfile).not.toHaveBeenCalledWith('broken');
  });

  it('reloads an open picker after the source list changes elsewhere', async () => {
    const port = createPort();
    let notifyProfileSitesRefresh = (): void => undefined;
    port.loadProfileSites = vi.fn()
      .mockResolvedValueOnce({
        activeId: 'profile-a',
        profiles: [
          { id: 'profile-a', name: '线路 A', sites: [{ key: 'source-a', name: 'Source A' }] },
          { id: 'profile-b', name: '线路 B', sites: [{ key: 'source-b', name: 'Source B' }] },
        ],
      })
      .mockResolvedValueOnce({
        activeId: 'profile-a',
        profiles: [
          { id: 'profile-a', name: '线路 A', sites: [] },
          { id: 'profile-b', name: '线路 B', sites: [{ key: 'source-b', name: 'Source B' }] },
        ],
      });
    port.subscribeToProfileSitesRefresh = vi.fn((listener) => {
      notifyProfileSitesRefresh = listener;
      return () => undefined;
    });
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('button', { name: 'Source A' })).toBeTruthy();

    await act(async () => { notifyProfileSitesRefresh(); });

    expect(await screen.findByText('该子仓暂无点播源；直播线路不显示在这里')).toBeTruthy();
    expect(port.loadProfileSites).toHaveBeenCalledTimes(2);
  });

  it('uses controlled sources and current selection without self-loading or changing the source through the port', async () => {
    const port = createPort();
    const onPick = vi.fn();
    const sites = [
      { key: 'controlled-live', name: '外部直播源' },
      { key: 'controlled-alt', name: '外部备用源' },
    ] as SourceBean[];
    const view = render(<SourcePicker sites={sites} current="controlled-live" onPick={onPick} port={port} />);

    const trigger = screen.getByRole('button', { name: '切换站点，当前：外部直播源' });
    expect(port.loadCurrentSources).not.toHaveBeenCalled();
    expect(port.subscribeToCurrentSourcesRefresh).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    const activeSource = await screen.findByRole('button', { name: '外部直播源 当前' });
    expect(activeSource.getAttribute('aria-current')).toBe('true');
    expect(activeSource.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByRole('button', { name: '外部备用源' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '直播源' })).toBeNull();

    fireEvent.click(activeSource);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '切换站点，当前：外部直播源' })).toBeTruthy();

    view.rerender(<SourcePicker sites={sites} current="controlled-alt" onPick={onPick} port={port} />);
    expect(screen.getByRole('button', { name: '切换站点，当前：外部备用源' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换站点，当前：外部备用源' }));
    const updatedActiveSource = await screen.findByRole('button', { name: '外部备用源 当前' });
    expect(updatedActiveSource.getAttribute('aria-current')).toBe('true');
    expect(updatedActiveSource.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(await screen.findByRole('button', { name: '外部直播源' }));

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith('controlled-live');
    expect(screen.getByRole('button', { name: '切换站点，当前：外部备用源' })).toBeTruthy();
    expect(port.loadCurrentSources).not.toHaveBeenCalled();
    expect(port.setActiveSource).not.toHaveBeenCalled();
    expect(port.switchProfileSource).not.toHaveBeenCalled();
    expect(port.publishSourceChanged).not.toHaveBeenCalled();
    expect(port.publishProfileChanged).not.toHaveBeenCalled();
  });

  it('selects the first filtered source with Enter', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    const trigger = screen.getByRole('button', { name: /切换站点/ });
    fireEvent.click(trigger, { detail: 1 });
    const input = await screen.findByRole('textbox', { name: '筛选订阅源' });
    fireEvent.change(input, { target: { value: '备用' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });

    expect(port.setActiveSource).toHaveBeenCalledTimes(1);
    expect(port.setActiveSource).toHaveBeenCalledWith('live-alt');
    expect(port.publishSourceChanged).toHaveBeenCalledTimes(1);
    expect(port.publishSourceChanged).toHaveBeenCalledWith('live-alt');
    expect(screen.queryByRole('region', { name: '订阅和来源' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
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
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(screen.getByRole('region', { name: '订阅和来源' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(panel.classList.contains('srcpick-closing')).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(279); });
    expect(screen.getByRole('region', { name: '订阅和来源' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(screen.queryByRole('region', { name: '订阅和来源' })).toBeNull();
  });

  it('previews a profile without activating it, then atomically switches that profile and source', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    const preview = await screen.findByRole('button', { name: '仅预览点播子仓来源' });
    fireEvent.click(preview);
    expect(preview.hasAttribute('aria-pressed')).toBe(false);
    expect(port.activateProfile).not.toHaveBeenCalled();
    const previewingProfile = screen.getByRole('button', { name: '点播子仓，1 个点播源' });
    expect(within(previewingProfile).getByText('预览中')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: '点播站点' }));
    await act(async () => { await Promise.resolve(); });
    expect(port.switchProfileSource).toHaveBeenCalledTimes(1);
    expect(port.switchProfileSource).toHaveBeenCalledWith('vod', 'vod');
    expect(port.activateProfile).not.toHaveBeenCalled();
    expect(port.setActiveSource).not.toHaveBeenCalled();
    expect(port.publishProfileChanged).toHaveBeenCalledTimes(1);
    expect(port.publishProfileChanged).toHaveBeenCalledWith('vod');
  });

  it('changes the active source through the port and publishes one source event', async () => {
    const port = createPort();
    render(<SourcePicker port={port} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('button', { name: '备用直播源' }));
    await act(async () => { await Promise.resolve(); });
    expect(port.setActiveSource).toHaveBeenCalledTimes(1);
    expect(port.setActiveSource).toHaveBeenCalledWith('live-alt');
    expect(port.publishSourceChanged).toHaveBeenCalledTimes(1);
    expect(port.publishSourceChanged).toHaveBeenCalledWith('live-alt');
  });
});
