import { describe, expect, it } from 'vitest';
import { selectSubscriptionImportMemberIds } from '../src/main/subscriptions/subscriptionImportSelection';

describe('selectSubscriptionImportMemberIds', () => {
  const members = [
    { id: 'ready-1', status: 'ready' },
    { id: 'failed-1', status: 'failed' },
    { id: 'pending-1', status: 'pending' },
    { id: 'failed-2', status: 'failed' },
  ] as const;

  it('limits retries and continuations to matching members', () => {
    expect([...selectSubscriptionImportMemberIds(members, 'failed', false)!]).toEqual(['failed-1', 'failed-2']);
    expect([...selectSubscriptionImportMemberIds(members, 'pending', false)!]).toEqual(['pending-1']);
  });

  it('reprocesses the full list when the failure has no member status', () => {
    expect(selectSubscriptionImportMemberIds([], 'failed', false)).toBeUndefined();
  });

  it('does not filter line-only imports or initial runs', () => {
    expect(selectSubscriptionImportMemberIds(members, 'failed', true)).toBeUndefined();
    expect(selectSubscriptionImportMemberIds(members, 'all', false)).toBeUndefined();
  });
});
