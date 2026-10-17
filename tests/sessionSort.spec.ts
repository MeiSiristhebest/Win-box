import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionSort, getSessionSort, setSessionSort } from '../src/renderer/lib/sessionSort';

describe('session sort state', () => {
  beforeEach(() => clearSessionSort());

  it('keeps the same source key isolated by profile', () => {
    setSessionSort('shared-source', 'movie', { filter: { area: 'A' }, pg: 3 }, 'profile-a');
    setSessionSort('shared-source', 'movie', { filter: { area: 'B' }, pg: 1 }, 'profile-b');

    expect(getSessionSort('shared-source', 'movie', 'profile-a')).toEqual({ filter: { area: 'A' }, pg: 3 });
    expect(getSessionSort('shared-source', 'movie', 'profile-b')).toEqual({ filter: { area: 'B' }, pg: 1 });
  });

  it('keeps the unprofiled namespace separate', () => {
    setSessionSort('shared-source', 'movie', { filter: {}, pg: 2 });

    expect(getSessionSort('shared-source', 'movie')).toEqual({ filter: {}, pg: 2 });
    expect(getSessionSort('shared-source', 'movie', 'profile-a')).toBeUndefined();
  });
});
