import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { SpiderShellCompatibility, type SpiderShellCompatibilityPorts } from '../src/engine/spider/SpiderShellCompatibility';

function compatibility(options: {
  configured?: string;
  environment?: string;
  entriesByPath?: Record<string, string[]>;
  existingPaths?: string[];
} = {}) {
  const warn = vi.fn();
  const ports: SpiderShellCompatibilityPorts = {
    readJar: (path) => new TextEncoder().encode(path),
    exists: (path) => new Set(options.existingPaths ?? []).has(path),
    warn,
    listArchiveEntries: (bytes) => options.entriesByPath?.[new TextDecoder().decode(bytes)] ?? null,
  };
  return {
    service: new SpiderShellCompatibility('runtime/jvm', options.configured, options.environment ?? '', ports),
    warn,
  };
}

describe('SpiderShellCompatibility', () => {
  it('prefers explicitly configured implementation path over the environment value', () => {
    const { service } = compatibility({ configured: ' explicit.jar ', environment: ' env.jar ' });

    expect(service.classesPath()).toBe('explicit.jar');
    expect(service.shimJarPath()).toBe(join('runtime/jvm', 'stubs', 'shell-shim.jar'));
  });

  it('resolves the first guard with a bundled implementation and reports missing mappings', () => {
    const paths = ['first.jar', 'second.jar'];
    const { service, warn } = compatibility({
      entriesByPath: {
        'first.jar': ['assets/missing.guard'],
        'second.jar': ['assets/found.guard'],
      },
      existingPaths: [join('runtime/jvm', 'shell-shim', 'real', 'found.jar')],
    });

    expect(service.resolveForJars(paths)).toBe(join('runtime/jvm', 'shell-shim', 'real', 'found.jar'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('guard=missing'));
  });

  it('leaves ordinary classes unchanged and prepends foni only for supported spider families', () => {
    const foni = join('runtime/jvm', 'shell-shim', 'real', 'foni-spider.jar');
    const { service } = compatibility({ existingPaths: [foni] });

    expect(service.includeFoniImplementation('com.example.Other', 'real.jar')).toBe('real.jar');
    expect(service.includeFoniImplementation('com.example.AppSx', 'real.jar'))
      .toBe(`${foni};real.jar`);
    expect(service.includeFoniImplementation('com.example.AppSx', '')).toBe('');
  });
});
