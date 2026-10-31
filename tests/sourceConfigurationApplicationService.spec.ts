import { describe, expect, it, vi } from 'vitest';
import type { Logger, SourceBean, SourceMoveDirection, SourceUpdatePatch, UserConfig } from '../src/shared/types';
import { SourceConfigurationApplicationService } from '../src/main/configuration/SourceConfigurationApplicationService';
import type { SourceConfigurationStorePort } from '../src/main/configuration/SourceConfigurationApplicationService';

describe('SourceConfigurationApplicationService', () => {
  it('forwards the expected profile and audited source signature to the configuration store', () => {
    const deleteSources = vi.fn((keys: readonly string[]) => [...keys]);
    const configuration: SourceConfigurationStorePort = {
      snapshot: () => ({ sources: [] } as unknown as UserConfig),
      restore: vi.fn(),
      sources: () => [],
      addSource: (source: SourceBean) => source,
      updateSource: (_key: string, _patch: SourceUpdatePatch) => ({} as SourceBean),
      deleteSources,
      setGlobalSourceBlock: vi.fn(),
      moveSource: (_key: string, _direction: SourceMoveDirection) => undefined,
      setActiveSource: vi.fn(),
    };
    const service = new SourceConfigurationApplicationService({
      configuration,
      logger: { w: vi.fn() } as Pick<Logger, 'w'>,
    });

    expect(service.deleteSources(['source-a'], 'profile-a', '[{"key":"source-a"}]')).toEqual(['source-a']);
    expect(deleteSources).toHaveBeenCalledWith(['source-a'], 'profile-a', '[{"key":"source-a"}]');
  });
});
