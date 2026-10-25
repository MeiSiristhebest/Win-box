import { playbackResultError } from '../../../../shared/playbackResult';
import type { DetailEpisodePlaybackOutcome, DetailEpisodePlaybackRequest, DetailPlaybackPort } from './detailPlaybackPorts';

/** Resolve one episode and normalize success, binding, and error outcomes for the UI controller. */
export async function resolveDetailEpisodePlayback(
  request: DetailEpisodePlaybackRequest,
  port: DetailPlaybackPort,
): Promise<DetailEpisodePlaybackOutcome> {
  if (!request.profileId) return { kind: 'failed', message: '详情页尚未确定所属订阅' };
  const result = await port.play(request);
  if (result.needDriveCookieBind) return { kind: 'needs-drive-binding', provider: String(result.needDriveCookieBind) };
  const message = playbackResultError(result);
  return message ? { kind: 'failed', message } : { kind: 'ready', url: result.url };
}
