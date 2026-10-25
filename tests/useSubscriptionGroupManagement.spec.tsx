// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionGroupManagementPort } from '../src/renderer/features/subscriptions/application/subscriptionGroupManagement';
import { useSubscriptionGroupManagement } from '../src/renderer/features/subscriptions/useSubscriptionGroupManagement';

describe('useSubscriptionGroupManagement', () => {
  it('keeps mutation failures local to the subscription group workflow', async () => {
    const port: SubscriptionGroupManagementPort = {
      removeMember: vi.fn().mockRejectedValueOnce(new Error('store unavailable')).mockResolvedValue(undefined),
      resolveRefresh: vi.fn().mockResolvedValue(undefined),
    };
    const confirm = vi.fn(async () => true);
    const refresh = vi.fn(async () => undefined);
    const { result } = renderHook(() => useSubscriptionGroupManagement({ port, confirm, refresh }));

    await act(async () => result.current.removeMember('group', 'member', '线路'));
    expect(result.current.error).toBe('store unavailable');

    await act(async () => result.current.removeMember('group', 'member', '线路'));
    expect(result.current.error).toBe('');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
