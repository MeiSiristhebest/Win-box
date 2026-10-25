// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SubscriptionGroup, UserProfile } from '../src/shared/types';
import { SubscriptionGroupsSection } from '../src/renderer/features/subscriptions/SubscriptionGroupsSection';

describe('SubscriptionGroupsSection', () => {
  it('reports member state and delegates refresh, activation, and removal actions', () => {
    const group: SubscriptionGroup = {
      id: 'group-1', name: '影视源', url: 'https://example.test/list.json', status: 'partial',
      members: [
        {
          id: 'ready', profileId: 'profile-1', name: '线路一', url: 'https://example.test/1.json', status: 'needs-review',
          refreshDiff: { addedKeys: ['new-source'], removedKeys: ['old-source'], changed: [{ key: 'same-source', fields: ['name', 'api'] }] },
        },
        { id: 'removed', name: '旧线路', url: 'https://example.test/old.json', status: 'pending-removal' },
      ],
      createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
    };
    const profiles: UserProfile[] = [{
      id: 'profile-1', name: '线路一', apiUrl: 'https://example.test/1.json', json: '{}',
      sourceCount: 3, importedAt: '2026-10-15T00:00:00.000Z',
    }];
    const onRefresh = vi.fn();
    const onActivate = vi.fn();
    const onRemoveMember = vi.fn();
    const onResolveRefresh = vi.fn();
    render(<SubscriptionGroupsSection
      active groups={[group]} profiles={profiles} activeProfileId="other-profile" busy={false} importRunning={false} error=""
      onRefresh={onRefresh} onActivate={onActivate} onRemoveMember={onRemoveMember} onResolveRefresh={onResolveRefresh}
    />);

    expect(screen.getByText(/部分完成；成功 0，失败 0，待处理 2/)).toBeTruthy();
    fireEvent.click(screen.getByText(/部分完成；成功 0，失败 0，待处理 2/));
    expect(screen.getByText(/首次刷新差异（现有配置已保留）：新增 1，移除 1，更新 1/)).toBeTruthy();
    fireEvent.click(screen.getByText(/首次刷新差异/));
    expect(screen.getByText('新增源：new-source')).toBeTruthy();
    expect(screen.getByText('移除源：old-source')).toBeTruthy();
    expect(screen.getByText('更新源：same-source（name、api）')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保留手动改动并建立基线' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新订阅组' }));
    fireEvent.click(screen.getByRole('button', { name: '切换到此子仓' }));
    fireEvent.click(screen.getByRole('button', { name: '从组中移除' }));

    expect(onRefresh).toHaveBeenCalledWith(group.url, group.name);
    expect(onActivate).toHaveBeenCalledWith('profile-1');
    expect(onRemoveMember).toHaveBeenCalledWith(group.id, 'removed', '旧线路');
    expect(onResolveRefresh).toHaveBeenCalledWith(group.id, 'ready', 'keep-current');
  });

  it('shows a failed refresh with its saved profile as retained and folds the request trace', () => {
    const group: SubscriptionGroup = {
      id: 'group-2', name: '多仓', url: 'https://example.test/list.json', status: 'partial',
      members: [{
        id: 'saved-failed', profileId: 'saved-profile', name: '旧线路', url: 'https://example.test/old.json', status: 'failed',
        error: '「旧线路」 本次未能取得有效订阅配置。最后响应为 html（200B）。已尝试：okhttp UA：ECONNRESET',
      }],
      createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z',
    };
    const profiles: UserProfile[] = [{
      id: 'saved-profile', name: '旧线路', apiUrl: 'https://example.test/old.json', json: '{}',
      sourceCount: 72, importedAt: '2026-10-15T00:00:00.000Z',
    }];
    render(<SubscriptionGroupsSection
      active groups={[group]} profiles={profiles} activeProfileId="other" busy={false} importRunning={false} error=""
      onRefresh={vi.fn()} onActivate={vi.fn()} onRemoveMember={vi.fn()} onResolveRefresh={vi.fn()}
    />);

    expect(screen.getByText('刷新失败，已保留上次配置')).toBeTruthy();
    expect(screen.getByText(/72\s*个源（上次成功配置）/)).toBeTruthy();
    fireEvent.click(screen.getByText('最后响应为 html（200B）。'));
    expect(screen.getByText(/ECONNRESET/)).toBeTruthy();
  });

  it('does not render outside its owning settings tab and shows its own errors', () => {
    const common = {
      groups: [{ id: 'g', name: '订阅组', url: 'https://example.test', status: 'complete' as const, members: [], createdAt: '', updatedAt: '' }],
      profiles: [], activeProfileId: '', busy: false, importRunning: false, error: '移除失败',
      onRefresh: vi.fn(), onActivate: vi.fn(), onRemoveMember: vi.fn(), onResolveRefresh: vi.fn(),
    };
    const { container, rerender } = render(<SubscriptionGroupsSection {...common} active={false} />);
    expect(container.querySelector('#cfg-subscription-groups')).toBeNull();

    rerender(<SubscriptionGroupsSection {...common} active />);
    expect(within(container).getByRole('heading', { name: '多仓订阅组' })).toBeTruthy();
    expect(within(container).getByRole('alert').textContent).toBe('移除失败');
  });
});
