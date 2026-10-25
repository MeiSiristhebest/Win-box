import { describe, expect, it, vi } from 'vitest';
import type { CoverLookupPort } from '../src/renderer/features/covers/application/coverLookupPort';
import { createCoverLookupCoordinator } from '../src/renderer/features/covers/application/CoverLookupCoordinator';

describe('CoverLookupCoordinator', () => {
  const clock = { now: () => 0 };

  it('shares settings lookups until the cache expires', async () => {
    let now = 0;
    const port: CoverLookupPort = {
      loadSettings: vi.fn(async () => ({ key: 'metadata-key', hasTmdb: true })),
      searchPoster: vi.fn(async () => ''),
    };
    const coordinator = createCoverLookupCoordinator(port, { now: () => now });

    await coordinator.loadSettings();
    await coordinator.loadSettings();
    expect(port.loadSettings).toHaveBeenCalledTimes(1);

    now = 30_000;
    await coordinator.loadSettings();
    expect(port.loadSettings).toHaveBeenCalledTimes(2);
  });

  it('deduplicates poster requests and retries an empty result', async () => {
    const port: CoverLookupPort = {
      loadSettings: vi.fn(async () => ({ key: '', hasTmdb: false })),
      searchPoster: vi.fn()
        .mockRejectedValueOnce(new Error('provider unavailable'))
        .mockResolvedValueOnce('https://image.test/poster.jpg'),
    };
    const coordinator = createCoverLookupCoordinator(port, clock);

    await expect(coordinator.searchPoster('Example', '2025', 'tmdb', 'key-a')).resolves.toBe('');
    const [first, second] = await Promise.all([
      coordinator.searchPoster('Example', '2025', 'tmdb', 'key-a'),
      coordinator.searchPoster('Example', '2025', 'tmdb', 'key-a'),
    ]);

    expect(first).toBe('https://image.test/poster.jpg');
    expect(second).toBe(first);
    expect(port.searchPoster).toHaveBeenCalledTimes(2);
  });

  it('bounds lookup work to four concurrent lanes', async () => {
    const coordinator = createCoverLookupCoordinator({
      loadSettings: async () => ({ key: '', hasTmdb: false }),
      searchPoster: async () => '',
    }, clock);
    let active = 0;
    let maximumActive = 0;

    await Promise.all(Array.from({ length: 9 }, (_, value) => coordinator.enqueue(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return value;
    })));

    expect(maximumActive).toBe(4);
  });
});
