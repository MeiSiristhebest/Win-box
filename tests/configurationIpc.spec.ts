import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { Logger } from '../src/shared/types';
import { IPC } from '../src/shared/ipc-channels';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const fixtures = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => fixtures.handlers.set(channel, handler) },
}));

import {
  registerProfileIpc,
  registerSourceConfigurationIpc,
  registerSubscriptionImportIpc,
} from '../src/main/ipc/configurationIpc';

const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn(), d: vi.fn() } as unknown as Logger;
const invoke = async (channel: string, ...args: unknown[]) => fixtures.handlers.get(channel)!({ sender: {} } as IpcMainInvokeEvent, ...args);

function registerHost() {
  const sourceConfig = {
    setGlobalSourceBlock: vi.fn(),
  };
  const reads = {
    importConfig: vi.fn(async () => ({ config: { sites: [] }, report: { ok: true }, warnings: ['notice'], urls: [] })),
    sites: [],
    importReport: null,
    driveBindLearned: vi.fn(() => []),
  };
  const imports = {
    start: vi.fn(() => ({ jobId: 'import-job' })),
  };
  const profiles = {
    switchProfileSource: vi.fn(),
  };
  const groups = { removeMember: vi.fn(), resolveRefresh: vi.fn() };
  registerSourceConfigurationIpc(
    sourceConfig as unknown as Parameters<typeof registerSourceConfigurationIpc>[0],
    reads as unknown as Parameters<typeof registerSourceConfigurationIpc>[1],
    logger,
  );
  registerSubscriptionImportIpc(imports as unknown as Parameters<typeof registerSubscriptionImportIpc>[0], groups, logger);
  registerProfileIpc(profiles as unknown as Parameters<typeof registerProfileIpc>[0], logger);
  return { sourceConfig, reads, imports, profiles, groups };
}

describe('configuration IPC adapter', () => {
  beforeEach(() => {
    fixtures.handlers.clear();
    vi.clearAllMocks();
  });

  it('maps config import into the stable IPC result and preserves diagnostics', async () => {
    const { reads } = registerHost();

    await expect(invoke(IPC.CONFIG_IMPORT, { url: 'https://example.test/config.json' })).resolves.toEqual({
      ok: true,
      data: { config: { sites: [] }, report: { ok: true }, warnings: ['notice'], urls: [] },
    });
    expect(reads.importConfig).toHaveBeenCalledWith({ url: 'https://example.test/config.json' });
  });

  it('routes subscription import jobs through the import use-case boundary', async () => {
    const { imports } = registerHost();

    await expect(invoke(IPC.CFG_IMPORT_JOB_START, { url: 'https://example.test/repo.json', name: 'fixture' }))
      .resolves.toEqual({ ok: true, data: { jobId: 'import-job' } });
    expect(imports.start).toHaveBeenCalledWith('https://example.test/repo.json', 'fixture');
  });

  it('validates global source blocks at the IPC boundary', async () => {
    const { sourceConfig } = registerHost();

    const invalid = await invoke(IPC.CFG_GLOBAL_SOURCE_BLOCK, { keys: Array(1001).fill('source'), blocked: true });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'HANDLER_ERROR', message: '全局屏蔽参数无效' } });
    expect(sourceConfig.setGlobalSourceBlock).not.toHaveBeenCalled();

    await expect(invoke(IPC.CFG_GLOBAL_SOURCE_BLOCK, { keys: ['source-a'], blocked: true }))
      .resolves.toEqual({ ok: true, data: undefined });
    expect(sourceConfig.setGlobalSourceBlock).toHaveBeenCalledWith(['source-a'], true);
  });

  it('delegates profile switching without coupling job progress delivery to the IPC adapter', async () => {
    const { profiles } = registerHost();

    await expect(invoke(IPC.CFG_SWITCH_PROFILE_SOURCE, { profileId: 'profile-a', key: 'source-a' }))
      .resolves.toEqual({ ok: true, data: undefined });
    expect(profiles.switchProfileSource).toHaveBeenCalledWith('profile-a', 'source-a');
  });
});
