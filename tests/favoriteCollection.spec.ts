import { describe, expect, it } from 'vitest';
import { FavoriteCollection } from '../src/renderer/features/favorites/application/favoriteCollection';
import type { FavoritePersistencePort, FavoritePersistenceSnapshot } from '../src/renderer/features/favorites/application/favoritePersistencePort';

function createCollection(initial: FavoritePersistenceSnapshot = null) {
  let snapshot = initial;
  let writes = 0;
  let notifications = 0;
  let timestamp = 100;
  const persistence: FavoritePersistencePort = {
    read: () => snapshot,
    write: (next) => { snapshot = next; writes += 1; },
    clear: () => { snapshot = null; },
  };
  const collection = new FavoriteCollection(persistence, {
    publishChanged: () => { notifications += 1; },
  }, () => timestamp++);
  return {
    collection,
    readSnapshot: () => snapshot,
    writes: () => writes,
    notifications: () => notifications,
  };
}

describe('FavoriteCollection application boundary', () => {
  it('coordinates collection changes through injected persistence and notification ports', () => {
    const harness = createCollection();
    const item = harness.collection.addFavorite({
      name: '电影 - 第1集', sourceKey: 'source-a', vodId: 'vod-1', profileId: 'profile-a',
    });

    expect(harness.collection.listFavorites()).toEqual([item]);
    expect(harness.readSnapshot()).toMatchObject({ favorites: [[expect.any(String), item]] });
    expect(harness.writes()).toBe(1);
    expect(harness.notifications()).toBe(1);
  });

  it('loads records and applies newer deletion tombstones without browser storage', () => {
    const harness = createCollection({
      favorites: [['source-key', { name: 'stale', createdAt: 1, updatedAt: 2 }]],
      deleted: [['source-key', 3]],
    });

    harness.collection.loadFavorites();

    expect(harness.collection.listFavorites()).toEqual([]);
    expect(harness.writes()).toBe(0);
    expect(harness.notifications()).toBe(0);
  });
});
