import type { AudioPlayerInput } from '../features/playback/application/audioPlayer';
import { audioPlayerKeyboardEventsAdapter } from '../features/playback/adapters/audioPlayerKeyboardEventsAdapter';
import { audioPlaybackMediaAdapter } from '../features/playback/adapters/audioPlaybackMediaAdapter';
import { audioPlayerShortcutGuardAdapter } from '../features/playback/adapters/audioPlayerShortcutGuardAdapter';
import { playerPlaybackPositionAdapter } from '../features/playback/adapters/playerPlaybackPositionAdapter';
import { AudioPlayerView } from '../features/playback/AudioPlayerView';
import { useAudioPlaybackSession } from '../features/playback/useAudioPlaybackSession';

export type AudioPlayerProps = AudioPlayerInput;

export default function AudioPlayer(props: AudioPlayerProps) {
  const model = useAudioPlaybackSession(
    props,
    playerPlaybackPositionAdapter,
    audioPlaybackMediaAdapter,
    audioPlayerShortcutGuardAdapter,
    audioPlayerKeyboardEventsAdapter,
  );
  return <AudioPlayerView model={model} />;
}
