import type { SubscriptionRefreshResolution } from '../../shared/types';

export interface SubscriptionGroupConfigurationPort {
  removeSubscriptionGroupMember(groupId: string, memberId: string): void;
  resolveSubscriptionGroupMemberRefresh(
    groupId: string,
    memberId: string,
    resolution: SubscriptionRefreshResolution,
  ): void;
}

/** User decisions for reconciling imported subscription groups. */
export class SubscriptionGroupApplicationService {
  constructor(private readonly configuration: SubscriptionGroupConfigurationPort) {}

  removeMember(groupId: string, memberId: string): void {
    this.configuration.removeSubscriptionGroupMember(groupId, memberId);
  }

  resolveRefresh(groupId: string, memberId: string, resolution: SubscriptionRefreshResolution): void {
    this.configuration.resolveSubscriptionGroupMemberRefresh(groupId, memberId, resolution);
  }
}
