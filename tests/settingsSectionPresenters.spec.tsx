// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DavServer } from '../src/shared/webdav';
import { NetworkSection } from '../src/renderer/features/settings/NetworkSection';
import { StorageSettingsSection } from '../src/renderer/features/settings/StorageSettingsSection';
import type { NetworkSettingsPort, StorageSettingsPort } from '../src/renderer/features/settings/application/settingsSectionPorts';

afterEach(cleanup);

describe('settings section presenters', () => {
  it('shows proxy configuration read failure instead of silently displaying direct mode and can retry', async () => {
    const loadProxy = vi.fn<NetworkSettingsPort['loadProxy']>()
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValue({ enabled: true, url: 'http://127.0.0.1:7890' });
    const port: NetworkSettingsPort = { loadProxy, saveProxy: vi.fn() };

    render(<NetworkSection active port={port} />);

    expect((await screen.findByRole('alert')).textContent).toContain('代理设置读取失败');
    expect(screen.queryByText('未启用（直连）')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true));
  });

  it('shows a committed storage save when both the initial list load and follow-up refresh fail', async () => {
    const saved: DavServer = { id: 'nas-1', name: '家庭 NAS', url: 'https://nas.example/dav', username: '', password: '' };
    const listServers = vi.fn<StorageSettingsPort['listServers']>()
      .mockRejectedValueOnce(new Error('initial unavailable'))
      .mockRejectedValueOnce(new Error('refresh unavailable'));
    const port: StorageSettingsPort = {
      listServers,
      saveServer: vi.fn(async () => saved),
      removeServer: vi.fn(),
      testServer: vi.fn(),
    };

    render(<StorageSettingsSection active port={port} confirmRemoval={vi.fn(async () => true)} />);
    expect(await screen.findByText(/存储列表读取失败：initial unavailable/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '家庭 NAS' } });
    fireEvent.change(screen.getByLabelText('WebDAV 地址'), { target: { value: saved.url } });
    fireEvent.click(screen.getByRole('button', { name: '添加存储' }));

    expect(await screen.findByText(/已保存「家庭 NAS」，但列表刷新失败/)).not.toBeNull();
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('家庭 NAS')).not.toBeNull();
    expect(port.saveServer).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: '刷新列表' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
