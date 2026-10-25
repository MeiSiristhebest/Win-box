// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceHealthAuditPort } from '../src/renderer/features/settings/application/sourceHealthAudit';
import { useSourceHealthAuditPresenter } from '../src/renderer/features/settings/useSourceHealthAuditPresenter';

describe('useSourceHealthAuditPresenter', () => {
  it('owns and clears errors produced by its own audit workflow', async () => {
    const port: SourceHealthAuditPort = {
      run: vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue([]),
      deleteSource: vi.fn().mockResolvedValue(undefined),
      renameProfile: vi.fn().mockResolvedValue(undefined),
      saveProfile: vi.fn().mockResolvedValue({ name: '档案' }),
    };
    const options = {
      port,
      sources: [],
      activeProfileId: '',
      activeProfileName: '',
      confirm: vi.fn(async () => false),
      refresh: vi.fn(async () => undefined),
    };
    const { result } = renderHook(() => useSourceHealthAuditPresenter(options));

    await act(async () => result.current.runAudit());
    expect(result.current.error).toBe('体检失败：network unavailable');

    await act(async () => result.current.runAudit());
    expect(result.current.error).toBe('');
    expect(result.current.audit).toEqual([]);
  });
});
