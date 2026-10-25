import { client } from '../../../api/client';
import type { SubscriptionGroupManagementPort } from '../application/subscriptionGroupManagement';

export const subscriptionGroupManagementAdapter: SubscriptionGroupManagementPort = {
  removeMember: (groupId, memberId) => client.cfgRemoveSubscriptionGroupMember(groupId, memberId),
  resolveRefresh: (groupId, memberId, resolution) => client.cfgResolveSubscriptionGroupRefresh(groupId, memberId, resolution),
};
