import type { ProfileSitesView } from '../../shared/types';

export interface ProfileSiteSummary {
  key: string;
  name: string;
}

export interface ProfileSitesProjectionInput {
  id: string;
  name: string;
  sites: readonly ProfileSiteSummary[];
}

/** Build the read-only profile/source model consumed by source-switching views. */
export function buildProfileSitesView(
  activeId: string,
  profiles: readonly ProfileSitesProjectionInput[],
): ProfileSitesView {
  return {
    activeId,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      sites: profile.sites.map((site) => ({ ...site })),
    })),
  };
}
