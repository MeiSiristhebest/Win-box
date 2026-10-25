// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaStateEvent } from '../src/shared/player';
import type { MediaDiagnosticsPort } from '../src/renderer/features/playback/application/mediaDiagnostics';
import { useMediaDiagnostics } from '../src/renderer/features/playback/useMediaDiagnostics';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useMediaDiagnostics', () => {
  it('reports media snapshots through the injected port and detaches listeners on unmount', async () => {
    const video = document.createElement('video');
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 3 },
      currentTime: { configurable: true, value: 21.25 },
      paused: { configurable: true, value: true },
    });
    const videoRef = { current: video };
    const report = vi.fn(async (_event: MediaStateEvent) => undefined);
    const port: MediaDiagnosticsPort = { report };
    const { unmount } = renderHook(() => useMediaDiagnostics(videoRef, true, 'https://media.example/video.mp4', 'Episode 3', port));

    act(() => video.dispatchEvent(new Event('pause')));
    await waitFor(() => expect(report).toHaveBeenCalledOnce());
    expect(report).toHaveBeenCalledWith({
      event: 'pause',
      kernel: 'html5',
      url: 'https://media.example/video.mp4',
      title: 'Episode 3',
      readyState: 3,
      currentTime: 21.25,
      paused: true,
    });

    unmount();
    act(() => video.dispatchEvent(new Event('pause')));
    await Promise.resolve();
    expect(report).toHaveBeenCalledOnce();
  });

  it('does not install media or frame listeners when diagnostics are inactive', () => {
    const video = document.createElement('video');
    const addListener = vi.spyOn(video, 'addEventListener');
    const port: MediaDiagnosticsPort = { report: async () => undefined };

    renderHook(() => useMediaDiagnostics({ current: video }, false, 'https://media.example/video.mp4', undefined, port));

    expect(addListener).not.toHaveBeenCalled();
  });
});
