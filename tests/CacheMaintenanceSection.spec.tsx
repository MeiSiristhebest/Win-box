// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataDirInfo } from '../src/shared/types';
import type { CacheMaintenancePort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import { CacheMaintenanceSection } from '../src/renderer/features/settings/CacheMaintenanceSection';

const dataDir: DataDirInfo = { path: 'C:/Users/test/AppData/Win-Box', planned: 'C:/Users/test/AppData/Win-Box', mode: 'dev' };

describe('CacheMaintenanceSection', () => {
  afterEach(cleanup);

  it('loads data directory only while active', async () => {
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(dataDir),
      clearCache: vi.fn().mockResolvedValue({ freedBytes: 0, cleared: [], failed: [] }),
    };
    const { rerender } = render(<CacheMaintenanceSection active={false} port={port} />);

    expect(port.loadDataDirectory).not.toHaveBeenCalled();
    rerender(<CacheMaintenanceSection active port={port} />);

    expect(await screen.findByText(/数据目录：C:\/Users\/test\/AppData\/Win-Box/)).toBeTruthy();
    expect(port.loadDataDirectory).toHaveBeenCalledTimes(1);
  });

  it('reports cleanup success and keeps the action disabled while cleanup is pending', async () => {
    let finishCleanup!: (result: { freedBytes: number; cleared: string[]; failed: string[] }) => void;
    const cleanupResult = new Promise<{ freedBytes: number; cleared: string[]; failed: string[] }>((resolve) => { finishCleanup = resolve; });
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(dataDir),
      clearCache: vi.fn(() => cleanupResult),
    };
    render(<CacheMaintenanceSection active port={port} />);

    const button = screen.getByRole('button', { name: '立即清理' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '清理中…' })).toBeTruthy();

    await act(async () => finishCleanup({ freedBytes: 1_572_864, cleared: ['image', 'temp'], failed: ['locked'] }));

    expect(await screen.findByText(/已清理 2 类缓存，释放约 1.5 MB（1 项暂被占用跳过）/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '立即清理' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports data-directory and cleanup failures in the view', async () => {
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockRejectedValue(new Error('profile unavailable')),
      clearCache: vi.fn().mockRejectedValue(new Error('disk is read-only')),
    };
    render(<CacheMaintenanceSection active port={port} />);

    expect(await screen.findByText('读取数据目录失败：profile unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '立即清理' }));

    await waitFor(() => expect(screen.getByText('清理失败：disk is read-only')).toBeTruthy());
    expect((screen.getByRole('button', { name: '立即清理' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
