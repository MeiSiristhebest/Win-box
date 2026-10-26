export interface DetailFavoriteRef {
  sourceKey: string;
  vodId: string;
  name: string;
  profileId: string;
}

export interface DetailFavoriteInput extends DetailFavoriteRef {
  fallbackName: string;
  sourceName?: string;
  pic?: string;
  remarks?: string;
  year?: string;
  type?: string;
}

export interface DetailFavoriteMatch {
  key: string;
}

export interface DetailFavoritePort {
  findFavorite(ref: DetailFavoriteRef): DetailFavoriteMatch | null;
  addFavorite(input: Omit<DetailFavoriteInput, 'fallbackName'>): void;
  removeFavorite(key: string): void;
  subscribe(listener: () => void): () => void;
}

export type DetailFavoriteChange =
  | { kind: 'added'; favorited: true }
  | { kind: 'removed'; favorited: false }
  | { kind: 'ignored'; favorited: false };

export function hasDetailFavoriteIdentity(ref: DetailFavoriteRef): boolean {
  return !!ref.profileId && !!ref.sourceKey && !!ref.vodId;
}

export function isDetailFavorited(ref: DetailFavoriteRef, port: DetailFavoritePort): boolean {
  // A profile-less lookup can match an identically keyed record in another profile.
  return hasDetailFavoriteIdentity(ref) && port.findFavorite(ref) !== null;
}

/** Subscribe to favorites changed elsewhere and return the current state immediately. */
export function observeDetailFavorite(
  ref: DetailFavoriteRef,
  port: DetailFavoritePort,
  onChange: (favorited: boolean) => void,
): () => void {
  const synchronize = (): void => onChange(isDetailFavorited(ref, port));
  const unsubscribe = port.subscribe(synchronize);
  synchronize();
  return unsubscribe;
}

/** Toggle one subscription/source/title identity through the shared favorites port. */
export function toggleDetailFavorite(input: DetailFavoriteInput, port: DetailFavoritePort): DetailFavoriteChange {
  if (!hasDetailFavoriteIdentity(input)) return { kind: 'ignored', favorited: false };

  const existing = port.findFavorite(input);
  if (existing) {
    port.removeFavorite(existing.key);
    return { kind: 'removed', favorited: false };
  }

  port.addFavorite({
    sourceKey: input.sourceKey,
    vodId: input.vodId,
    name: input.name || input.fallbackName,
    profileId: input.profileId,
    sourceName: input.sourceName || undefined,
    pic: input.pic || undefined,
    remarks: input.remarks || undefined,
    year: input.year || undefined,
    type: input.type || undefined,
  });
  return { kind: 'added', favorited: true };
}
