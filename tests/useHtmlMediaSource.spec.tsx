// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHtmlMediaSource, type HtmlMediaSourceOptions } from '../src/renderer/features/playback/useHtmlMediaSource';
import type { PreparedHtmlMediaSource } from '../src/renderer/features/playback/application/htmlMediaSource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function options(overrides: Partial<HtmlMediaSourceOptions> = {}): HtmlMediaSourceOptions {
  return {
    url: 'original', progressKey: 'profile/source/original', enabled: true,
    port: { requiresPreparation: () => true, prepare: vi.fn(async (source) => ({ source, url: 'compatibility', sessionReleaseUrl: 'release-active' })), release: vi.fn() },
    nativePlayback: { allowed: true, available: true, preference: 'html5' },
    onCompatibilityDetected: vi.fn(), onNativeHandoff: vi.fn(), updatePlaybackStatus: vi.fn(), recoverHtmlPlayback: vi.fn(() => false),
    ...overrides,
  };
}

afterEach(cleanup);

describe('useHtmlMediaSource lifecycle', () => {
  it('publishes a prepared source and releases its lease when playback closes', async () => {
    const setup = options();
    const { result, unmount } = renderHook(() => useHtmlMediaSource(setup));
    await waitFor(() => expect(result.current?.url).toBe('compatibility'));
    expect(setup.updatePlaybackStatus).toHaveBeenCalledWith({ loading: true, error: '' });
    expect(setup.onCompatibilityDetected).toHaveBeenCalledWith({ url: setup.url, progressKey: setup.progressKey });
    expect(setup.port.release).not.toHaveBeenCalled();
    unmount();
    expect(setup.port.release).toHaveBeenCalledExactlyOnceWith('release-active');
  });

  it('never reuses the released source when HTML playback is disabled and re-enabled for the same URL', async () => {
    const second = deferred<PreparedHtmlMediaSource>();
    const setup = options();
    setup.port.prepare = vi.fn().mockResolvedValueOnce({ source: setup.url, url: 'old', sessionReleaseUrl: 'release-old' }).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook((current: HtmlMediaSourceOptions) => useHtmlMediaSource(current), { initialProps: setup });
    await waitFor(() => expect(result.current?.url).toBe('old'));
    rerender({ ...setup, enabled: false });
    expect(result.current).toBeNull();
    expect(setup.port.release).toHaveBeenCalledExactlyOnceWith('release-old');
    rerender(setup);
    expect(result.current).toBeNull();
    await waitFor(() => expect(setup.port.prepare).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve({ source: setup.url, url: 'fresh', sessionReleaseUrl: 'release-fresh' }); await second.promise; });
    expect(result.current?.url).toBe('fresh');
  });

  it('discards a late old-profile response and releases it without overwriting the new profile source', async () => {
    const first = deferred<PreparedHtmlMediaSource>();
    const setup = options();
    setup.port.prepare = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ source: setup.url, url: 'new-profile', sessionReleaseUrl: 'release-new' });
    const { result, rerender } = renderHook((current: HtmlMediaSourceOptions) => useHtmlMediaSource(current), { initialProps: setup });
    await waitFor(() => expect(setup.port.prepare).toHaveBeenCalledOnce());
    const firstSignal = vi.mocked(setup.port.prepare).mock.calls[0][1];
    rerender({ ...setup, progressKey: 'another-profile/source/original' });
    expect(firstSignal.aborted).toBe(true);
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.url).toBe('new-profile'));
    await act(async () => { first.resolve({ source: setup.url, url: 'old-profile', sessionReleaseUrl: 'release-old' }); await first.promise; });
    expect(result.current?.url).toBe('new-profile');
    expect(setup.port.release).toHaveBeenCalledWith('release-old');
    expect(setup.onCompatibilityDetected).toHaveBeenCalledOnce();
  });

  it('hands a required compatibility stream to native playback in auto mode and releases the unused transcode', async () => {
    const setup = options({ nativePlayback: { allowed: true, available: true, preference: 'auto' } });
    const { result } = renderHook(() => useHtmlMediaSource(setup));
    await waitFor(() => expect(setup.onNativeHandoff).toHaveBeenCalledOnce());
    expect(setup.onNativeHandoff).toHaveBeenCalledWith({ url: setup.url, progressKey: setup.progressKey, kernel: 'mpv', position: 0, paused: false });
    expect(setup.port.release).toHaveBeenCalledExactlyOnceWith('release-active');
    expect(result.current).toBeNull();
  });

  it('uses a preference changed during preparation without restarting the request', async () => {
    const pending = deferred<PreparedHtmlMediaSource>();
    const setup = options({ nativePlayback: { allowed: true, available: true, preference: 'auto' } });
    setup.port.prepare = vi.fn(() => pending.promise);
    const { result, rerender } = renderHook((current: HtmlMediaSourceOptions) => useHtmlMediaSource(current), { initialProps: setup });
    await waitFor(() => expect(setup.port.prepare).toHaveBeenCalledOnce());
    rerender({ ...setup, nativePlayback: { ...setup.nativePlayback, preference: 'html5' } });
    await act(async () => { pending.resolve({ source: setup.url, url: 'html', sessionReleaseUrl: 'release-html' }); await pending.promise; });
    expect(setup.port.prepare).toHaveBeenCalledOnce();
    expect(result.current?.url).toBe('html');
    expect(setup.onNativeHandoff).not.toHaveBeenCalled();
    expect(setup.port.release).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses current recovery policy before reporting a preparation error (recovered=%s)', async (recovered) => {
    const setup = options({ recoverHtmlPlayback: vi.fn(() => recovered) });
    setup.port.prepare = vi.fn(async () => { throw new Error('Upstream rejected'); });
    renderHook(() => useHtmlMediaSource(setup));
    await waitFor(() => expect(setup.recoverHtmlPlayback).toHaveBeenCalledOnce());
    expect(setup.updatePlaybackStatus).toHaveBeenCalledWith({ loading: false });
    if (recovered) expect(setup.updatePlaybackStatus).not.toHaveBeenCalledWith({ error: '播放准备失败：Upstream rejected' });
    else expect(setup.updatePlaybackStatus).toHaveBeenCalledWith({ error: '播放准备失败：Upstream rejected' });
  });

  it('suppresses failure recovery and errors after unmount', async () => {
    const pending = deferred<PreparedHtmlMediaSource>();
    const setup = options();
    setup.port.prepare = vi.fn(() => pending.promise);
    const { unmount } = renderHook(() => useHtmlMediaSource(setup));
    await waitFor(() => expect(setup.port.prepare).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { pending.reject(new Error('Cancelled old request')); await pending.promise.catch(() => undefined); });
    expect(setup.recoverHtmlPlayback).not.toHaveBeenCalled();
    expect(setup.updatePlaybackStatus).toHaveBeenCalledExactlyOnceWith({ loading: true, error: '' });
  });

  it('invalidates the old lease when the provider adapter changes within the same playback scope', async () => {
    const setup = options();
    const pending = deferred<PreparedHtmlMediaSource>();
    const replacement = { ...setup.port, prepare: vi.fn(() => pending.promise) };
    const { result, rerender } = renderHook((current: HtmlMediaSourceOptions) => useHtmlMediaSource(current), { initialProps: setup });
    await waitFor(() => expect(result.current?.url).toBe('compatibility'));
    rerender({ ...setup, port: replacement });
    expect(result.current).toBeNull();
    expect(setup.port.release).toHaveBeenCalledExactlyOnceWith('release-active');
    await act(async () => { pending.resolve({ source: setup.url, url: 'replacement' }); await pending.promise; });
    expect(result.current?.url).toBe('replacement');
  });
});
