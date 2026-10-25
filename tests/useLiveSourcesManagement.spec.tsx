// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSourcesManagementPort } from '../src/renderer/features/subscriptions/application/liveSourcesPort';
import { useLiveSourcesManagement } from '../src/renderer/features/subscriptions/useLiveSourcesManagement';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const port: LiveSourcesManagementPort = {
  selectLiveSource: vi.fn(async () => undefined),
  deleteLiveSource: vi.fn(async () => undefined),
  renameLiveSource: vi.fn(async () => undefined),
};
const onRefresh = vi.fn(async () => undefined);
const confirmRemoval = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLiveSourcesManagement', () => {
  it('selects a live source through its port and refreshes the configuration', async () => {
    const { result } = renderHook(() => useLiveSourcesManagement({ port, onRefresh, confirmRemoval }));

    await act(async () => result.current.actions.select(2));

    expect(port.selectLiveSource).toHaveBeenCalledWith(2);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.model.error).toBe('');
  });

  it('does not delete a source when confirmation is declined', async () => {
    confirmRemoval.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useLiveSourcesManagement({ port, onRefresh, confirmRemoval }));

    await act(async () => result.current.actions.remove(0, '新闻直播'));

    expect(confirmRemoval).toHaveBeenCalledWith('新闻直播', 0);
    expect(port.deleteLiveSource).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('confirms before deletion, clears a matching edit, and refreshes', async () => {
    const { result } = renderHook(() => useLiveSourcesManagement({ port, onRefresh, confirmRemoval }));
    act(() => result.current.actions.beginRename(3, '旧名'));
    expect(result.current.model).toMatchObject({ editingIndex: 3, draftName: '旧名', error: '', notice: '' });

    await act(async () => result.current.actions.remove(3, '旧名'));

    expect(port.deleteLiveSource).toHaveBeenCalledWith(3);
    expect(result.current.model).toMatchObject({ editingIndex: null, draftName: '', error: '', notice: '已删除直播线路「旧名」' });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('trims a saved name and skips empty names', async () => {
    const { result } = renderHook(() => useLiveSourcesManagement({ port, onRefresh, confirmRemoval }));
    act(() => result.current.actions.beginRename(1, '旧名'));
    act(() => result.current.actions.changeDraftName('  新名字  '));
    await act(async () => result.current.actions.saveName(1));

    expect(port.renameLiveSource).toHaveBeenCalledWith({ index: 1, name: '新名字' });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(result.current.model).toMatchObject({ editingIndex: null, draftName: '', error: '', notice: '已将直播线路改名为「新名字」' });

    act(() => result.current.actions.beginRename(2, '名称'));
    act(() => result.current.actions.changeDraftName('  '));
    await act(async () => result.current.actions.saveName(2));
    expect(port.renameLiveSource).toHaveBeenCalledOnce();
    expect(result.current.model.error).toBe('线路名称不能为空');
  });

  it('keeps operation errors with the live source management state', async () => {
    vi.mocked(port.selectLiveSource).mockRejectedValueOnce(new Error('configuration is locked'));
    const { result } = renderHook(() => useLiveSourcesManagement({ port, onRefresh, confirmRemoval }));

    await act(async () => result.current.actions.select(4));

    expect(result.current.model.error).toBe('configuration is locked');
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
