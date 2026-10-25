// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayerResolution } from '../src/renderer/features/playback/usePlayerResolution';
import type { Kernel } from '../src/renderer/lib/kernel';

function video() {
  const element = document.createElement('video');
  Object.defineProperty(element, 'videoWidth', { configurable: true, writable: true, value: 1920 });
  Object.defineProperty(element, 'videoHeight', { configurable: true, writable: true, value: 1080 });
  return { current: element };
}
function options() {
  return {
    url: 'movie', progressKey: 'profile/source/movie', kernel: 'html5' as Kernel,
    videoRef: video(), htmlUrl: 'prepared', htmlEnabled: true, onResolutionChange: vi.fn(),
  };
}

afterEach(cleanup);

describe('usePlayerResolution', () => {
  it('observes media metadata and resize events while suppressing duplicate title updates', () => {
    const setup = options();
    const { result } = renderHook(() => usePlayerResolution(setup));
    act(() => setup.videoRef.current.dispatchEvent(new Event('loadedmetadata')));
    expect(result.current.resolution).toBe('1920×1080');
    expect(setup.onResolutionChange).toHaveBeenLastCalledWith('1920×1080');
    const calls = setup.onResolutionChange.mock.calls.length;
    act(() => setup.videoRef.current.dispatchEvent(new Event('canplay')));
    expect(setup.onResolutionChange).toHaveBeenCalledTimes(calls);
    Object.defineProperty(setup.videoRef.current, 'videoWidth', { value: 1280 });
    Object.defineProperty(setup.videoRef.current, 'videoHeight', { value: 720 });
    act(() => setup.videoRef.current.dispatchEvent(new Event('resize')));
    expect(result.current.resolution).toBe('1280×720');
  });

  it('keeps original source dimensions when the HTML compatibility stream is downsampled', () => {
    const setup = options();
    const { result } = renderHook(() => usePlayerResolution({ ...setup, sourceWidth: 3840, sourceHeight: 2160 }));
    expect(result.current.resolution).toBe('3840×2160');
    act(() => setup.videoRef.current.dispatchEvent(new Event('resize')));
    expect(result.current.resolution).toBe('3840×2160');
  });

  it('rejects a late report from a different profile even when the media URL is identical', () => {
    const setup = options();
    const { result, rerender } = renderHook((current) => usePlayerResolution(current), { initialProps: setup });
    act(() => result.current.reportResolution(1920, 1080));
    const oldReport = result.current.reportResolution;
    rerender({ ...setup, progressKey: 'another-profile/source/movie' });
    expect(result.current.resolution).toBe('');
    const calls = setup.onResolutionChange.mock.calls.length;
    act(() => oldReport(3840, 2160));
    expect(result.current.resolution).toBe('');
    expect(setup.onResolutionChange).toHaveBeenCalledTimes(calls);
    act(() => result.current.reportResolution(1280, 720));
    expect(result.current.resolution).toBe('1280×720');
  });

  it('does not observe the HTML element while a native kernel owns playback', () => {
    const setup = options();
    const { result } = renderHook(() => usePlayerResolution({ ...setup, kernel: 'mpv' }));
    act(() => setup.videoRef.current.dispatchEvent(new Event('loadedmetadata')));
    expect(result.current.resolution).toBe('');
    act(() => result.current.reportResolution(3840, 2160));
    expect(result.current.resolution).toBe('3840×2160');
  });

  it('detaches DOM listeners and ignores retained native callbacks after unmount', () => {
    const setup = options();
    const { result, unmount } = renderHook(() => usePlayerResolution(setup));
    const report = result.current.reportResolution;
    unmount();
    setup.onResolutionChange.mockClear();
    act(() => {
      setup.videoRef.current.dispatchEvent(new Event('loadedmetadata'));
      report(3840, 2160);
    });
    expect(setup.onResolutionChange).not.toHaveBeenCalled();
  });
});
