import type { SourceBean } from '../../../../shared/types';
import { sourceAvailability } from '../../../../engine/vod/sourceAvailability';

export type HomeSourceSelection = {
  sources: SourceBean[];
  profileId: string;
  activeProfileId: string;
  rememberedProfileId?: string;
  rememberedSourceKey: string;
  configuredSourceKey?: string;
};

/** Select a requested source only when it is usable; otherwise use the first usable source. */
export function selectUsableHomeSource(sources: SourceBean[], preferredSourceKey = ''): SourceBean | undefined {
  const preferred = preferredSourceKey
    ? sources.find((source) => source.key === preferredSourceKey)
    : undefined;
  if (preferred && sourceAvailability(preferred).usable) return preferred;
  return sources.find((source) => sourceAvailability(source).usable) ?? sources[0];
}

/** Restore source choice in order: same-profile session memory, active-profile config, usable default. */
export function selectHomeSource({
  sources,
  profileId,
  activeProfileId,
  rememberedProfileId,
  rememberedSourceKey,
  configuredSourceKey,
}: HomeSourceSelection): string {
  const remembered = rememberedProfileId === profileId && rememberedSourceKey
    ? sources.find((source) => source.key === rememberedSourceKey)
    : undefined;
  if (remembered && sourceAvailability(remembered).usable) return remembered.key;

  const configured = profileId === activeProfileId && configuredSourceKey
    ? sources.find((source) => source.key === configuredSourceKey)
    : undefined;
  if (configured && sourceAvailability(configured).usable) return configured.key;

  return selectUsableHomeSource(sources)?.key ?? '';
}
