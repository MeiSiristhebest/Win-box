// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AuditItem, SourceBean } from '../src/shared/types';
import type { SourceHealthAuditPort } from '../src/renderer/features/settings/application/sourceHealthAudit';
import { useSourceHealthAuditPresenter } from '../src/renderer/features/settings/useSourceHealthAuditPresenter';

describe('useSourceHealthAuditPresenter', () => {
  it('broadcasts the source removal so open pickers reload their profile snapshots', async () => {
    const source: SourceBean = {
      key: 'source-a', name: 'A', type: 0, api: 'https://a.test', searchable: 1, quickSearch: 1, changeable: 1, filterable: 1,
      playUrl: '', ext: '', jar: '', playerType: -1, categories: null, timeout: 15, click: '', style: '',
    };
    const port: SourceHealthAuditPort = {
      run: vi.fn().mockResolvedValue([{
        key: 'source-a', name: 'A', type: 0, kind: 'cms-json', items: 0, classes: 0, extEmpty: true,
        ms: 0, health: 'error', usable: false, needsExt: false, advice: 'request-failed',
      }]),
      deleteSources: vi.fn().mockResolvedValue(['source-a']),
      announceSourcesChanged: vi.fn(),
    };
    const refresh = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSourceHealthAuditPresenter({
      port, sources: [source], activeProfileId: 'profile-a', confirm: vi.fn(async () => true), refresh,
    }));

    await act(async () => { await result.current.runAudit(); });
    await act(async () => { await result.current.deleteFailedSources(); });

    expect(port.deleteSources).toHaveBeenCalledOnce();
    expect(port.announceSourcesChanged).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.audit).toBeNull();
  });

  it('owns and clears errors produced by its own audit workflow', async () => {
    const port: SourceHealthAuditPort = {
      run: vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue([]),
      deleteSources: vi.fn().mockResolvedValue([]),
      announceSourcesChanged: vi.fn(),
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

  it('invalidates audit results when the profile changes while the check is running', async () => {
    let resolveAudit!: (items: AuditItem[]) => void;
    const port: SourceHealthAuditPort = {
      run: vi.fn(() => new Promise<AuditItem[]>(resolve => { resolveAudit = resolve; })),
      deleteSources: vi.fn().mockResolvedValue([]),
      announceSourcesChanged: vi.fn(),
    };
    const sources: SourceBean[] = [{
      key: 'a', name: 'A', type: 0, api: 'https://a.test',
      searchable: 1, quickSearch: 1, changeable: 1, filterable: 1,
      playUrl: '', ext: '', jar: '', playerType: -1, categories: null,
      timeout: 15, click: '', style: '',
    }];
    const baseOptions = {
      port,
      sources,
      activeProfileId: 'profile-a',
      confirm: vi.fn(async () => false),
      refresh: vi.fn(async () => undefined),
    };
    const { result, rerender } = renderHook((options) => useSourceHealthAuditPresenter(options), { initialProps: baseOptions });
    let request!: Promise<void>;
    await act(async () => { request = result.current.runAudit(); });
    rerender({ ...baseOptions, activeProfileId: 'profile-b' });
    await act(async () => { resolveAudit([]); await request; });

    expect(result.current.audit).toBeNull();
    rerender({ ...baseOptions, activeProfileId: 'profile-a' });
    expect(result.current.audit).toBeNull();
  });
});
