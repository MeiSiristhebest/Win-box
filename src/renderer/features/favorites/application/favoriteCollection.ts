import { historyGroupKey, tombstoneActive, unionTombstones } from '../../../lib/uiHistoryMerge';
import type { FavoriteItem } from './favoriteModel';
import type { FavoriteChangeNotificationPort, FavoritePersistencePort } from './favoritePersistencePort';

export interface FavoriteInput {
  name: string;
  sourceKey?: string;
  vodId?: string;
  profileId?: string;
  sourceName?: string;
  pic?: string;
  remarks?: string;
  year?: string;
  type?: string;
}

/** Favorite identity used for lookup and removal. */
export interface FavoriteRef {
  sourceKey?: string;
  vodId?: string;
  name?: string;
  profileId?: string;
}

/** Favorite identity follows the same subscription/source/title grouping as history. */
export function favoriteKey(ref: FavoriteRef): string {
  return historyGroupKey(ref);
}

/** Old records without a profile id remain discoverable under both key formats. */
export function favoriteKeyCandidates(ref: FavoriteRef): string[] {
  const scoped = historyGroupKey(ref);
  const legacy = historyGroupKey({ ...ref, profileId: undefined });
  return scoped === legacy ? [scoped] : [scoped, legacy];
}

export function normalizeFavorite(key: string, value: Partial<FavoriteItem>): FavoriteItem {
  const updatedAt = Number(value.updatedAt) || 0;
  const stringValue = (candidate: unknown): string | undefined =>
    typeof candidate === 'string' && candidate ? candidate : undefined;
  return {
    name: stringValue(value.name) || key,
    sourceKey: stringValue(value.sourceKey),
    vodId: stringValue(value.vodId),
    profileId: stringValue(value.profileId),
    sourceName: stringValue(value.sourceName),
    pic: stringValue(value.pic),
    remarks: stringValue(value.remarks),
    year: stringValue(value.year),
    type: stringValue(value.type),
    title: stringValue(value.title),
    note: stringValue(value.note),
    createdAt: Number(value.createdAt) || updatedAt,
    updatedAt,
  };
}

/** Merge snapshots by update time and retain deletions newer than stale records. */
export function mergeFavoriteViews(
  memory: Map<string, FavoriteItem>,
  persisted: Array<[string, unknown]> | null | undefined,
  tombstones: Map<string, number>,
): Map<string, FavoriteItem> {
  const merged = new Map(memory);
  for (const key of tombstones.keys()) {
    const current = merged.get(key);
    if (current && tombstoneActive(tombstones, key, current.updatedAt || 0)) merged.delete(key);
  }
  if (!Array.isArray(persisted)) return merged;
  for (const [key, value] of persisted) {
    if (typeof key !== 'string' || !key || !value || typeof value !== 'object') continue;
    const candidate = value as Partial<FavoriteItem>;
    const updatedAt = Number(candidate.updatedAt) || 0;
    if (tombstoneActive(tombstones, key, updatedAt)) continue;
    const current = merged.get(key);
    if (!current || (current.updatedAt || 0) < updatedAt) merged.set(key, normalizeFavorite(key, candidate));
  }
  return merged;
}

/** Application service for favorite collection invariants; persistence and events are injected. */
export class FavoriteCollection {
  private items = new Map<string, FavoriteItem>();
  private tombstones = new Map<string, number>();
  private loaded = false;

  constructor(
    private readonly persistence: FavoritePersistencePort,
    private readonly changes: FavoriteChangeNotificationPort,
    private readonly now: () => number = Date.now,
  ) {}

  loadFavorites(): void {
    const persisted = this.persistence.read();
    this.tombstones = unionTombstones(this.tombstones, persisted?.deleted, this.now());
    this.items = mergeFavoriteViews(this.items, persisted?.favorites, this.tombstones);
    this.loaded = true;
  }

