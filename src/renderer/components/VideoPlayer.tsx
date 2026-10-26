import { useVideoPlayerPresenter } from '../features/playback/VideoPlayerPresenter';
import { VideoPlayerView } from '../features/playback/VideoPlayerView';
import type { VideoPlayerPresenterDependencies, VideoPlayerProps } from '../features/playback/VideoPlayerPresenter';
import { subtitleQueryMemoryAdapter, subtitleSearchServiceAdapter } from '../features/playback/adapters/subtitleSearchAdapters';
import { subtitlePlaybackAdapter } from '../features/playback/adapters/subtitlePlaybackAdapter';
import { superResolutionAdapter } from '../features/playback/adapters/superResolutionAdapter';
import { playerPreferencesStorageAdapter } from '../features/playback/adapters/playerPreferencesStorageAdapter';
import { createPlayerAudioTracksAdapter } from '../features/playback/adapters/playerAudioTracksAdapter';
import { sessionAudioPreferenceMemoryAdapter } from '../features/playback/adapters/sessionAudioPreferenceMemoryAdapter';
import { htmlMediaSourceAdapter } from '../features/playback/htmlMediaSourceAdapter';
import { playerKernelCommandsAdapter } from '../features/playback/adapters/playerKernelCommandsAdapter';
import { bossKeyPlaybackEventsAdapter, relaySpeedEventsAdapter } from '../features/playback/adapters/playerRuntimeEventsAdapter';
import { driveBindingNavigationAdapter, driveBindingPromptAdapter } from '../features/playback/adapters/driveBindingAdapters';
import { mpvPlaybackSessionAdapter, mpvStatusQueryAdapter } from '../features/playback/adapters/mpvPlaybackAdapters';
import { playerKernelWindowAdapter } from '../features/playback/adapters/playerKernelWindowAdapter';
import { playerViewportAdapter } from '../features/playback/adapters/playerViewportAdapter';
import { playerWindowReloadAdapter } from '../features/playback/adapters/playerWindowReloadAdapter';
import { danmakuControllerAdapter } from '../features/playback/adapters/danmakuControllerAdapter';
import { dlnaCastingAdapter } from '../features/playback/adapters/dlnaCastingAdapter';
import { mediaDiagnosticsAdapter } from '../features/playback/adapters/mediaDiagnosticsAdapter';
import { playerFullscreenAdapter } from '../features/playback/adapters/playerFullscreenAdapter';
import { pluginPlaybackEnginesAdapter } from '../features/playback/adapters/pluginPlaybackEnginesAdapter';
import { rendererExternalPlaybackPorts } from '../features/playback/adapters/externalPlaybackAdapter';
import { playerClipboardAdapter } from '../features/playback/adapters/playerClipboardAdapter';
import { playerPlaybackPositionAdapter } from '../features/playback/adapters/playerPlaybackPositionAdapter';
import { playerPlaybackRuntimeAdapter } from '../features/playback/adapters/playerPlaybackRuntimeAdapter';
import { playerKeyboardShortcutsAdapter } from '../features/playback/adapters/playerKeyboardShortcutsAdapter';
import { skipSegmentsControllerAdapter } from '../features/playback/adapters/skipSegmentsControllerAdapter';

const playerDependencies: VideoPlayerPresenterDependencies = {
  subtitleSearch: { service: subtitleSearchServiceAdapter, queryMemory: subtitleQueryMemoryAdapter },
  subtitlePlayback: subtitlePlaybackAdapter,
  superResolution: superResolutionAdapter,
  externalPlayback: rendererExternalPlaybackPorts,
  playerPreferences: playerPreferencesStorageAdapter,
  sessionAudioPreference: sessionAudioPreferenceMemoryAdapter,
  createAudioTracksPort: createPlayerAudioTracksAdapter,
  htmlMediaSource: htmlMediaSourceAdapter,
  playerKernelCommands: playerKernelCommandsAdapter,
  relaySpeedEvents: relaySpeedEventsAdapter,
  bossKeyPlaybackEvents: bossKeyPlaybackEventsAdapter,
  driveBindingPrompt: driveBindingPromptAdapter,
  driveBindingNavigation: driveBindingNavigationAdapter,
  mpvPlaybackSession: mpvPlaybackSessionAdapter,
  mpvStatusQuery: mpvStatusQueryAdapter,
  playerKernelWindow: playerKernelWindowAdapter,
  playerViewport: playerViewportAdapter,
  playerWindowReload: playerWindowReloadAdapter,
  danmakuController: danmakuControllerAdapter,
  dlnaCasting: dlnaCastingAdapter,
  mediaDiagnostics: mediaDiagnosticsAdapter,
  playbackPositionMemory: playerPlaybackPositionAdapter,
  playbackRuntime: playerPlaybackRuntimeAdapter,
  playerFullscreen: playerFullscreenAdapter,
  pluginPlaybackEngines: pluginPlaybackEnginesAdapter,
  clipboard: playerClipboardAdapter,
  keyboardShortcuts: playerKeyboardShortcutsAdapter,
  skipSegments: skipSegmentsControllerAdapter,
};

export default function VideoPlayer(props: VideoPlayerProps) {
  const model = useVideoPlayerPresenter(props, playerDependencies);
  return <VideoPlayerView model={model} />;
}
