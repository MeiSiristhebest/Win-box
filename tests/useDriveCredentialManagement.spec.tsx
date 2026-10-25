// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveCredentialsPort } from '../src/renderer/features/driveBinding/application/driveBindingPorts';
import { useDriveCredentialManagement } from '../src/renderer/features/driveBinding/useDriveCredentialManagement';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const port: DriveCredentialsPort = {
  load: vi.fn(async () => ({})),
  save: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
};
const onSaved = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('useDriveCredentialManagement', () => {
  it('loads global credentials and saves through the consumer port', async () => {
    vi.mocked(port.load).mockResolvedValueOnce({ quark: 'cookie-value' });
    const { result } = renderHook(() => useDriveCredentialManagement({ port, onSaved }));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.model.credentials).toEqual({ quark: 'cookie-value' });
    act(() => result.current.actions.changeCookie('__pus=123; __puus=456'));
    await act(async () => { await result.current.actions.save(); });

    expect(port.save).toHaveBeenCalledWith('quark', '__pus=123; __puus=456');
    expect(result.current.model.cookie).toBe('');
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('does not submit an empty credential', async () => {
    const { result } = renderHook(() => useDriveCredentialManagement({ port, onSaved }));
    let saved = true;
    await act(async () => { saved = await result.current.actions.save(); });

    expect(saved).toBe(false);
    expect(port.save).not.toHaveBeenCalled();
    expect(result.current.model.message).toBe('请先粘贴 Cookie');
  });

  it('removes the selected provider and refreshes global credential state', async () => {
    const { result } = renderHook(() => useDriveCredentialManagement({ port, onSaved }));
    await act(async () => { await result.current.actions.unbind(); });

    expect(port.remove).toHaveBeenCalledWith('quark');
    expect(port.load).toHaveBeenCalledTimes(2);
    expect(result.current.model.message).toBe('已解绑「夸克」');
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('prevents duplicate in-flight credential writes', async () => {
    let finish!: () => void;
    vi.mocked(port.save).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useDriveCredentialManagement({ port, onSaved }));
    act(() => result.current.actions.changeCookie('cookie'));

    let first!: Promise<boolean>;
    await act(async () => {
      first = result.current.actions.save();
      await Promise.resolve();
      expect(await result.current.actions.save()).toBe(false);
    });
    expect(port.save).toHaveBeenCalledOnce();

    await act(async () => { finish(); await first; });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
