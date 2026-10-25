import { useCallback, useEffect, useRef, useState } from 'react';
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
    setSelectedSourceKeys((previous) => profileChanged ? new Set() : new Set([...previous].filter((key) => sourceKeys.has(key))));
    if (profileChanged || (editingKey && !sourceKeys.has(editingKey))) {
      setEditingKey(null);
      setDraft(null);
    }
  }, [profileId, sources, editingKey]);

  const clearFeedback = useCallback(() => {
    setError('');
    setNotice('');
  }, []);

  const refreshAfterMutation = useCallback(async () => {
    try {
      await refresh();
    } catch (refreshError) {
      setNotice(`操作已完成，但源列表刷新失败：${errorMessage(refreshError)}`);
    }
  }, [refresh]);

  const performMutation = useCallback(async (operation: () => Promise<void>, afterSuccess?: () => void) => {
    clearFeedback();
    try {
      await operation();
      afterSuccess?.();
      await refreshAfterMutation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    }
  }, [clearFeedback, refreshAfterMutation]);

  const chooseSource = useCallback(async (key: string) => {
    await performMutation(() => sourcesPort.activateSource(key));
  }, [performMutation, sourcesPort]);

  const deleteSource = useCallback(async (key: string) => {
    if (sourceDeleteBusy) return;
    setSourceDeleteBusy(true);
    await performMutation(
      () => sourcesPort.deleteSource(key),
      () => {
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
    await performMutation(
      () => sourcesPort.deleteSources(selected.map((source) => source.key)),
      () => {
        if (editingKey && selectedSourceKeys.has(editingKey)) {
          setEditingKey(null);
          setDraft(null);
        }
        setSelectedSourceKeys(new Set());
        setNotice(`已删除 ${selected.length} 个源`);
      },
    );
    setSourceDeleteBusy(false);
  }, [confirmDangerousAction, editingKey, performMutation, selectedSourceKeys, sourceDeleteBusy, sources, sourcesPort]);

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
    await performMutation(
      () => sourcesPort.setGlobalSourceBlock(keys, blocked),
      () => {
        setSelectedSourceKeys(new Set());
        setNotice(blocked ? `已全局屏蔽 ${keys.length} 个源` : '已解除全局屏蔽');
      },
    );
    setSourceDeleteBusy(false);
  }, [busy, confirmDangerousAction, performMutation, sourceDeleteBusy, sourcesPort]);

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
    await performMutation(() => sourcesPort.moveSource(key, direction));
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
