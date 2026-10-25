// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UcTvTokenPort } from '../src/renderer/features/driveBinding/application/driveBindingPorts';
import { useUcTvTokenBinding } from '../src/renderer/features/driveBinding/useUcTvTokenBinding';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useUcTvTokenBinding', () => {
  it('loads status, creates a QR code, and completes the polling flow', async () => {
    vi.useFakeTimers();
    const port: UcTvTokenPort = {
      status: vi.fn(async () => ({ bound: false })),
      createQr: vi.fn(async () => ({ imageDataUrl: 'data:image/png;base64,qr' })),
      pollQr: vi.fn(async () => ({ state: 'ok' as const })),
      remove: vi.fn(async () => undefined),
    };
    const onBound = vi.fn();
    const { result } = renderHook(() => useUcTvTokenBinding({ port, onBound }));
    await act(async () => { await Promise.resolve(); });
    expect(port.status).toHaveBeenCalledOnce();

    await act(async () => { await result.current.actions.create(); });
    expect(result.current.model.qr).toBe('data:image/png;base64,qr');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(port.pollQr).toHaveBeenCalledOnce();
    expect(result.current.model.bound).toBe(true);
    expect(onBound).toHaveBeenCalledOnce();
    expect(result.current.model.qr).toBe('');
  });

  it('reports an expired code and permits an explicit unbind', async () => {
    vi.useFakeTimers();
    const port: UcTvTokenPort = {
      status: vi.fn(async () => ({ bound: true })),
      createQr: vi.fn(async () => ({ imageDataUrl: 'qr' })),
      pollQr: vi.fn(async () => ({ state: 'expired' as const, hint: '过期' })),
      remove: vi.fn(async () => undefined),
    };
    const onBound = vi.fn();
    const { result } = renderHook(() => useUcTvTokenBinding({ port, onBound }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.model.bound).toBe(true);

    await act(async () => { await result.current.actions.create(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(result.current.model.message).toContain('过期');

    await act(async () => { await result.current.actions.unbind(); });
    expect(port.remove).toHaveBeenCalledOnce();
    expect(result.current.model.bound).toBe(false);
  });
});
