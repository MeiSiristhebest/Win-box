// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConfigRuntimeSyncRetryResult, ConfigRuntimeSyncStatus } from '../src/shared/types';
import type { IpcResult } from '../src/shared/ipc-result';
import { client, CONFIG_RUNTIME_SYNC_STATUS_EVENT } from '../src/renderer/api/client';
import { ConfigRuntimeSyncNotice } from '../src/renderer/features/configuration/ConfigRuntimeSyncNotice';
import type { ConfigRuntimeSyncNoticePort } from '../src/renderer/features/configuration/application/configRuntimeSyncNoticePort';

describe('configuration runtime sync recovery UI', () => {
  let status: ConfigRuntimeSyncStatus;
  const runtimeSyncStatus = vi.fn(async (): Promise<IpcResult<ConfigRuntimeSyncStatus>> => ({ ok: true, data: status }));
  const retryRuntimeSync = vi.fn(async (): Promise<IpcResult<ConfigRuntimeSyncRetryResult>> => {
    status = { status: 'synchronized', revision: 8, pendingRevision: null };
    return { ok: true, data: { status: 'synchronized', revision: 8 } };
  });
  const onSubscriptionImportProgress = vi.fn(() => () => undefined);

  beforeEach(() => {
    status = {
      status: 'failed', revision: 7, pendingRevision: 7,
      error: { name: 'Error', message: 'runtime projection failed' },
    };
    runtimeSyncStatus.mockClear();
    retryRuntimeSync.mockClear();
    onSubscriptionImportProgress.mockClear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        config: { runtimeSyncStatus, retryRuntimeSync, onSubscriptionImportProgress },
      },
    });
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'api');
  });

  it('preserves the existing mutation result while broadcasting runtime failure status', async () => {
    const source = { key: 'fixture', name: 'Fixture' };
    const addSource = vi.fn(async () => ({ ok: true as const, data: source }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { config: { addSource, runtimeSyncStatus, retryRuntimeSync, onSubscriptionImportProgress } },
    });
    const seen: ConfigRuntimeSyncStatus[] = [];
    const onStatus = (event: Event): void => {
      seen.push((event as CustomEvent<ConfigRuntimeSyncStatus>).detail);
    };
    window.addEventListener(CONFIG_RUNTIME_SYNC_STATUS_EVENT, onStatus);

    await expect(client.cfgAddSource(source as never)).resolves.toBe(source);
    await waitFor(() => expect(seen).toContainEqual(status));

    window.removeEventListener(CONFIG_RUNTIME_SYNC_STATUS_EVENT, onStatus);
    expect(addSource).toHaveBeenCalledOnce();
    expect(runtimeSyncStatus).toHaveBeenCalledOnce();
  });

  it('shows the saved-data warning and retries the runtime projection', async () => {
    const listeners = new Set<(next: ConfigRuntimeSyncStatus) => void>();
    const portRetry = vi.fn(async (): Promise<ConfigRuntimeSyncRetryResult> => {
      status = { status: 'synchronized', revision: 8, pendingRevision: null };
      for (const listener of listeners) listener(status);
      return { status: 'synchronized', revision: 8 };
    });
    const port: ConfigRuntimeSyncNoticePort = {
      getStatus: async () => status,
      retry: portRetry,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    render(<ConfigRuntimeSyncNotice port={port} />);

    expect((await screen.findByRole('alert')).textContent).toContain('数据已保存，但运行时同步失败');
    expect(screen.getByText('runtime projection failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试同步' }));

    await waitFor(() => expect(portRetry).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
