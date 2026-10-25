// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DlnaDevice } from '../src/shared/dlna';
import { LOCAL_PROXY_BASE } from '../src/shared/constants';
import type { DlnaCastingPort } from '../src/renderer/features/playback/application/dlnaCasting';
import { useDlnaCastPresenter } from '../src/renderer/features/playback/useDlnaCastPresenter';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const device: DlnaDevice = {
  udn: 'uuid:living-room',
  name: 'Living room TV',
  controlUrl: 'http://tv.local/avtransport',
  location: 'http://tv.local/description.xml',
};

const port: DlnaCastingPort = {
  discoverDevices: vi.fn(async () => [device]),
  castToDevice: vi.fn(async () => ({ ok: true, device: device.name })),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(port.discoverDevices).mockResolvedValue([device]);
  vi.mocked(port.castToDevice).mockResolvedValue({ ok: true, device: device.name });
});

describe('useDlnaCastPresenter', () => {
  it('discovers devices when opened and cancels a stale response after closing', async () => {
    let finishDiscovery!: (devices: readonly DlnaDevice[]) => void;
    vi.mocked(port.discoverDevices).mockImplementationOnce(() => new Promise(resolve => { finishDiscovery = resolve; }));
    const { result } = renderHook(() => useDlnaCastPresenter('https://media.example/movie.mp4', 'Movie', () => 0, port));

    act(() => result.current.actions.toggle());
    expect(result.current.model.open).toBe(true);
    expect(result.current.model.busy).toBe(true);
    act(() => result.current.actions.toggle());
    await act(async () => { finishDiscovery([device]); await Promise.resolve(); });

    expect(result.current.model.open).toBe(false);
    expect(result.current.model.devices).toEqual([]);
    expect(result.current.model.busy).toBe(false);
  });

  it('casts at the current playback position and closes after success', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDlnaCastPresenter('https://media.example/movie.mp4', 'Movie', () => 42.5, port));

    await act(async () => { await result.current.actions.castTo(device); });

    expect(port.castToDevice).toHaveBeenCalledWith(device, expect.objectContaining({
      url: 'https://media.example/movie.mp4',
      name: 'Movie',
      positionMs: 42500,
    }));
    expect(result.current.model.message).toBe('已投到「Living room TV」');
    act(() => { vi.advanceTimersByTime(1200); });
    expect(result.current.model.open).toBe(false);
    vi.useRealTimers();
  });

  it('keeps the local relay warning visible alongside the cast result', async () => {
    const { result } = renderHook(() => useDlnaCastPresenter(LOCAL_PROXY_BASE + '/bt/item', undefined, () => 0, port));

    await act(async () => { await result.current.actions.castTo(device); });

    expect(result.current.model.message).toContain('本机中继');
    expect(result.current.model.message).toContain('已投到「Living room TV」');
  });

  it('maps a rejected discovery operation to visible feedback', async () => {
    vi.mocked(port.discoverDevices).mockRejectedValueOnce('network is unavailable');
    const { result } = renderHook(() => useDlnaCastPresenter('https://media.example/movie.mp4', undefined, () => 0, port));

    act(() => result.current.actions.toggle());
    await waitFor(() => expect(result.current.model.message).toBe('network is unavailable'));
    expect(result.current.model.busy).toBe(false);
  });
});