  listFavorites(): FavoriteItem[] {
    this.ensureLoaded();
    return Array.from(this.items.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  listFavoritesWithKeys(): Array<{ key: string; item: FavoriteItem }> {
    this.ensureLoaded();
    return Array.from(this.items.entries())
      .map(([key, item]) => ({ key, item }))
      .sort((a, b) => b.item.createdAt - a.item.createdAt);
  }

  favoritesCount(): number {
    this.ensureLoaded();
    return this.items.size;
  }

  findFavorite(ref: FavoriteRef): { key: string; item: FavoriteItem } | null {
    this.ensureLoaded();
    for (const key of favoriteKeyCandidates(ref)) {
      const item = this.items.get(key);
      if (item) return { key, item };
    }
    const sourceKey = (ref.sourceKey || '').trim();
    const vodId = (ref.vodId || '').trim();
    const profileId = (ref.profileId || '').trim();
    if (sourceKey && vodId) {
      for (const [key, item] of this.items) {
        const itemProfileId = (item.profileId || '').trim();
        if ((item.sourceKey || '') === sourceKey && (item.vodId || '') === vodId &&
          (!profileId || !itemProfileId || itemProfileId === profileId)) return { key, item };
      }
    }
    return null;
  }

  isFavorited(ref: FavoriteRef): boolean {
    return this.findFavorite(ref) !== null;
  }

  addFavorite(input: FavoriteInput): FavoriteItem {
    this.ensureLoaded();
    const key = favoriteKey(input);
    const previous = this.items.get(key);
    const timestamp = this.now();
    this.items.set(key, {
      name: input.name || previous?.name || '',
      sourceKey: input.sourceKey ?? previous?.sourceKey,
      vodId: input.vodId ?? previous?.vodId,
      profileId: input.profileId ?? previous?.profileId,
      sourceName: input.sourceName ?? previous?.sourceName,
      pic: input.pic || previous?.pic,
      remarks: input.remarks || previous?.remarks,
      year: input.year || previous?.year,
      type: input.type || previous?.type,
      title: previous?.title,
      note: previous?.note,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    this.markAction(key, 'restore');
    this.persist();
    this.changes.publishChanged();
    return this.items.get(key) as FavoriteItem;
  }

  removeFavorite(key: string): boolean {
    this.ensureLoaded();
    const current = this.items.get(key);
    const removed = this.items.delete(key);
    this.markAction(key, 'delete', current?.updatedAt || 0);
    this.persist();
    this.changes.publishChanged();
    return removed;
  }

  restoreFavorite(item: FavoriteItem): boolean {
    this.ensureLoaded();
    const key = favoriteKey(item);
    if (this.items.has(key)) return false;
    this.markAction(key, 'restore');
    this.items.set(key, item);
    this.persist();
    this.changes.publishChanged();
    return true;
  }

  updateFavorite(key: string, patch: { title?: string; note?: string }): boolean {
    this.ensureLoaded();
    const current = this.items.get(key);
    if (!current) return false;
    this.items.set(key, { ...current, ...patch, updatedAt: this.now() });
    this.persist();
    this.changes.publishChanged();
    return true;
  }

  clearFavorites(): void {
    this.ensureLoaded();
    this.items.clear();
    this.tombstones.clear();
    this.persistence.clear();
    this.changes.publishChanged();
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.loadFavorites();
  }

  private persist(): void {
    const persisted = this.persistence.read();
    this.tombstones = unionTombstones(this.tombstones, persisted?.deleted, this.now());
    this.items = mergeFavoriteViews(this.items, persisted?.favorites, this.tombstones);
    this.persistence.write({
      favorites: Array.from(this.items),
      deleted: Array.from(this.tombstones),
    });
  }

  private markAction(key: string, action: 'delete' | 'restore', afterUpdatedAt = 0): void {
    const previous = Math.abs(this.tombstones.get(key) || 0);
    const timestamp = Math.max(this.now(), previous + 1, afterUpdatedAt + 1);
    this.tombstones.set(key, action === 'delete' ? timestamp : -timestamp);
  }
}
