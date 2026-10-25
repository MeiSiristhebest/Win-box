import { useCallback, useState } from 'react';
import type { SubscriptionRefreshResolution } from '../../../shared/types';
import type { SubscriptionGroupManagementPort } from './application/subscriptionGroupManagement';

interface SubscriptionGroupManagementOptions {
  port: SubscriptionGroupManagementPort;
  confirm: (message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' }) => Promise<boolean>;
  refresh: () => Promise<unknown>;
}

export function useSubscriptionGroupManagement({ port, confirm, refresh }: SubscriptionGroupManagementOptions) {
  const [error, setError] = useState('');
  const removeMember = useCallback(async (groupId: string, memberId: string, name: string) => {
    const accepted = await confirm(
      `从订阅组移除「${name}」？已保存的子仓档案会保留为独立配置。`,
      { title: '移除订阅组成员', confirmLabel: '移除', tone: 'danger' },
    );
    if (!accepted) return;

    setError('');
    try {
      await port.removeMember(groupId, memberId);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [confirm, port, refresh]);

  const resolveRefresh = useCallback(async (
    groupId: string,
    memberId: string,
    resolution: SubscriptionRefreshResolution,
  ) => {
    if (resolution === 'use-upstream') {
      const accepted = await confirm('采用上游配置会替换该子仓当前的源、排序和本地改名。继续吗？', {
        title: '采用上游配置',
        confirmLabel: '采用上游配置',
        tone: 'danger',
      });
      if (!accepted) return;
    }

    setError('');
    try {
      await port.resolveRefresh(groupId, memberId, resolution);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [confirm, port, refresh]);

  return { error, removeMember, resolveRefresh };
}
