// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDriveBindingPrompt, type DriveBindingPromptPort } from '../src/renderer/features/playback/useDriveBindingPrompt';

afterEach(cleanup);

function makePort(credentials: () => Promise<Record<string, string>>): DriveBindingPromptPort {
  return {
    getCredentials: credentials,
    providerFromUrl: (url) => url.includes('quark') ? 'quark' : null,
  };
}

describe('useDriveBindingPrompt', () => {
  it('opens the matching provider when credentials are missing', async () => {
    const port = makePort(async () => ({}));
    const { result } = renderHook(() => useDriveBindingPrompt({ url: 'https://quark.example/video', port }));

    await waitFor(() => expect(result.current).toMatchObject({ provider: 'quark', modalOpen: true }));
  });

  it('does not prompt when the provider is already bound', async () => {
    const port = makePort(async () => ({ quark: 'cookie' }));
    const { result } = renderHook(() => useDriveBindingPrompt({ url: 'https://quark.example/video', port }));

    await waitFor(() => expect(result.current.provider).toBeNull());
    expect(result.current.modalOpen).toBe(false);
  });

  it('opens the prompt when credentials cannot be read', async () => {
    const port = makePort(async () => { throw new Error('IPC unavailable'); });
    const { result } = renderHook(() => useDriveBindingPrompt({ url: 'https://quark.example/video', port }));

    await waitFor(() => expect(result.current).toMatchObject({ provider: 'quark', modalOpen: true }));
  });

  it('ignores a credential response after the source changes', async () => {
    let resolveCredentials!: (value: Record<string, string>) => void;
    const port = makePort(() => new Promise((resolve) => { resolveCredentials = resolve; }));
    const { result, rerender } = renderHook(({ url }) => useDriveBindingPrompt({ url, port }), {
      initialProps: { url: 'https://quark.example/video' },
    });

    await waitFor(() => expect(resolveCredentials).toBeTypeOf('function'));
    rerender({ url: 'https://other.example/video' });
    await act(async () => { resolveCredentials({}); });
    expect(result.current.provider).toBeNull();
    expect(result.current.modalOpen).toBe(false);
  });

  it('dismisses the prompt and calls the playback continuation after saving', async () => {
    const port = makePort(async () => ({}));
    const onBound = vi.fn();
    const { result } = renderHook(() => useDriveBindingPrompt({ url: 'https://quark.example/video', port, onBound }));
    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    act(() => result.current.dismissNotice());
    expect(result.current).toMatchObject({ provider: null, modalOpen: false });
    act(() => result.current.onSaved());
    expect(onBound).toHaveBeenCalledOnce();
  });
});
