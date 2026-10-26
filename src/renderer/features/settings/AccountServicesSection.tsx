import type { DriveAccountsEventsPort } from './application/driveAccountsEventsPort';
import type { MetaSettingsEventsPort } from './application/metaSettingsEventsPort';
import type { MetaSettingsPort } from './application/metaSettingsPort';
import type { SubtitleSettingsPort } from './application/subtitleSettingsPort';
import { DriveAccountsSection } from './DriveAccountsSection';
import { MetaSettingsSection } from './MetaSettingsSection';
import { SubtitleSettingsSection } from './SubtitleSettingsSection';

interface AccountServicesSectionProps {
  subtitle: SubtitleSettingsPort;
  metadata: MetaSettingsPort;
  driveEvents: DriveAccountsEventsPort;
  metadataEvents: MetaSettingsEventsPort;
}

export function AccountServicesSection({ subtitle, metadata, driveEvents, metadataEvents }: AccountServicesSectionProps) {
  return (
    <>
      <DriveAccountsSection events={driveEvents} />
      <SubtitleSettingsSection port={subtitle} />
      <MetaSettingsSection port={metadata} events={metadataEvents} />
    </>
  );
}
