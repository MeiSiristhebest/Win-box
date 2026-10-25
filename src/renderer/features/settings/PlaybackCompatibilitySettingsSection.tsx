import type { PlayerSettings } from '../../../shared/player';
import type {
  MediaRuntimeManagementPort,
  MpvSettingsPort,
  PlayerSettingsReadPort,
  PlayerSettingsWritePort,
} from './application/playbackSettingsPorts';
import { MediaRuntimeDownloadsSection } from './MediaRuntimeDownloadsSection';
import { PlaybackCompatibilitySettingsView } from './PlaybackCompatibilitySettingsView';
import { usePlaybackCompatibilityPresenter } from './usePlaybackCompatibilityPresenter';

interface PlaybackCompatibilitySettingsSectionProps {
  active: boolean;
  settingsLoaded: boolean;
  settings: PlayerSettings;
  settingsReader: PlayerSettingsReadPort;
  settingsWriter: PlayerSettingsWritePort;
  statusQuery: MpvSettingsPort;
  mediaRuntime: MediaRuntimeManagementPort;
  onSettingsSaved(settings: PlayerSettings): void;
  onAvailabilityChange(available: boolean): void;
}

export function PlaybackCompatibilitySettingsSection(props: PlaybackCompatibilitySettingsSectionProps) {
  const { model, actions, refreshAfterInstall } = usePlaybackCompatibilityPresenter(props);

  return (
    <>
      <PlaybackCompatibilitySettingsView model={model} actions={actions} />
      <MediaRuntimeDownloadsSection active={props.active} port={props.mediaRuntime} afterMpvInstall={refreshAfterInstall} />
    </>
  );
}
