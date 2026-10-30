// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SourceBean } from '../src/shared/types';
import { SourceManagementSection } from '../src/renderer/features/settings/SourceManagementSection';

const confirm = vi.fn();

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
    confirmDangerousAction: confirm,
    sourcesPort: {
      activateSource: vi.fn().mockResolvedValue(undefined),
      deleteSource: vi.fn().mockResolvedValue(undefined),
      deleteSources: vi.fn(async (keys: string[]) => keys),
      setGlobalSourceBlock: vi.fn().mockResolvedValue(undefined),
      moveSource: vi.fn().mockResolvedValue(undefined),
      updateSource: vi.fn().mockResolvedValue(undefined),
    },
    diagnosticsPort: { debugSource: vi.fn().mockResolvedValue({}) },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
});

describe('SourceManagementSection', () => {
  it('edits a source and refreshes the configuration after save', async () => {
    const page = props();

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Updated source' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(page.sourcesPort.updateSource).toHaveBeenCalledWith('source-a', expect.objectContaining({ name: 'Updated source' })));
    expect(page.onRefresh).toHaveBeenCalledOnce();
  });

  it('deletes the selected sources after confirmation', async () => {
    confirm.mockResolvedValue(true);
    const page = props([source('source-a', 'Source A'), source('source-b', 'Source B')]);

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选源' }));
    fireEvent.click(screen.getByRole('button', { name: '删除所选（2）' }));

    await waitFor(() => expect(page.sourcesPort.deleteSources).toHaveBeenCalledWith(['source-a', 'source-b']));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('已删除 2 个源');
    expect(page.onRefresh).toHaveBeenCalledOnce();
  });

  it('reports and clears only sources confirmed as removed by the store', async () => {
    confirm.mockResolvedValue(true);
    const page = props([source('source-a', 'Source A'), source('source-b', 'Source B')]);
    page.sourcesPort.deleteSources.mockResolvedValue(['source-a']);

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选源' }));
    fireEvent.click(screen.getByRole('button', { name: '删除所选（2）' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已删除 1 个源'));
    expect((screen.getByRole('checkbox', { name: '选择源 Source A' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: '选择源 Source B' }) as HTMLInputElement).checked).toBe(true);
  });

  it('reports a completed mutation separately when refreshing the list fails', async () => {
    const page = props([source('source-a', 'Source A'), source('source-b', 'Source B')]);
    page.onRefresh.mockRejectedValue(new Error('configuration unavailable'));

    render(<SourceManagementSection {...page} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择源 Source A' }));
    fireEvent.click(screen.getByRole('button', { name: '删除所选（1）' }));

    await waitFor(() => expect(page.sourcesPort.deleteSources).toHaveBeenCalledWith(['source-a']));
    expect(screen.getByRole('status').textContent).toContain('已删除 1 个源；源列表刷新失败');
    expect(screen.getByRole('status').textContent).toContain('configuration unavailable');
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
