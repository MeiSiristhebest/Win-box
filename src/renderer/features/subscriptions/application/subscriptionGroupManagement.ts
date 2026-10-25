import type { SubscriptionRefreshResolution } from '../../../../shared/types';

export interface SubscriptionGroupManagementPort {
  removeMember(groupId: string, memberId: string): Promise<void>;
  resolveRefresh(groupId: string, memberId: string, resolution: SubscriptionRefreshResolution): Promise<void>;
}
