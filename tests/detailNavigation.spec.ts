import { describe, expect, it } from 'vitest';
import { decideDetailNavigation } from '../src/renderer/features/detail/application/detailNavigation';

const baseRequest = {
  key: 'source/key',
  id: 'movie 1',
  query: 'tab=episodes',
  currentWindowIsDetail: false,
  currentWindowIsSearch: false,
  mode: 'inline' as const,
};

describe('decideDetailNavigation', () => {
  it('returns an inline route when the primary window uses inline navigation', () => {
    expect(decideDetailNavigation(baseRequest)).toEqual({
      kind: 'navigate-inline',
      route: '/detail/source%2Fkey/movie%201?tab=episodes',
    });
  });

  it.each([
    { currentWindowIsDetail: true },
    { currentWindowIsSearch: true },
    { mode: 'window' as const },
  ])('requests a main-process detail window for an auxiliary window or window mode: %o', (overrides) => {
    expect(decideDetailNavigation({ ...baseRequest, ...overrides })).toEqual({
      kind: 'open-window',
      key: 'source/key',
      id: 'movie 1',
      query: 'tab=episodes',
    });
  });

  it('normalizes an empty query before returning an external action', () => {
    expect(decideDetailNavigation({ ...baseRequest, query: '  ' })).toMatchObject({
      kind: 'navigate-inline',
      route: '/detail/source%2Fkey/movie%201',
    });
  });
});
