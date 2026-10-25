import type { SrMode } from '../../../../shared/player';
import type { SuperResolutionPort } from './superResolutionPort';

export type SuperResolutionModeChange =
  | { type: 'persistence-failed'; error: unknown }
  | { type: 'saved-and-applied'; mode: SrMode }
  | { type: 'saved-but-not-applied'; mode: SrMode }
  | { type: 'saved-but-command-failed'; mode: SrMode; error: unknown };

/** Persist the preference before attempting to change the live MPV session. */
export async function changeSuperResolutionMode(
  port: SuperResolutionPort,
  mode: SrMode,
): Promise<SuperResolutionModeChange> {
  try {
    await port.saveMode(mode);
  } catch (error) {
    return { type: 'persistence-failed', error };
  }

  try {
    const result = await port.applyMode(mode);
    return result.ok
      ? { type: 'saved-and-applied', mode }
      : { type: 'saved-but-not-applied', mode };
  } catch (error) {
    return { type: 'saved-but-command-failed', mode, error };
  }
}
