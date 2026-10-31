import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_SOURCE_CONFIGURATION_BATCH_SIZE } from '../../../shared/sourceConfigurationSignature';
import type { SourceBean } from '../../../shared/types';
import type { SourceManagementPort } from './application/settingsSectionPorts';
import { createSourceManagementDraft, toSourceUpdatePatch, type SourceManagementDraft } from './sourceManagementDraft';

type ConfirmDangerousSourceAction = (message: string, title: string, confirmLabel: string) => Promise<boolean>;

interface SourceManagementPresenterOptions {
  sources: readonly SourceBean[];
  profileId: string;
  busy: boolean;
  refresh: () => Promise<void>;
  confirmDangerousAction: ConfirmDangerousSourceAction;
  sourcesPort: SourceManagementPort;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSourceKeyBatches<T>(
  sourceKeys: readonly string[],
  operation: (batch: string[]) => Promise<T>,
): Promise<
  | { completedKeys: string[]; results: T[]; failed: false }
  | { completedKeys: string[]; results: T[]; failed: true; error: unknown }
> {
  const keys = [...new Set(sourceKeys)];
  const completedKeys: string[] = [];
  const results: T[] = [];
  for (let offset = 0; offset < keys.length; offset += MAX_SOURCE_CONFIGURATION_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + MAX_SOURCE_CONFIGURATION_BATCH_SIZE);
    try {
      results.push(await operation(batch));
      completedKeys.push(...batch);
    } catch (error) {
      return { completedKeys, results, failed: true, error };
    }
  }
  return { completedKeys, results, failed: false };
}

