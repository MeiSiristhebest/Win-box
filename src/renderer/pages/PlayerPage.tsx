import { useState } from 'react';
import { playerWindowTitle } from '../lib/videoResolution';
import { playerWindowControlEventsAdapter } from '../features/playback/adapters/playerWindowControlEventsAdapter';
import { playerMpvCommandAdapter } from '../features/playback/adapters/playerKernelCommandsAdapter';
import { playerHistoryProgressAdapter } from '../features/playback/adapters/playerHistoryProgressAdapter';
import { playerPageSessionAdapter } from '../features/playback/adapters/playerPageSessionAdapter';
import { playerPageWindowAdapter } from '../features/playback/adapters/playerPageWindowAdapter';
import { playerSourceMemoryAdapter } from '../features/playback/adapters/playerSourceMemoryAdapter';
import { usePlayerPageSession } from '../features/playback/usePlayerPageSession';
import { usePlayerPageWindow } from '../features/playback/usePlayerPageWindow';
import { usePlayerWindowControls } from '../features/playback/usePlayerWindowControls';
import { PlayerPageView } from './PlayerPageView';

export default function PlayerPage() {
  const session = usePlayerPageSession(playerPageSessionAdapter, playerHistoryProgressAdapter, playerSourceMemoryAdapter);
  const windowState = usePlayerPageWindow(playerPageWindowAdapter);
  const [resolution, setResolution] = useState('');
  const title = playerWindowTitle(session.curName, resolution);

  usePlayerWindowControls({
    events: playerWindowControlEventsAdapter,
    commands: playerMpvCommandAdapter,
    currentEpisodeIndex: session.epIndex,
    episodeCount: session.episodes.length,
    onSelectEpisode: session.selectEpisode,
  });

  return <PlayerPageView session={session} windowState={windowState} title={title} onResolutionChange={setResolution} />;
}
