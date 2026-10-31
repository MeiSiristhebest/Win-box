import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AuditItem, SourceBean } from '../../../shared/types';
import { sourceConfigurationSignature } from '../../../shared/sourceConfigurationSignature';
import type { SourceHealthAuditPort } from './application/sourceHealthAudit';
import { PartialFailedSourceCleanupError, removeFailedSources } from './application/sourceHealthAudit';
import type { AuditFilter, SourceHealthAuditNotice } from './sourceHealthAuditTypes';

interface SourceHealthAuditOptions {
  port: SourceHealthAuditPort;
  sources: readonly SourceBean[];
  activeProfileId: string;
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }) => Promise<boolean>;
  refresh: () => Promise<unknown>;
}

interface AuditSnapshot {
  profileId: string;
  sourceSignature: string;
  items: AuditItem[];
}

export function useSourceHealthAuditPresenter({
  port,
  sources,
  activeProfileId,
  confirm,
  refresh,
}: SourceHealthAuditOptions) {
  const [auditSnapshot, setAuditSnapshot] = useState<AuditSnapshot | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [notice, setNotice] = useState<SourceHealthAuditNotice | null>(null);
  const [error, setError] = useState('');
  const currentSourceSignature = useMemo(() => sourceConfigurationSignature(sources), [sources]);
  const currentContext = useRef({ profileId: activeProfileId, sourceSignature: currentSourceSignature });
  useLayoutEffect(() => {
    currentContext.current = { profileId: activeProfileId, sourceSignature: currentSourceSignature };
  }, [activeProfileId, currentSourceSignature]);
  const audit = auditSnapshot?.profileId === activeProfileId
    && auditSnapshot.sourceSignature === currentSourceSignature
    ? auditSnapshot.items
    : null;

  const runAudit = useCallback(async () => {
    const context = { profileId: activeProfileId, sourceSignature: currentSourceSignature };
    setError('');
    setNotice(null);
    setAuditBusy(true);
    setAuditSnapshot(null);
    try {
      const items = await port.run(context.profileId);
      if (currentContext.current.profileId === context.profileId && currentContext.current.sourceSignature === context.sourceSignature) {
        setAuditSnapshot({ ...context, items });
      }
    } catch (error) {
      if (currentContext.current.profileId === context.profileId && currentContext.current.sourceSignature === context.sourceSignature) {
        setError(`体检失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      setAuditBusy(false);
    }
  }, [activeProfileId, currentSourceSignature, port]);

  const deleteFailedSources = useCallback(async () => {
    if (!audit || !auditSnapshot) return;
    const context = { profileId: auditSnapshot.profileId, sourceSignature: auditSnapshot.sourceSignature };
    const failed = audit.filter((item) => item.health === 'error');
    if (failed.length === 0) {
      setNotice({ text: '没有体检为「失败/报错」的源可删', kind: 'err' });
      return;
    }
    const names = failed.slice(0, 6).map((item) => item.name).join('、');
    const accepted = await confirm(
      `确定删除 ${failed.length} 个体检失败源吗？\n（${names}${failed.length > 6 ? '…' : ''}）\n此操作只影响当前列表并写入应用配置，不会改动任何导入的原始 JSON 文件。`,
      { title: '删除体检失败源', confirmLabel: '删除', tone: 'danger' },
    );
    if (!accepted) return;
    if (currentContext.current.profileId !== context.profileId || currentContext.current.sourceSignature !== context.sourceSignature) {
      setAuditSnapshot(null);
      setNotice({ text: '档案或线路列表已变化，请重新体检后再清理。', kind: 'err' });
      return;
    }

    setError('');
    setNotice(null);
    try {
      const result = await removeFailedSources(audit, sources, context.profileId, port);
      if (result.kind === 'no-failed-sources') return;
      if (result.kind === 'nothing-removed') {
        setNotice({ text: `删除失败：${result.failedCount} 个来源都未能移除`, kind: 'err' });
        return;
      }

      port.announceSourcesChanged();
      setAuditSnapshot(null);
      if (result.kind === 'all-removed') {
        setNotice({
          text: `已从当前档案删除全部 ${result.deletedCount} 个请求失败线路。`,
          kind: 'ok',
        });
      } else {
        setNotice({
          text: `已从当前档案删除 ${result.deletedCount} 个请求失败线路，剩余 ${result.remainingCount} 个。档案名称保持不变。`,
          kind: 'ok',
        });
      }
      await refresh();
    } catch (error) {
      if (error instanceof PartialFailedSourceCleanupError) port.announceSourcesChanged();
      setError(`清理失败：${error instanceof Error ? error.message : String(error)}`);
      await refresh().catch(() => undefined);
    }
  }, [audit, auditSnapshot, confirm, port, refresh, sources]);

  return { audit, auditBusy, filter, notice, error, setFilter, runAudit, deleteFailedSources };
}
