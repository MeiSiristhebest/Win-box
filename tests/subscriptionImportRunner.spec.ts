import { describe, expect, it, vi } from 'vitest';
import type { ParseResult } from '../src/engine/config/ApiConfigParser';
import type { SubscriptionImportProgressPatch } from '../src/main/subscriptions/SubscriptionImportService';
import { createSubscriptionImportRunner, type SubscriptionImportRunnerPorts } from '../src/main/subscriptions/SubscriptionImportRunner';

function ports(overrides: Partial<SubscriptionImportRunnerPorts> = {}): SubscriptionImportRunnerPorts {
  return {
    currentConfigRevision: () => 1,
    groupMembers: () => [
      { id: 'ready', status: 'ready' },
      { id: 'failed', status: 'failed' },
    ],
    fetchConfigText: vi.fn(async () => '{"sites":[{"key":"a","name":"A","type":0,"api":"https://example.test/api"}]}'),
    importMultiRepo: vi.fn(async () => ({ warnings: ['多仓导入完成'] }) as ParseResult),
    commitImportedConfig: vi.fn(),
    ...overrides,
  };
}

async function run(
  portsValue: SubscriptionImportRunnerPorts,
  sourceUrl = 'https://example.test/sub.json',
  selection: 'all' | 'failed' | 'pending' = 'all',
  checkpoint: { multiRepoItems?: Array<{ url: string; name?: string }> } = {},
) {
  const updates: SubscriptionImportProgressPatch[] = [];
  const saved: Array<{ multiRepoItems?: Array<{ url: string; name?: string }> }> = [];
  const runner = createSubscriptionImportRunner(sourceUrl, 'Test subscription', portsValue);
  const message = await runner(
    new AbortController().signal,
    selection,
    (patch) => updates.push(patch),
    checkpoint,
    (value) => saved.push(value),
  );
  return { message, updates, saved };
}

describe('createSubscriptionImportRunner', () => {
  it('resolves a multi-repository root once and forwards the selected failed members', async () => {
    const dependencies = ports({
      fetchConfigText: vi.fn(async () => '{"urls":[{"url":"https://example.test/a.json","name":"A"}]}'),
    });

    const result = await run(dependencies, 'https://example.test/sub.json', 'failed');

    expect(result.message).toBe('多仓导入完成');
    expect(dependencies.fetchConfigText).toHaveBeenCalledWith('https://example.test/sub.json', expect.any(AbortSignal));
    expect(result.saved).toEqual([{ multiRepoItems: [{ url: 'https://example.test/a.json', name: 'A' }] }]);
    expect(dependencies.importMultiRepo).toHaveBeenCalledWith(
      { items: [{ url: 'https://example.test/a.json', name: 'A' }] },
      expect.objectContaining({ onlyMemberIds: new Set(['failed']), expectedConfigRevision: 1 }),
    );
  });

  it('resumes from a saved repository checkpoint without fetching the root list', async () => {
    const dependencies = ports();

    await run(dependencies, 'https://example.test/sub.json', 'all', {
      multiRepoItems: [{ url: 'https://example.test/a.json' }],
    });

    expect(dependencies.fetchConfigText).not.toHaveBeenCalled();
    expect(dependencies.importMultiRepo).toHaveBeenCalledWith(
      { items: [{ url: 'https://example.test/a.json' }] },
      expect.objectContaining({ subscriptionUrl: 'https://example.test/sub.json' }),
    );
  });

  it('commits a valid single-repository config and reports completion', async () => {
    const dependencies = ports();

    const result = await run(dependencies);

    expect(result.message).toBe('订阅导入完成');
    expect(dependencies.commitImportedConfig).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ sites: [expect.objectContaining({ key: 'a' })] }) }),
      'https://example.test/sub.json',
      'Test subscription',
    );
    expect(result.updates.at(-1)).toMatchObject({ succeeded: 1, failed: 0, pending: 0 });
  });

  it('does not commit when the config changes while the root is loading', async () => {
    let revision = 1;
    const dependencies = ports({
      currentConfigRevision: () => revision,
      fetchConfigText: vi.fn(async () => {
        revision = 2;
        return '{"sites":[{"key":"a","name":"A","type":0,"api":"https://example.test/api"}]}';
      }),
    });

    await expect(run(dependencies)).rejects.toThrow('配置已在导入期间更改');
    expect(dependencies.commitImportedConfig).not.toHaveBeenCalled();
  });
});
