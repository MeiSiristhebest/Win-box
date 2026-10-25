import { describe, expect, it, vi } from 'vitest';
import type { SearchAllReport, VodItem } from '../src/shared/types';
import { executeSingleSourceSearch } from '../src/renderer/features/home/application/singleSourceSearch';

function item(name: string): VodItem {
  return { id: name, name } as VodItem;
}

function reportOf(result: Awaited<ReturnType<typeof executeSingleSourceSearch>>): SearchAllReport {
  if (result.kind !== 'completed') throw new Error('expected a completed source search');
  return result.report;
}

describe('executeSingleSourceSearch', () => {
  it('maps a successful source response into the common report with measured duration', async () => {
    const search = vi.fn(async () => [item('Film')]);
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(137);
    const result = await executeSingleSourceSearch({
      key: 'source-a', name: 'Source A', term: 'Film', profileId: 'profile-a', isCurrent: () => true,
    }, { api: { search }, clock: { now } });

    expect(search).toHaveBeenCalledWith({ key: 'source-a', wd: 'Film', profileId: 'profile-a' });
    expect(reportOf(result).perSource).toMatchObject([{ key: 'source-a', name: 'Source A', status: 'ok', ms: 37 }]);
  });

  it('preserves an empty response as a successful empty source result', async () => {
    const result = await executeSingleSourceSearch({
      key: 'source-a', name: 'Source A', term: 'Film', profileId: 'profile-a', isCurrent: () => true,
    }, { api: { search: async () => [] }, clock: { now: () => 10 } });

    expect(reportOf(result).perSource).toMatchObject([{ status: 'empty', count: 0 }]);
  });

  it('keeps a source failure visible in the common report', async () => {
    const result = await executeSingleSourceSearch({
      key: 'source-a', name: 'Source A', term: 'Film', profileId: 'profile-a', isCurrent: () => true,
    }, { api: { search: async () => { throw new Error('source offline'); } }, clock: { now: () => 10 } });

    expect(reportOf(result).perSource).toMatchObject([{ status: 'error', error: 'source offline' }]);
  });

  it('drops both stale success and stale failure without producing a report', async () => {
    for (const search of [
      async () => [item('Film')],
      async () => { throw new Error('late failure'); },
    ]) {
      const result = await executeSingleSourceSearch({
        key: 'source-a', name: 'Source A', term: 'Film', profileId: 'profile-a', isCurrent: () => false,
      }, { api: { search }, clock: { now: () => 10 } });

      expect(result).toEqual({ kind: 'stale' });
    }
  });
});
