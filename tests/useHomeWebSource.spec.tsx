// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import type { HomeWebSourcePort } from '../src/renderer/features/home/application/homePorts';
import { useHomeWebSource } from '../src/renderer/features/home/useHomeWebSource';

const sourceA = {
  key: 'source-a',
  name: 'Source A',
  api: 'https://source-a.invalid/api',
  ext: 'token=a',
  homePage: ' https://source-a.invalid/home ',
} as SourceBean;

describe('useHomeWebSource', () => {
  it('opens the selected source home with a normalized URL and source metadata', async () => {
    const port: HomeWebSourcePort = { open: vi.fn(async () => ({ ok: true })) };
    const { result } = renderHook(() => useHomeWebSource({ source: sourceA, port }));

    await act(async () => result.current.open());

    expect(port.open).toHaveBeenCalledWith({
      url: 'https://source-a.invalid/home',
      title: 'Source A · 网页',
      site: {
        key: 'source-a',
        name: 'Source A',
        api: 'https://source-a.invalid/api',
        ext: 'token=a',
        homePage: 'https://source-a.invalid/home',
      },
    });
    expect(result.current.opening).toBe(false);
  });

  it('keeps web-window errors local to the web-source workflow', async () => {
    const port: HomeWebSourcePort = { open: vi.fn(async () => ({ ok: false, error: 'blocked' })) };
    const { result } = renderHook(() => useHomeWebSource({ source: sourceA, port }));

    await act(async () => result.current.open());

    expect(result.current.error).toBe('blocked');
  });

  it('ignores a late result after the selected source changes', async () => {
    let resolve!: (value: { ok: boolean; error?: string }) => void;
    const pending = new Promise<{ ok: boolean; error?: string }>((done) => { resolve = done; });
    const port: HomeWebSourcePort = { open: vi.fn(() => pending) };
    const { result, rerender } = renderHook(
      ({ source }) => useHomeWebSource({ source, port }),
      { initialProps: { source: sourceA as SourceBean | undefined } },
    );

    let opening!: Promise<void>;
    act(() => { opening = result.current.open(); });
    rerender({ source: { ...sourceA, key: 'source-b', homePage: 'https://source-b.invalid/home' } as SourceBean });
    resolve({ ok: false, error: 'stale source failure' });
    await act(async () => opening);

    expect(result.current.error).toBe('');
    expect(result.current.opening).toBe(false);
  });
});
