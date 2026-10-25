import type { Logger, ProfileSitesView, SourceBean, UserConfig, UserProfile } from '../../shared/types';
import { buildMergedSubscription, type MergeInput } from '../../engine/config/mergeSubscriptions';
import type { LocalPackageReferencePort } from './LocalPackageReferencePort';

/** Profile query capability provided by the source-runtime adapter. */
export interface ProfileSourceLookupPort {
  listSources(profileId: string): SourceBean[];
}

export interface ProfileConfigurationStorePort {
  snapshot(): UserConfig;
  rawProfiles(): UserProfile[];
  profiles(): Array<{ id: string; name: string; apiUrl: string; sourceCount: number; importedAt: string }>;
  profileSitesView(): ProfileSitesView;
  saveAsProfile(name: string): UserProfile;
  activateProfile(profileId: string, pickKey?: string): void;
  deleteProfile(profileId: string): void;
  updateProfileName(profileId: string, name: string): void;
  activeProfileId(): string;
}

export interface MergedProfilesExport {
  content: string;
  summary: MergeInput[];
}

export interface ProfileConfigurationApplicationServiceOptions {
  profiles: ProfileConfigurationStorePort;
  sourceLookup: ProfileSourceLookupPort;
  localPackages?: Pick<LocalPackageReferencePort, 'cleanupRemoved'>;
  logger: Pick<Logger, 'i' | 'w'>;
}

/** Saved-profile queries and mutations, including cleanup after profile deletion. */
export class ProfileConfigurationApplicationService {
  constructor(private readonly options: ProfileConfigurationApplicationServiceOptions) {}

  listProfiles(): ReturnType<ProfileConfigurationStorePort['profiles']> {
    return this.options.profiles.profiles();
  }

  exportMergedProfiles(ids: string[]): MergedProfilesExport {
    const selectedIds = new Set(ids || []);
    const selectedProfiles = this.options.profiles
      .rawProfiles()
      .filter((profile) => selectedIds.has(profile.id))
      .map(({ name, json }) => ({ name, json: json || '' }));
    const result = buildMergedSubscription(selectedProfiles);
    this.options.logger.i(
      `合并导出：档案 ${result.summary.length} 份 / 源 ${result.summary.reduce((count, profile) => count + profile.sites.length, 0)} 条；` +
        `spider ${result.spiders.length ? result.spiders.length + ' 只（多 jar 源已按源回填）' : '无'}；` +
        `flags ${result.flags.length}；parses ${result.parseCount}`,
    );
    return { content: result.content, summary: result.summary };
  }

  saveCurrentAsProfile(name: string): UserProfile {
    return this.options.profiles.saveAsProfile(name);
  }

  activateProfile(profileId: string): void {
    this.options.profiles.activateProfile(profileId);
  }

  deleteProfile(profileId: string): void {
    const before = this.options.profiles.snapshot();
    this.options.profiles.deleteProfile(profileId);
    try {
      this.options.localPackages?.cleanupRemoved?.(before, this.options.profiles.snapshot());
    } catch (error) {
      this.options.logger.w(`本地导入副本清理失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  renameProfile(profileId: string, name: string): void {
    this.options.profiles.updateProfileName(profileId, name);
  }

  getProfileSites(): ProfileSitesView {
    return this.options.profiles.profileSitesView();
  }

  getProfileSources(profileId: string): SourceBean[] {
    return this.options.sourceLookup.listSources(String(profileId || ''));
  }

  switchProfileSource(profileId: string, sourceKey: string): void {
    this.options.profiles.activateProfile(profileId, sourceKey);
  }

  activeProfileId(): string {
    return this.options.profiles.activeProfileId();
  }
}
