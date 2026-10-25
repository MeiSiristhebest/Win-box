import { useCallback, useState } from 'react';
import type { AuditItem, SourceBean } from '../../../shared/types';
import type { SourceHealthAuditPort } from './application/sourceHealthAudit';
import { removeFailedSources } from './application/sourceHealthAudit';
import type { AuditFilter, SourceHealthAuditNotice } from './sourceHealthAuditTypes';

interface SourceHealthAuditOptions {
  port: SourceHealthAuditPort;
  sources: readonly SourceBean[];
  activeProfileId: string;
  activeProfileName: string;
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }) => Promise<boolean>;
  refresh: () => Promise<unknown>;
}

export function useSourceHealthAuditPresenter({
  port,
  sources,
  activeProfileId,
  activeProfileName,
  confirm,
  refresh,
}: SourceHealthAuditOptions) {
  const [audit, setAudit] = useState<AuditItem[] | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [notice, setNotice] = useState<SourceHealthAuditNotice | null>(null);
  const [error, setError] = useState('');

  const runAudit = useCallback(async () => {
    setError('');
    setNotice(null);
    setAuditBusy(true);
    setAudit(null);
    try {
      setAudit(await port.run());
    } catch (error) {
      setError(`体检失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAuditBusy(false);
    }
  }, [port]);

  const deleteFailedSources = useCallback(async () => {
    if (!audit) return;
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

    setError('');
    setNotice(null);
    try {
      const result = await removeFailedSources(audit, sources, activeProfileId, activeProfileName, port);
      if (result.kind === 'no-failed-sources') return;
      if (result.kind === 'nothing-removed') {
        setNotice({ text: `删除失败：${result.failedCount} 个来源都未能移除`, kind: 'err' });
        return;
      }

      setAudit(null);
      if (result.kind === 'all-removed') {
        setNotice({
          text: `已删除全部 ${result.deletedCount} 个失败源（没有剩余源，未生成新配置）${result.deleteFailureCount ? `；另有 ${result.deleteFailureCount} 个源删除失败` : ''}`,
          kind: result.deleteFailureCount ? 'err' : 'ok',
        });
      } else {
        const partial = result.deleteFailureCount ? `；另有 ${result.deleteFailureCount} 个源删除失败` : '';
        const rename = result.profileUpdateError
          ? `；配置档案改名失败：${result.profileUpdateError}`
          : `；当前配置已更新为「${result.profileName}」`;
        setNotice({
          text: `已删除 ${result.deletedCount} 个失败源，剩余 ${result.remainingCount} 个源${rename}${partial}`,
          kind: result.profileUpdateError || result.deleteFailureCount ? 'err' : 'ok',
        });
      }
      await refresh();
    } catch (error) {
      setError(`清理失败：${error instanceof Error ? error.message : String(error)}`);
      await refresh().catch(() => undefined);
    }
  }, [activeProfileId, activeProfileName, audit, confirm, port, refresh, sources]);

  return { audit, auditBusy, filter, notice, error, setFilter, runAudit, deleteFailedSources };
}
