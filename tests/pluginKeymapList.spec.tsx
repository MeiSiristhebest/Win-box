// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeymapView } from '../src/shared/plugin';
import type { PluginKeymapListPort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import { PluginKeymapList } from '../src/renderer/features/settings/PluginKeymapList';

const keymap: KeymapView = {
  id: 'focus-player',
  pluginId: 'sample',
  pluginName: 'Sample',
  label: '聚焦播放器',
  scope: ['player'],
  key: 'Ctrl+Alt+P',
  action: 'navigate',
  to: 'discover',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(cleanup);

function createPort(listKeymaps: PluginKeymapListPort['listKeymaps'] = vi.fn().mockResolvedValue([keymap])): PluginKeymapListPort {
  return { listKeymaps };
}

describe('PluginKeymapList', () => {
  it('announces loading and renders the loaded shortcut with its scope', async () => {
    const pending = deferred<KeymapView[]>();
    const port = createPort(vi.fn(() => pending.promise));
    render(<PluginKeymapList active port={port} />);

    expect(screen.getByRole('status').textContent).toContain('正在加载插件快捷键');
    await act(async () => { pending.resolve([keymap]); await pending.promise; });

    expect(screen.getByText('Ctrl+Alt+P')).toBeTruthy();
    expect(screen.getByText('聚焦播放器')).toBeTruthy();
    expect(screen.getByText('播放器 · Sample')).toBeTruthy();
  });

  it('shows an explicit empty state after a successful empty response', async () => {
    render(<PluginKeymapList active port={createPort(vi.fn().mockResolvedValue([]))} />);

    expect(await screen.findByText('当前没有插件快捷键。')).toBeTruthy();
  });

  it('exposes errors and retries loading instead of silently hiding the shortcut section', async () => {
    const port = createPort(vi.fn()
      .mockRejectedValueOnce(new Error('IPC 不可用'))
      .mockResolvedValueOnce([keymap]));
    render(<PluginKeymapList active port={port} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('插件快捷键加载失败：IPC 不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('聚焦播放器')).toBeTruthy();
    expect(port.listKeymaps).toHaveBeenCalledTimes(2);
  });

  it('does not load keymaps while the shortcuts page is inactive', () => {
    const port = createPort();
    render(<PluginKeymapList active={false} port={port} />);

    expect(port.listKeymaps).not.toHaveBeenCalled();
    expect(screen.queryByRole('region')).toBeNull();
  });
});
