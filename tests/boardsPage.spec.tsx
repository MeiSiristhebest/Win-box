// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BoardsPage from '../src/renderer/pages/BoardsPage';

const { loadSections, hasTmdbCredentials } = vi.hoisted(() => ({
  loadSections: vi.fn(),
  hasTmdbCredentials: vi.fn(),
}));

vi.mock('../src/renderer/lib/keepAlive', () => ({ usePageActive: () => true }));
vi.mock('../src/renderer/features/discovery/adapters/discoveryAdapters', () => ({
  discoverBoardDirectoryAdapter: { loadSections, hasTmdbCredentials },
  discoverBoardPreviewAdapter: {},
}));
vi.mock('../src/renderer/features/discovery/components/BoardPreviewCard', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  loadSections
    .mockRejectedValueOnce(new Error('board feed offline'))
    .mockResolvedValue([{ id: 'popular', title: '热门', items: [] }]);
  hasTmdbCredentials
    .mockRejectedValueOnce(new Error('settings offline'))
    .mockResolvedValue(false);
});
afterEach(cleanup);

describe('BoardsPage resource status', () => {
  it('shows separate retryable board-feed and credential errors, then recovers', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><BoardsPage /></MemoryRouter>);

    expect((await screen.findByText(/board feed offline/)).closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByText(/settings offline/).closest('[role="alert"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '重试加载榜单' }));
    await user.click(screen.getByRole('button', { name: '重试检查' }));

    await waitFor(() => {
      expect(loadSections).toHaveBeenCalledTimes(2);
      expect(hasTmdbCredentials).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/board feed offline/)).toBeNull();
    expect(screen.queryByText(/settings offline/)).toBeNull();
    expect(screen.getByRole('link', { name: /设置凭据/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not claim the directory is empty while both resources are unavailable', async () => {
    loadSections.mockReset().mockRejectedValue(new Error('board feed offline'));
    hasTmdbCredentials.mockReset().mockRejectedValue(new Error('settings offline'));
    render(<MemoryRouter><BoardsPage /></MemoryRouter>);

    expect(await screen.findByText(/board feed offline/)).toBeTruthy();
    expect(screen.queryByText('没有符合条件的榜单')).toBeNull();
    expect(screen.queryByRole('link', { name: /设置凭据/ })).toBeNull();
  });
});
