import { describe, expect, it, vi } from 'vitest';
import type { SiteConfig, UserConfig } from '../src/shared/types';
import { SourceRuntimeConfiguration, type SourceRuntimeConfigurationPorts } from '../src/main/spider/SourceRuntimeConfiguration';

function createChange() {
  const runtimeConfig = { sites: [], parses: [], lives: [], flags: [], spider: '' } as unknown as SiteConfig;
  const calls: string[] = [];
  const ports: SourceRuntimeConfigurationPorts = {
    project: vi.fn(() => { calls.push('project'); return runtimeConfig; }),
    apply: vi.fn(() => calls.push('apply')),
    clearSpiderInstances: vi.fn(() => calls.push('clear-spiders')),
    invalidateSearchConfiguration: vi.fn(() => calls.push('invalidate-search')),
    schedulePrewarm: vi.fn(() => calls.push('prewarm')),
  };
  return { change: new SourceRuntimeConfiguration(ports), ports, calls, runtimeConfig };
}

describe('SourceRuntimeConfiguration', () => {
  it('leaves runtime services and caches untouched for UI-only changes', () => {
    const { change, ports } = createChange();

    expect(change.applyUserConfig({} as UserConfig, 'ui')).toBeNull();
    expect(change.current).toBeNull();
    for (const operation of Object.values(ports)) expect(operation).not.toHaveBeenCalled();
  });

  it('projects content changes, applies the runtime config, then invalidates dependent state', () => {
    const { change, ports, calls, runtimeConfig } = createChange();

    expect(change.applyUserConfig({} as UserConfig, 'content')).toBe(runtimeConfig);
    expect(calls).toEqual([
      'project',
      'apply',
      'clear-spiders',
      'invalidate-search',
      'prewarm',
    ]);
    expect(ports.apply).toHaveBeenCalledWith(runtimeConfig);
    expect(change.current).toBe(runtimeConfig);
  });

  it('applies imported config without clearing caches or rebuilding profile state', () => {
    const { change, ports, runtimeConfig } = createChange();

    change.applyImportedConfig(runtimeConfig);

    expect(change.current).toBe(runtimeConfig);
    expect(ports.apply).toHaveBeenCalledOnce();
    expect(ports.project).not.toHaveBeenCalled();
    expect(ports.clearSpiderInstances).not.toHaveBeenCalled();
    expect(ports.invalidateSearchConfiguration).not.toHaveBeenCalled();
    expect(ports.schedulePrewarm).not.toHaveBeenCalled();
  });
});
