// @vitest-environment happy-dom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaRuntimeProgress, MediaRuntimeStatus } from '../src/shared/player';
import type { MediaRuntimeManagementPort } from '../src/renderer/features/settings/application/playbackSettingsPorts';
import { useMediaRuntimeManagement } from '../src/renderer/features/settings/useMediaRuntimeManagement';
import { MediaRuntimeDownloadsSection } from '../src/renderer/features/settings/MediaRuntimeDownloadsSection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialStatus: MediaRuntimeStatus = {
  mpv: { installed: false },
  ffmpeg: { installed: false },
};
const installedStatus: MediaRuntimeStatus = {
  mpv: { installed: true },
  ffmpeg: { installed: false },
};

function createPort(): MediaRuntimeManagementPort & {
  emitProgress: (progress: MediaRuntimeProgress) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let progressListener: ((progress: MediaRuntimeProgress) => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    loadStatus: vi.fn(async () => initialStatus),
    install: vi.fn(async () => ({ mpv: { installed: true }, ffmpeg: { installed: false } })),
    cancelInstall: vi.fn(async () => true),
    onProgress: vi.fn((listener) => {
      progressListener = listener;
      return unsubscribe;
    }),
    emitProgress: (progress) => progressListener?.(progress),
    unsubscribe,
  };
}

describe('useMediaRuntimeManagement', () => {
  it('loads status and listens for progress only while active', async () => {
    const port = createPort();
    const { result, rerender, unmount } = renderHook(
      ({ active }) => useMediaRuntimeManagement({ active, port, afterMpvInstall: vi.fn(async () => undefined) }),
      { initialProps: { active: false } },
    );

    expect(port.loadStatus).not.toHaveBeenCalled();
    expect(port.onProgress).not.toHaveBeenCalled();

    rerender({ active: true });
    await waitFor(() => expect(result.current.status).toEqual(initialStatus));
    expect(port.onProgress).toHaveBeenCalledOnce();
    act(() => port.emitProgress({ runtime: 'ffmpeg', phase: 'download', received: 5, total: 10, message: 'downloading' }));
    expect(result.current.progress).toMatchObject({ runtime: 'ffmpeg', received: 5, total: 10 });

    unmount();
    expect(port.unsubscribe).toHaveBeenCalledOnce();
  });

  it('installs MPV once, refreshes the player and runtime status, then reports success', async () => {
    const port = createPort();
    vi.mocked(port.loadStatus).mockResolvedValueOnce(initialStatus).mockResolvedValue(installedStatus);
    const afterMpvInstall = vi.fn(async () => undefined);
    const { result } = renderHook(() => useMediaRuntimeManagement({ active: true, port, afterMpvInstall }));

    await waitFor(() => expect(result.current.status).toEqual(initialStatus));
    await act(async () => {
      await result.current.install('mpv');
    });

    expect(port.install).toHaveBeenCalledOnce();
    expect(port.install).toHaveBeenCalledWith('mpv');
    expect(afterMpvInstall).toHaveBeenCalledOnce();
    expect(port.loadStatus).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBeNull();
    expect(result.current.message).toEqual({ text: 'MPV 已安装并设为应用内兼容播放内核。', kind: 'ok' });
  });

  it('keeps a successful installation visible when refreshing the player fails', async () => {
    const port = createPort();
    vi.mocked(port.loadStatus).mockResolvedValueOnce(initialStatus).mockResolvedValue(installedStatus);
    const { result } = renderHook(() => useMediaRuntimeManagement({
      active: true,
      port,
      afterMpvInstall: async () => { throw new Error('播放器刷新失败'); },
    }));

    await waitFor(() => expect(result.current.status).toEqual(initialStatus));
    await act(async () => {
      await result.current.install('mpv');
    });

    await waitFor(() => expect(result.current.status?.mpv.installed).toBe(true));
    expect(result.current.message).toEqual({ text: 'MPV 已安装，但播放器状态刷新失败：播放器刷新失败', kind: 'err' });
  });

  it('renders the optional runtime install flow through its injected port', async () => {
    const port = createPort();
    const afterMpvInstall = vi.fn(async () => undefined);
    render(<MediaRuntimeDownloadsSection active port={port} afterMpvInstall={afterMpvInstall} />);

    fireEvent.click(await screen.findByRole('button', { name: '一键下载并安装 MPV' }));

    await waitFor(() => expect(afterMpvInstall).toHaveBeenCalledOnce());
    expect(port.install).toHaveBeenCalledWith('mpv');
    expect(await screen.findByText('MPV 已安装并设为应用内兼容播放内核。')).toBeTruthy();
  });
});
