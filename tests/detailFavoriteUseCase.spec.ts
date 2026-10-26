import { describe, expect, it } from 'vitest';
import { FavoriteCollection } from '../src/renderer/features/favorites/application/favoriteCollection';
import type { FavoritePersistencePort, FavoritePersistenceSnapshot } from '../src/renderer/features/favorites/application/favoritePersistencePort';
import {
  observeDetailFavorite,
  hasDetailFavoriteIdentity,
  toggleDetailFavorite,
  type DetailFavoritePort,
} from '../src/renderer/features/detail/application/detailFavorite';

function favoritePort(initial: FavoritePersistenceSnapshot = null) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  let now = 100;
  const persistence: FavoritePersistencePort = {
    read: () => snapshot,
    write: (next) => { snapshot = next; },
    clear: () => { snapshot = null; },
  };
  const collection = new FavoriteCollection(persistence, {
    publishChanged: () => listeners.forEach((listener) => listener()),
  }, () => now++);
  const port: DetailFavoritePort = {
    findFavorite: (ref) => {
      const match = collection.findFavorite(ref);
      return match ? { key: match.key } : null;
    },
    addFavorite: (input) => { collection.addFavorite(input); },
    removeFavorite: (key) => { collection.removeFavorite(key); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { collection, port };
}

const request = {
  sourceKey: 'source-a',
  vodId: 'movie-1',
  name: '',
  profileId: 'profile-a',
  fallbackName: 'Movie title',
  sourceName: 'Source A',
  pic: 'https://cover.example/movie.jpg',
  remarks: 'HD',
  year: '2025',
  type: '电影',
};

describe('detail favorite application use case', () => {
  it('observes shared favorite changes and toggles add/remove with detail metadata', () => {
    const harness = favoritePort();
    const states: boolean[] = [];
    const unsubscribe = observeDetailFavorite(request, harness.port, (value) => states.push(value));

    expect(states).toEqual([false]);
    expect(toggleDetailFavorite(request, harness.port)).toEqual({ kind: 'added', favorited: true });
    expect(harness.collection.listFavorites()).toMatchObject([{
      name: 'Movie title', sourceKey: 'source-a', vodId: 'movie-1', profileId: 'profile-a',
      sourceName: 'Source A', pic: 'https://cover.example/movie.jpg', remarks: 'HD', year: '2025', type: '电影',
    }]);
    expect(states).toEqual([false, true]);

    expect(toggleDetailFavorite(request, harness.port)).toEqual({ kind: 'removed', favorited: false });
    expect(harness.collection.listFavorites()).toEqual([]);
    expect(states).toEqual([false, true, false]);
    unsubscribe();
  });

  it('does not show or remove the same source item from another profile', () => {
    const harness = favoritePort();
    harness.port.addFavorite({
      sourceKey: request.sourceKey,
      vodId: request.vodId,
      name: 'Movie title',
      profileId: 'profile-b',
    });
    const states: boolean[] = [];
    observeDetailFavorite(request, harness.port, (value) => states.push(value));

    expect(states).toEqual([false]);
    expect(toggleDetailFavorite(request, harness.port).kind).toBe('added');
    expect(harness.collection.listFavorites().map((item) => item.profileId).sort()).toEqual(['profile-a', 'profile-b']);
  });

  it('ignores incomplete source identities', () => {
    const harness = favoritePort();
    expect(toggleDetailFavorite({ ...request, sourceKey: '', vodId: '' }, harness.port))
      .toEqual({ kind: 'ignored', favorited: false });
    expect(harness.collection.favoritesCount()).toBe(0);
  });

  it('does not inspect or mutate favorites until profile identity is resolved', () => {
    const harness = favoritePort();
    harness.port.addFavorite({
      sourceKey: request.sourceKey,
      vodId: request.vodId,
      name: request.name,
      profileId: 'profile-b',
    });
    const states: boolean[] = [];
    const unresolved = { ...request, profileId: '' };

    expect(hasDetailFavoriteIdentity(unresolved)).toBe(false);
    observeDetailFavorite(unresolved, harness.port, (value) => states.push(value));

    expect(states).toEqual([false]);
    expect(toggleDetailFavorite(unresolved, harness.port)).toEqual({ kind: 'ignored', favorited: false });
    expect(harness.collection.listFavorites()).toHaveLength(1);
    expect(harness.collection.listFavorites()[0].profileId).toBe('profile-b');
  });
});
