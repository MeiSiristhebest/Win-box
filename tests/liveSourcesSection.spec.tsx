// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LiveBean } from '../src/shared/types';
import type { LiveSourcesManagementPort } from '../src/renderer/features/subscriptions/application/liveSourcesPort';
import { LiveSourcesSection } from '../src/renderer/features/subscriptions/LiveSourcesSection';

const confirm = vi.fn();

function live(name: string): LiveBean {
  return {
    name,
    type: '0',
    url: 'https://example.test/live.m3u',
    api: '',
    jar: '',
    ext: '',
    epg: '',
    playerType: '',
    timeout: 15,
  } as LiveBean;
}

function props() {
  return {
    active: true,
    lives: [live('Line A')],
    activeIndex: 0,
    managementPort: {
      selectLiveSource: vi.fn(async () => undefined),
      deleteLiveSource: vi.fn(async () => undefined),
      renameLiveSource: vi.fn(async () => undefined),
    } satisfies LiveSourcesManagementPort,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    confirmRemoval: confirm,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
});

describe('LiveSourcesSection', () => {
  it('keeps a rename draft when the sources tab is hidden', async () => {
    const page = props();
    const view = render(<LiveSourcesSection {...page} />);

    fireEvent.click(screen.getByTitle('重命名该直播线路'));
    fireEvent.change(screen.getByDisplayValue('Line A'), { target: { value: 'Line A updated' } });
    view.rerender(<LiveSourcesSection {...page} active={false} />);
    view.rerender(<LiveSourcesSection {...page} active />);
    expect(screen.getByDisplayValue('Line A updated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(page.managementPort.renameLiveSource).toHaveBeenCalledWith({ index: 0, name: 'Line A updated' }));
    expect(page.onRefresh).toHaveBeenCalledOnce();
  });

  it('activates and deletes a live line through the client', async () => {
    confirm.mockResolvedValue(true);
    const page = props();

    render(<LiveSourcesSection {...page} />);
    fireEvent.click(screen.getByText('Line A'));
    await waitFor(() => expect(page.managementPort.selectLiveSource).toHaveBeenCalledWith(0));
    fireEvent.click(screen.getByTitle('删除该直播线路'));

    await waitFor(() => expect(page.managementPort.deleteLiveSource).toHaveBeenCalledWith(0));
    expect(confirm).toHaveBeenCalledOnce();
    expect(page.onRefresh).toHaveBeenCalledTimes(2);
  });
});
