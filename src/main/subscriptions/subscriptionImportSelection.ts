import type { SubscriptionGroupMember } from '../../shared/types';
import type { SubscriptionImportSelection } from './SubscriptionImportService';

export function selectSubscriptionImportMemberIds(
  members: readonly Pick<SubscriptionGroupMember, 'id' | 'status'>[],
  selection: SubscriptionImportSelection,
  lineOnly: boolean,
): ReadonlySet<string> | undefined {
  if (lineOnly || selection === 'all') return undefined;

  const status = selection === 'failed' ? 'failed' : 'pending';
  const ids = members.filter((member) => member.status === status).map((member) => member.id);
  return ids.length > 0 ? new Set(ids) : undefined;
}
