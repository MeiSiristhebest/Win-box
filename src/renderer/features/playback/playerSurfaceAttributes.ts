export interface PlayerSurfaceRoot {
  dataset: {
    mpv?: string;
    pwinUi?: string;
  };
}

export interface PlayerSurfaceState {
  mpvSurfaceActive: boolean;
  playerWindowControlsHidden: boolean;
}

/** Applies global markers consumed by the player-window shell styles. */
export function applyPlayerSurfaceState(root: PlayerSurfaceRoot, state: PlayerSurfaceState): () => void {
  if (state.mpvSurfaceActive) root.dataset.mpv = '1';
  else delete root.dataset.mpv;

  if (state.playerWindowControlsHidden) root.dataset.pwinUi = '0';
  else delete root.dataset.pwinUi;

  return () => {
    delete root.dataset.mpv;
    delete root.dataset.pwinUi;
  };
}
