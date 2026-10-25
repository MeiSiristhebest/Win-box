import type {
  AudioTrackControlModel,
  DanmakuPanelModel,
  DlnaCastControlModel,
  ElementHandle,
  EpisodeControlModel,
  FitControlModel,
  FullscreenControlModel,
  KernelControlModel,
  KernelToolsControlModel,
  PlaybackRateControlModel,
  PlayerProgressBarModel,
  PlayerSkipMenuActions,
  PlayerSkipMenuModel,
  PlayerTechnicalBarModel,
  PlayerTransportModel,
  PlayerVolumeModel,
  SkipSegmentsControlModel,
  SubtitlePanelModel,
  SuperResolutionControlModel,
} from './PlayerControlModels';

export type { ElementHandle, KernelChoice, PointerCoordinates } from './PlayerControlModels';

/**
 * Stable contract between the playback presenter and rendered controls.
 * Keep this model independent from concrete component implementations so controls
 * can be replaced or rearranged without reversing the presentation dependency.
 */
export interface PlayerControlsViewModel {
  mini: boolean;
  isLive: boolean;
  currentTime: number;
  duration: number;
  formatPlaybackTime: (seconds: number) => string;
  transport: PlayerTransportModel;
  technicalBar: PlayerTechnicalBarModel;
  progressBar: PlayerProgressBarModel | null;
  skipMenu: PlayerSkipMenuModel | null;
  skipMenuRef: ElementHandle<HTMLDivElement>;
  hasSkipSegments: boolean;
  skipMenuActions: PlayerSkipMenuActions;
  volume: PlayerVolumeModel;
  dlna: DlnaCastControlModel;
  subtitle: SubtitlePanelModel;
  danmaku: DanmakuPanelModel;
  skipSegments: SkipSegmentsControlModel | null;
  rate: PlaybackRateControlModel;
  kernel: KernelControlModel | null;
  kernelTools: KernelToolsControlModel | null;
  superResolution: SuperResolutionControlModel;
  audio: AudioTrackControlModel;
  fit: FitControlModel;
  episodes: EpisodeControlModel | null;
  fullscreen: FullscreenControlModel;
}
