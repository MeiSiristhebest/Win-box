import { resolve } from 'node:path';

/** Parse playback acceptance options without loading Electron or the app runtime. */
export function parsePlaybackAcceptanceArgs(args) {
  const indexes = args.flatMap((argument, index) => argument === '--packaged-app' ? [index] : []);
  if (indexes.length > 1) throw new Error('Use --packaged-app once.');
  const directory = indexes.length ? args[indexes[0] + 1] : null;
  if (indexes.length && (!directory || directory.startsWith('--'))) throw new Error('--packaged-app requires a win-unpacked directory.');
  const playerIndexes = args.flatMap((argument, index) => argument === '--potplayer' ? [index] : []);
  if (playerIndexes.length > 1) throw new Error('Use --potplayer once.');
  const player = playerIndexes.length ? args[playerIndexes[0] + 1] : null;
  if (playerIndexes.length && (!player || player.startsWith('--'))) throw new Error('--potplayer requires the PotPlayer executable path.');
  const matrixIndexes = args.flatMap((argument, index) => argument === '--source-matrix' ? [index] : []);
  if (matrixIndexes.length > 1) throw new Error('Use --source-matrix once.');
  const matrixPath = matrixIndexes.length ? args[matrixIndexes[0] + 1] : null;
  if (matrixIndexes.length && (!matrixPath || matrixPath.startsWith('--'))) throw new Error('--source-matrix requires a JSON file path.');
  const artifactIndexes = args.flatMap((argument, index) => argument === '--artifact-dir' ? [index] : []);
  if (artifactIndexes.length > 1) throw new Error('Use --artifact-dir once.');
  const artifactDirectory = artifactIndexes.length ? args[artifactIndexes[0] + 1] : null;
  if (artifactIndexes.length && (!artifactDirectory || artifactDirectory.startsWith('--'))) throw new Error('--artifact-dir requires a new output directory inside .tmp.');
  const playbackOnly = args.includes('--playback-only');
  if (playbackOnly && matrixPath) throw new Error('--playback-only cannot be combined with --source-matrix.');
  return {
    packagedAppDirectory: directory ? resolve(directory) : null,
    potplayerPath: player ? resolve(player) : null,
    sourceMatrixPath: matrixPath ? resolve(matrixPath) : null,
    artifactDirectory: artifactDirectory ? resolve(artifactDirectory) : null,
    playbackOnly,
  };
}
