// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import type { SourceManagementPort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import { useSourceManagementPresenter } from '../src/renderer/features/settings/useSourceManagementPresenter';

function source(key: string): SourceBean {
  return {
    key,
    name: key,
    type: 0,
    api: `https://${key}.example.test/api`,
    ext: '',
    jar: '',
    playUrl: '',
    timeout: 15,
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
  } as SourceBean;
}

function createPort(): SourceManagementPort {
  return {
    activateSource: vi.fn(async () => undefined),
    deleteSource: vi.fn(async () => undefined),
    deleteSources: vi.fn(async (keys: string[]) => keys),
    setGlobalSourceBlock: vi.fn(async () => undefined),
    moveSource: vi.fn(async () => undefined),
    updateSource: vi.fn(async () => undefined),
  };
}

describe('useSourceManagementPresenter', () => {
  it('deletes more than one IPC batch and preserves selection after a partial failure', async () => {
    const sources = Array.from({ length: 1001 }, (_, index) => source(`source-${index}`));
    const sourcesPort = createPort();
    vi.mocked(sourcesPort.deleteSources)
      .mockResolvedValueOnce(sources.slice(0, 1000).map((item) => item.key))
      .mockRejectedValueOnce(new Error('IPC unavailable'));
    const refresh = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSourceManagementPresenter({
      sources,
      profileId: 'profile-a',
      busy: false,
      refresh,
      confirmDangerousAction: vi.fn(async () => true),
      sourcesPort,
    }));

    act(() => result.current.actions.setAllSourcePicks(true));
    await act(async () => { await result.current.actions.deleteSelectedSources(); });

    expect(sourcesPort.deleteSources).toHaveBeenNthCalledWith(1, sources.slice(0, 1000).map((item) => item.key), 'profile-a');
    expect(sourcesPort.deleteSources).toHaveBeenNthCalledWith(2, ['source-1000'], 'profile-a');
    expect(result.current.selectedSourceCount).toBe(1);
    expect(result.current.selectedSourceKeys.has('source-1000')).toBe(true);
    expect(result.current.notice).toContain('已删除 1000 个源');
    expect(result.current.error).toBe('IPC unavailable');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes the active list when selected source keys are already gone', async () => {
    const sources = [source('source-a')];
    const sourcesPort = createPort();
    vi.mocked(sourcesPort.deleteSources).mockResolvedValue([]);
    const refresh = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSourceManagementPresenter({
      sources,
      profileId: 'profile-a',
      busy: false,
      refresh,
      confirmDangerousAction: vi.fn(async () => true),
      sourcesPort,
    }));

    act(() => result.current.actions.setAllSourcePicks(true));
    await act(async () => { await result.current.actions.deleteSelectedSources(); });

    expect(sourcesPort.deleteSources).toHaveBeenCalledWith(['source-a'], 'profile-a');
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.notice).toContain('所选源已不存在');
  });

  it('splits large global block changes into IPC-safe batches', async () => {
    const sources = Array.from({ length: 1001 }, (_, index) => source(`source-${index}`));
    const sourcesPort = createPort();
    const { result } = renderHook(() => useSourceManagementPresenter({
      sources,
      profileId: 'profile-a',
      busy: false,
      refresh: vi.fn(async () => undefined),
      confirmDangerousAction: vi.fn(async () => true),
      sourcesPort,
    }));

    act(() => result.current.actions.setAllSourcePicks(true));
    await act(async () => { await result.current.actions.setGlobalBlock(sources.map((item) => item.key), true); });

    expect(sourcesPort.setGlobalSourceBlock).toHaveBeenNthCalledWith(1, sources.slice(0, 1000).map((item) => item.key), true);
    expect(sourcesPort.setGlobalSourceBlock).toHaveBeenNthCalledWith(2, ['source-1000'], true);
    expect(result.current.selectedSourceCount).toBe(0);
  });
});
