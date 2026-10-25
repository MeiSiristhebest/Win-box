import { useCallback, useState } from 'react';
import type { LiveSourcesManagementPort } from './application/liveSourcesPort';

interface LiveSourcesManagementOptions {
  port: LiveSourcesManagementPort;
  onRefresh: () => Promise<void>;
  confirmRemoval: (displayName: string, index: number) => Promise<boolean>;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLiveSourcesManagement({ port, onRefresh, confirmRemoval }: LiveSourcesManagementOptions) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const runMutation = useCallback(async (operation: () => Promise<void>, successNotice: string, afterSuccess?: () => void) => {
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (operationError) {
      setError(describeFailure(operationError));
      return;
    }

    afterSuccess?.();
    try {
      await onRefresh();
      if (successNotice) setNotice(successNotice);
    } catch (refreshError) {
      setNotice(`操作已完成，但直播线路刷新失败：${describeFailure(refreshError)}`);
    }
  }, [onRefresh]);

  const beginRename = useCallback((index: number, currentName: string) => {
    setEditingIndex(index);
    setDraftName(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    setEditingIndex(null);
    setDraftName('');
  }, []);

  const changeDraftName = useCallback((name: string) => {
    setDraftName(name);
  }, []);

  const select = useCallback(async (index: number) => {
    await runMutation(() => port.selectLiveSource(index), '');
  }, [port, runMutation]);

  const remove = useCallback(async (index: number, name: string) => {
    const displayName = name || `线路${index + 1}`;
    if (!await confirmRemoval(displayName, index)) return;
    await runMutation(
      () => port.deleteLiveSource(index),
      `已删除直播线路「${displayName}」`,
      () => { if (editingIndex === index) cancelRename(); },
    );
  }, [cancelRename, confirmRemoval, editingIndex, port, runMutation]);

  const saveName = useCallback(async (index: number) => {
    const name = draftName.trim();
    if (!name) {
      setError('线路名称不能为空');
      return;
    }
    await runMutation(
      () => port.renameLiveSource({ index, name }),
      `已将直播线路改名为「${name}」`,
      cancelRename,
    );
  }, [cancelRename, draftName, port, runMutation]);

  return {
    model: { editingIndex, draftName, error, notice },
    actions: { beginRename, cancelRename, changeDraftName, select, remove, saveName },
  };
}
