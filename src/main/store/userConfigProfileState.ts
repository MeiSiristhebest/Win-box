import { isLocalLiveUrl } from '../../engine/live/localLive';
import { parseSiteConfig } from '../../engine/config/ApiConfigParser';
import type { LiveBean, SiteConfig, UserConfig } from '../../shared/types';
import { deriveSubscriptionSourceOverridesFromSnapshot } from './subscriptionProfileMerge';
import { serializeImport } from './userProfileSnapshot';

/**
 * Keep local playlist imports independent from subscription snapshots.
 * The returned config and its live entries are copied; the input snapshots are never mutated.
 */
export function mergeLocalLives(next: UserConfig, currentLives: readonly LiveBean[]): UserConfig {
  const localLives = currentLives.filter((live) => isLocalLiveUrl(live.url));
  if (!localLives.length) return next;

  const seen = new Set(next.lives.map((live) => String(live.url || '').trim()));
  const lives = [...next.lives];
  for (const live of localLives) {
    const url = String(live.url || '').trim();
    if (seen.has(url)) continue;
    lives.push({ ...live, header: live.header ? { ...live.header } : undefined });
    seen.add(url);
  }
  return lives.length === next.lives.length ? next : { ...next, lives };
}

/** Exclude machine-local playlists from portable subscription profile snapshots. */
export function profileSnapshotLives(lives: readonly LiveBean[]): LiveBean[] {
  return lives.filter((live) => !isLocalLiveUrl(live.url)).map((live) => ({
    ...live,
    header: live.header ? { ...live.header } : undefined,
  }));
}

/**
 * Reconcile the active profile's portable snapshot with the effective runtime config.
 * Parsing, serialization and source override derivation are pure domain functions; persistence
 * remains in UserConfigApplicationService.apply(). A malformed legacy snapshot is tolerated so it cannot
 * prevent edits to a valid runtime config.
 */
export function syncActiveProfileSnapshot(next: UserConfig): UserConfig {
  const profileId = next.activeProfileId;
  if (!profileId) return next;
  const active = next.profiles.find((profile) => profile.id === profileId);
  if (!active) return next;

  let stored: SiteConfig | undefined;
  if (active.json) {
    try {
      stored = parseSiteConfig(active.json).config;
    } catch {
      // Keep all recoverable fields absent when the legacy snapshot is malformed.
    }
  }

  const json = serializeImport({
    ...stored,
    sites: next.sources,
    lives: profileSnapshotLives(next.lives),
    spider: next.global.spider,
    flags: next.global.flags,
    parses: next.parses,
  } as SiteConfig);
  const sourceOverridesJson = deriveSubscriptionSourceOverridesFromSnapshot(active.upstreamJson, next.sources);
  return {
    ...next,
    profiles: next.profiles.map((profile) => profile.id === profileId
      ? {
          ...profile,
          json,
          sourceCount: next.sources.length,
          ...(sourceOverridesJson ? { sourceOverridesJson } : {}),
        }
      : profile),
  };
}