export function useSourceManagementPresenter({
  sources,
  profileId,
  busy,
  refresh,
  confirmDangerousAction,
  sourcesPort,
}: SourceManagementPresenterOptions) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<SourceManagementDraft | null>(null);
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(() => new Set());
  const [sourceDeleteBusy, setSourceDeleteBusy] = useState(false);
  const [diagRequest, setDiagRequest] = useState<{ sourceKey: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const diagnosticsRevision = useRef(0);
  const previousProfileId = useRef(profileId);

  const selectedSourceCount = sources.reduce((count, source) => count + Number(selectedSourceKeys.has(source.key)), 0);
  const allSourcesSelected = sources.length > 0 && selectedSourceCount === sources.length;

  useEffect(() => {
    const profileChanged = previousProfileId.current !== profileId;
    previousProfileId.current = profileId;
    const sourceKeys = new Set(sources.map((source) => source.key));
    setSelectedSourceKeys((previous) => {
      const next = profileChanged
        ? new Set<string>()
        : new Set([...previous].filter((key) => sourceKeys.has(key)));
      // Source arrays may be recreated by a caller on every render. Return the
      // existing Set when there is nothing to prune so the effect cannot
      // trigger an endless state-update loop.
      return next.size === previous.size ? previous : next;
    });
    if (profileChanged || (editingKey && !sourceKeys.has(editingKey))) {
      setEditingKey(null);
      setDraft(null);
    }
  }, [profileId, sources, editingKey]);

  const clearFeedback = useCallback(() => {
    setError('');
    setNotice('');
  }, []);

  const refreshAfterMutation = useCallback(async (): Promise<string | null> => {
    try {
      await refresh();
      return null;
    } catch (refreshError) {
      return errorMessage(refreshError);
    }
  }, [refresh]);

  const performMutation = useCallback(async <T,>(operation: () => Promise<T>, afterSuccess?: (result: T) => void) => {
    clearFeedback();
    try {
      const result = await operation();
      afterSuccess?.(result);
      const refreshError = await refreshAfterMutation();
      if (refreshError) setNotice(`操作已完成，但源列表刷新失败：${refreshError}`);
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  }, [clearFeedback, refreshAfterMutation]);

  const chooseSource = useCallback(async (key: string) => {
    await performMutation(() => sourcesPort.activateSource(key), () => sourcesPort.announceSourceChanged(key));
  }, [performMutation, sourcesPort]);

  const deleteSource = useCallback(async (key: string) => {
    if (sourceDeleteBusy) return;
    setSourceDeleteBusy(true);
    await performMutation(
      () => sourcesPort.deleteSource(key),
      () => {
        sourcesPort.announceSourcesChanged();
        if (editingKey === key) {
          setEditingKey(null);
          setDraft(null);
        }
        setNotice('源已删除');
      },
    );
    setSourceDeleteBusy(false);
  }, [editingKey, performMutation, sourceDeleteBusy, sourcesPort]);

  const deleteSelectedSources = useCallback(async () => {
    const selected = sources.filter((source) => selectedSourceKeys.has(source.key));
    if (selected.length === 0 || sourceDeleteBusy) return;
    const names = selected.slice(0, 6).map((source) => source.name || source.key).join('、');
    const more = selected.length > 6 ? '…' : '';
    const accepted = await confirmDangerousAction(
      `确定删除选中的 ${selected.length} 个源吗？\n${names}${more}\n原始文件不会被修改；不再被其它档案引用的导入脚本副本将被清理。`,
      '删除所选源',
      '删除',
    );
    if (!accepted) return;

    setSourceDeleteBusy(true);
    clearFeedback();
    try {
      const selectedKeys = selected.map((source) => source.key);
      const result = await runSourceKeyBatches(selectedKeys, (batch) => sourcesPort.deleteSources(batch, profileId));
      const requestedKeys = new Set(selectedKeys);
      const removed = new Set(result.results.flatMap((keys) => keys).filter((key) => requestedKeys.has(key)));
      if (removed.size > 0) sourcesPort.announceSourcesChanged();
      if (editingKey && removed.has(editingKey)) {
        setEditingKey(null);
        setDraft(null);
      }
      setSelectedSourceKeys((previous) => new Set([...previous].filter((key) => !removed.has(key))));
      const refreshError = await refreshAfterMutation();
      if (result.failed) {
        setError(errorMessage(result.error));
        setNotice(`已删除 ${removed.size} 个源；后续批次失败，剩余项仍保留在选择中。${refreshError ? ` 源列表刷新失败：${refreshError}` : ''}`);
      } else {
        setNotice(removed.size > 0
          ? `已删除 ${removed.size} 个源${refreshError ? `；源列表刷新失败：${refreshError}` : ''}`
          : `所选源已不存在，无需删除${refreshError ? `；源列表刷新失败：${refreshError}` : ''}`);
      }
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setSourceDeleteBusy(false);
    }
  }, [clearFeedback, confirmDangerousAction, editingKey, profileId, refreshAfterMutation, selectedSourceKeys, sourceDeleteBusy, sources, sourcesPort]);

  const setGlobalBlock = useCallback(async (keys: string[], blocked: boolean) => {
    if (keys.length === 0 || sourceDeleteBusy || busy) return;
    if (blocked) {
      const accepted = await confirmDangerousAction(
        `将在所有子仓中隐藏这些 key 的源，之后可在全局屏蔽列表中解除。\n${keys.slice(0, 6).join('、')}`,
        '全局屏蔽所选源',
        '全局屏蔽',
      );
      if (!accepted) return;
    }

    setSourceDeleteBusy(true);
    clearFeedback();
    try {
      const result = await runSourceKeyBatches(keys, (batch) => sourcesPort.setGlobalSourceBlock(batch, blocked));
      const completed = new Set(result.completedKeys);
      if (completed.size > 0) sourcesPort.announceSourcesChanged();
      setSelectedSourceKeys((previous) => new Set([...previous].filter((key) => !completed.has(key))));
      const refreshError = await refreshAfterMutation();
      if (result.failed) {
        setError(errorMessage(result.error));
        if (completed.size > 0) setNotice(`已处理 ${completed.size} 个源；后续批次失败，剩余项仍保留在选择中。${refreshError ? ` 源列表刷新失败：${refreshError}` : ''}`);
      } else {
        setNotice(`${blocked ? '已全局屏蔽' : '已解除全局屏蔽'} ${completed.size} 个源${refreshError ? `；源列表刷新失败：${refreshError}` : ''}`);
      }
    } finally {
      setSourceDeleteBusy(false);
    }
  }, [busy, clearFeedback, confirmDangerousAction, refreshAfterMutation, sourceDeleteBusy, sourcesPort]);

  const toggleSourcePick = useCallback((key: string) => {
    setSelectedSourceKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setAllSourcePicks = useCallback((selected: boolean) => {
    setSelectedSourceKeys(selected ? new Set(sources.map((source) => source.key)) : new Set());
  }, [sources]);

  const moveSource = useCallback(async (key: string, direction: 'up' | 'down' | 'top' | 'bottom') => {
    await performMutation(() => sourcesPort.moveSource(key, direction), () => sourcesPort.announceSourcesChanged());
  }, [performMutation, sourcesPort]);

  const startEdit = useCallback((source: SourceBean) => {
    setEditingKey(source.key);
    setDraft(createSourceManagementDraft(source));
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingKey(null);
    setDraft(null);
  }, []);

  const changeDraft = useCallback(<K extends keyof SourceManagementDraft>(field: K, value: SourceManagementDraft[K]) => {
    setDraft((previous) => previous ? { ...previous, [field]: value } : previous);
  }, []);

  const applyExtTemplate = useCallback((json: string) => {
    changeDraft('ext', json);
  }, [changeDraft]);

  const saveEdit = useCallback(async (key: string) => {
    if (!draft) return;
    await performMutation(
      () => sourcesPort.updateSource(key, toSourceUpdatePatch(draft)),
      () => {
        sourcesPort.announceSourcesChanged();
        setEditingKey(null);
        setDraft(null);
      },
    );
  }, [draft, performMutation, sourcesPort]);

  const runDiagnose = useCallback((sourceKey: string) => {
    setDiagRequest({ sourceKey, revision: ++diagnosticsRevision.current });
  }, []);

  const closeDiagnostics = useCallback(() => setDiagRequest(null), []);

  const clearSelection = useCallback(() => setSelectedSourceKeys(new Set()), []);

  return {
    editingKey,
    draft,
    selectedSourceKeys,
    sourceDeleteBusy,
    diagRequest,
    error,
    notice,
    selectedSourceCount,
    allSourcesSelected,
    actions: {
      chooseSource,
      deleteSource,
      deleteSelectedSources,
      setGlobalBlock,
      toggleSourcePick,
      setAllSourcePicks,
      clearSelection,
      moveSource,
      startEdit,
      cancelEdit,
      changeDraft,
      applyExtTemplate,
      saveEdit,
      runDiagnose,
      closeDiagnostics,
      clearFeedback,
    },
  };
}
