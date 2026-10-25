// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeymapView } from '../src/shared/plugin';

const pluginCommandHarness = vi.hoisted(() => ({
  scope: '',
  keymaps: [] as KeymapView[],
  handler: undefined as ((command: KeymapView) => Promise<void>) | undefined,
  execute: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../src/renderer/features/plugins/usePluginKeymaps', () => ({
  usePluginKeymaps: (scope: string, run: (command: KeymapView) => void) => {
    pluginCommandHarness.scope = scope;
    pluginCommandHarness.handler = async (command) => {
      await run(command);
    };
    return pluginCommandHarness.keymaps;
  },
}));

vi.mock('../src/renderer/features/plugins/PluginCommandContext', () => ({
  usePluginCommandRunner: () => (...args: unknown[]) => pluginCommandHarness.execute(...args),
}));

vi.mock('../src/renderer/components/AppDialog', () => ({
  useAppDialog: () => ({ confirm: pluginCommandHarness.confirm }),
}));

import { usePlayerPluginCommands } from '../src/renderer/features/playback/usePlayerPluginCommands';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  pluginCommandHarness.scope = '';
  pluginCommandHarness.keymaps = [];
  pluginCommandHarness.handler = undefined;
});

const playerCommand: KeymapView = {
  id: 'player-command',
  pluginId: 'test-plugin',
  pluginName: '测试插件',
  label: '打开页面',
  scope: ['player'],
  key: 'Ctrl+Alt+K',
  action: 'open-url',
  url: 'https://example.test',
  confirm: true,
};

describe('player plugin command controller', () => {
  it('routes player shortcuts through host confirmation and reports command results', async () => {
    pluginCommandHarness.keymaps = [playerCommand];
    pluginCommandHarness.confirm.mockResolvedValue(true);
    pluginCommandHarness.execute.mockImplementation(async (...args: unknown[]) => {
      const confirm = args[1] as (message: string) => Promise<boolean>;
      await confirm('继续执行？');
      return { ok: true, message: '已打开' };
    });
    const notify = vi.fn();
    const { result } = renderHook(() => usePlayerPluginCommands(notify));

    expect(pluginCommandHarness.scope).toBe('player');
    expect(result.current.pluginKeys).toEqual([playerCommand]);
    await act(async () => {
      await pluginCommandHarness.handler?.(playerCommand);
    });

    expect(pluginCommandHarness.confirm).toHaveBeenCalledWith('继续执行？', { title: playerCommand.label });
    expect(notify).toHaveBeenCalledWith('已打开');
  });

  it('reports unexpected command failures through the player notification port', async () => {
    pluginCommandHarness.execute.mockRejectedValue(new Error('command failed'));
    const notify = vi.fn();
    renderHook(() => usePlayerPluginCommands(notify));

    await act(async () => {
      await pluginCommandHarness.handler?.(playerCommand);
    });
    expect(notify).toHaveBeenCalledWith('command failed');
  });
});
