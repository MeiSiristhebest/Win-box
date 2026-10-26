import { describe, expect, it, vi } from 'vitest';
import type { SearchAllReport } from '../src/shared/types';
import { searchAcrossProfiles } from '../src/engine/vod/searchAcrossProfiles';

function report(): SearchAllReport {
  return { items: [], perSource: [], hitSources: 0, failedSources: 0, totalRaw: 0 };
}

describe('searchAcrossProfiles cancellation', () => {
  it('stops scheduling later profiles after the caller cancels', async () => {
    const controller = new AbortController();
    const profiles = ['a', 'b', 'c'].map((profileId, profileOrder) => ({
      profileId,
      profileOrder,
      profileName: profileId.toUpperCase(),
      context: null,
      total: 1,
    }));
    const searchProfile = vi.fn((_profile, _progress, _budget, signal: AbortSignal) => new Promise<SearchAllReport>((resolve) => {
      signal.addEventListener('abort', () => resolve(report()), { once: true });
    }));
    const createWorkerBudget = vi.fn(() => ({
      acquire: vi.fn(async () => () => undefined),
      finishProfile: vi.fn(),
    }));
    const request = searchAcrossProfiles({
      term: 'movie',
      profiles,
      profileWorkerLimit: 1,
      sourceWorkerLimit: 2,
      createWorkerBudget,
      signal: controller.signal,
      searchProfile,
    });

    await vi.waitFor(() => expect(searchProfile).toHaveBeenCalledOnce());
    const profileSignal = searchProfile.mock.calls[0][3];
    controller.abort();

    await expect(request).resolves.toEqual(report());
    expect(profileSignal.aborted).toBe(true);
    expect(searchProfile).toHaveBeenCalledOnce();
  });
});
