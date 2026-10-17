// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { client } from '../src/renderer/api/client';
import type { SourceBean } from '../src/shared/types';
import { SourceManagementSection } from '../src/renderer/features/settings/SourceManagementSection';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../src/renderer/components/AppDialog', () => ({
  useAppDialog: () => ({ confirm }),
}));

function source(key: string, name: string): SourceBean {
  return {
    key,
    name,
    type: 0,
    api: `https://${key}.example.test/api`,
    ext: '',
    jar: '',
    playUrl: '',
    timeout: 15,
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    filterable: 1,
  } as SourceBean;
}

function props(sources = [source('source-a', 'Source A')]) {
  return {
    active: true,
    sources,
    activeSourceKey: sources[0]?.key ?? '',
    profileId: 'profile-a',
    busy: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
    onNotice: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  confirm.mockReset();
});

describe('SourceManagementSection', () => {
  it('edits a source and refreshes the configuration after save', async () => {
    const update = vi.spyOn(client, 'cfgUpdateSource').mockResolvedValue({} as never);
    const page = props();

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Updated source' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('source-a', expect.objectContaining({ name: 'Updated source' })));
    expect(page.onRefresh).toHaveBeenCalledOnce();
  });

  it('deletes the selected sources after confirmation', async () => {
    confirm.mockResolvedValue(true);
    const remove = vi.spyOn(client, 'cfgDeleteSources').mockResolvedValue({} as never);
    const page = props([source('source-a', 'Source A'), source('source-b', 'Source B')]);

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选源' }));
    fireEvent.click(screen.getByRole('button', { name: '删除所选（2）' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith(['source-a', 'source-b']));
    expect(confirm).toHaveBeenCalledOnce();
    expect(page.onNotice).toHaveBeenCalledWith('已删除 2 个源');
    expect(page.onRefresh).toHaveBeenCalledOnce();
  });

  it('clears selection when the active profile changes', async () => {
    const page = props([source('source-a', 'Source A')]);
    const view = render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择源 Source A' }));
    expect(screen.getByText('已选 1 / 1 个源')).toBeTruthy();

    view.rerender(<SourceManagementSection {...page} profileId="profile-b" />);

    await waitFor(() => expect(screen.getByText('已选 0 / 1 个源')).toBeTruthy());
  });
});
