/** Stable identity for a source when result keys may repeat between profiles. */
export function sourceIdentityKey(profileId: string | undefined, key: string): string {
  return JSON.stringify([profileId ?? '', key]);
}
