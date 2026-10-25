// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DriveWebLoginPort } from '../src/renderer/features/driveBinding/application/driveBindingPorts';
import { useDriveWebLogin } from '../src/renderer/features/driveBinding/useDriveWebLogin';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useDriveWebLogin', () => {
  it('runs web login through its port and reports the saved provider', async () => {
    const port: DriveWebLoginPort = { login: vi.fn(async () => undefined) };
    const onBound = vi.fn();
    const { result } = renderHook(() => useDriveWebLogin(port));

    await act(async () => { await result.current.actions.login('quark', onBound); });

    expect(port.login).toHaveBeenCalledWith('quark');
    expect(onBound).toHaveBeenCalledWith('quark');
    expect(result.current.model.message).toContain('已通过网页扫码保存');
    expect(result.current.model.busy).toBe(false);
  });

  it('returns login failures as user-facing presentation state', async () => {
    const port: DriveWebLoginPort = { login: vi.fn(async () => { throw new Error('web view closed'); }) };
    const { result } = renderHook(() => useDriveWebLogin(port));

    await act(async () => { await result.current.actions.login('quark', vi.fn()); });

    expect(result.current.model.message).toBe('登录失败：web view closed');
    expect(result.current.model.busy).toBe(false);
  });
});
